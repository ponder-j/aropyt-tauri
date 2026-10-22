use crate::i18n::text as tr;
use crate::{evaluate, state::*};
use serde_json::{json, Value};
use std::{fs, path::Path, sync::mpsc, time::Duration};
use tauri::{AppHandle, LogicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
pub fn render(
    app: &AppHandle,
    html: &str,
    mode: &str,
    width: f64,
    height: f64,
    settings: &Value,
) -> Result<Vec<u8>> {
    let (ready_tx, ready_rx) = mpsc::channel();
    // Keep the export host CSP: document scripts and inline handlers remain
    // blocked, while privileged measurement can use the host's eval bridge.
    let policy = regex::Regex::new(
        r#"(?is)<meta\b[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>"#,
    )
    .unwrap();
    let html = policy.replace_all(html, "");

    let script = format!(
        "addEventListener('DOMContentLoaded',()=>{{document.documentElement.innerHTML={}}});",
        json!(html)
    );
    let window = WebviewWindowBuilder::new(
        app,
        format!("export-{}", uuid::Uuid::new_v4()),
        WebviewUrl::App("native-export.html".into()),
    )
    .visible(true)
    .focused(false)
    .decorations(false)
    .skip_taskbar(true)
    .position(-32000., -32000.)
    .inner_size(width, 800.)
    .initialization_script(script)
    .on_page_load(move |_, payload| {
        if payload.event() == tauri::webview::PageLoadEvent::Finished {
            let _ = ready_tx.send(());
        }
    })
    .build()
    .map_err(err)?;
    let _ = window.hide_menu();
    let result = (|| {
        ready_rx
            .recv_timeout(Duration::from_secs(30))
            .map_err(err)?;
        let measured=evaluate(&window,"(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images,i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r})));await new Promise(r=>setTimeout(r,100));return Math.ceil(document.documentElement.scrollHeight)})()")?;
        if mode == "print" {
            window.print().map_err(err)?;
            return Ok(b"true".to_vec());
        }
        let height = if height > 0. {
            height
        } else {
            measured.as_f64().unwrap_or(800.)
        }
        .max(1.);
        if mode == "png" && height > 30000. {
            return Err(tr("文档太长，无法导出为单张图片，请导出为 PDF", "The document is too long for a single image. Export it as PDF instead.").into());
        }
        if mode == "png" {
            window
                .set_size(LogicalSize::new(width, height))
                .map_err(err)?;
            evaluate(&window, "new Promise(r=>setTimeout(r,100))")?;
        }
        let temp = tempfile::tempdir().map_err(err)?;
        let output = temp.path().join(if mode == "pdf" {
            "export.pdf"
        } else {
            "export.png"
        });
        #[cfg(windows)]
        windows_export(&window, mode, &output, settings)?;
        #[cfg(target_os = "linux")]
        linux_export(&window, mode, &output, settings)?;
        fs::read(output).map_err(err)
    })();
    let _ = window.destroy();
    result
}
#[cfg(windows)]
fn windows_export(
    window: &WebviewWindow,
    mode: &str,
    output: &Path,
    settings: &Value,
) -> Result<()> {
    use webview2_com::{
        CapturePreviewCompletedHandler, Microsoft::Web::WebView2::Win32::*,
        PrintToPdfCompletedHandler,
    };
    use windows::{
        core::{Interface, HSTRING},
        Win32::{
            System::Com::{STGM_CREATE, STGM_READWRITE},
            UI::Shell::SHCreateStreamOnFileEx,
        },
    };
    let (tx, rx) = mpsc::channel();
    let mode = mode.to_owned();
    let output = output.to_path_buf();
    let settings = settings.clone();
    window
        .with_webview(move |webview| {
            let result = (|| -> Result<()> {
                unsafe {
                    let core = webview.controller().CoreWebView2().map_err(err)?;
                    if mode == "pdf" {
                        let environment: ICoreWebView2Environment6 =
                            webview.environment().cast().map_err(err)?;
                        let print = environment.CreatePrintSettings().map_err(err)?;
                        let (w, h) = match settings["exportPaperSize"].as_str().unwrap_or("A4") {
                            "A3" => (11.6929, 16.5354),
                            "A5" => (5.8268, 8.2677),
                            "Letter" | "US Letter" => (8.5, 11.),
                            "Legal" | "US Legal" => (8.5, 14.),
                            _ => (8.2677, 11.6929),
                        };
                        print.SetPageWidth(w).map_err(err)?;
                        print.SetPageHeight(h).map_err(err)?;
                        print.SetShouldPrintBackgrounds(true).map_err(err)?;
                        let margin =
                            settings["exportMargin"].as_f64().unwrap_or(18.).max(0.) / 25.4;
                        print.SetMarginTop(margin).map_err(err)?;
                        print.SetMarginBottom(margin).map_err(err)?;
                        print.SetMarginLeft(margin).map_err(err)?;
                        print.SetMarginRight(margin).map_err(err)?;
                        let core: ICoreWebView2_7 = core.cast().map_err(err)?;
                        let tx = tx.clone();
                        let handler =
                            PrintToPdfCompletedHandler::create(Box::new(move |status, success| {
                                let _ = tx.send(if status.is_ok() && success {
                                    Ok(())
                                } else {
                                    Err(tr("PDF 导出失败", "PDF export failed").into())
                                });
                                Ok(())
                            }));
                        core.PrintToPdf(
                            &HSTRING::from(output.to_string_lossy().as_ref()),
                            &print,
                            &handler,
                        )
                        .map_err(err)?;
                    } else {
                        let stream = SHCreateStreamOnFileEx(
                            &HSTRING::from(output.to_string_lossy().as_ref()),
                            (STGM_CREATE | STGM_READWRITE).0,
                            0,
                            true,
                            None,
                        )
                        .map_err(err)?;
                        let tx = tx.clone();
                        let handler =
                            CapturePreviewCompletedHandler::create(Box::new(move |status| {
                                let _ = tx.send(status.map_err(err));
                                Ok(())
                            }));
                        core.CapturePreview(
                            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                            &stream,
                            &handler,
                        )
                        .map_err(err)?;
                    }
                    Ok(())
                }
            })();
            if let Err(e) = result {
                let _ = tx.send(Err(e));
            }
        })
        .map_err(err)?;
    rx.recv_timeout(Duration::from_secs(120)).map_err(err)?
}
#[cfg(target_os = "linux")]
fn linux_export(window: &WebviewWindow, mode: &str, output: &Path, settings: &Value) -> Result<()> {
    use webkit2gtk::{PrintOperationExt, WebViewExt};
    let (tx, rx) = mpsc::channel();
    let output = output.to_path_buf();
    let mode = mode.to_owned();
    let settings = settings.clone();
    window
        .with_webview(move |webview| {
            let web = webview.inner();
            if mode == "pdf" {
                let print = webkit2gtk::PrintOperation::new(&web);
                let ps = gtk::PrintSettings::new();
                ps.set_printer("Print to File");
                ps.set("output-file-format", Some("pdf"));
                ps.set(
                    "output-uri",
                    Some(url::Url::from_file_path(&output).unwrap().as_str()),
                );
                print.set_print_settings(&ps);
                let page = gtk::PageSetup::new();
                let paper = match settings["exportPaperSize"].as_str().unwrap_or("A4") {
                    "A3" => "iso_a3",
                    "A5" => "iso_a5",
                    "Letter" | "US Letter" => "na_letter",
                    "Legal" | "US Legal" => "na_legal",
                    _ => "iso_a4",
                };
                page.set_paper_size(&gtk::PaperSize::new(Some(paper)));
                let margin = settings["exportMargin"].as_f64().unwrap_or(18.).max(0.);
                page.set_top_margin(margin, gtk::Unit::Mm);
                page.set_bottom_margin(margin, gtk::Unit::Mm);
                page.set_left_margin(margin, gtk::Unit::Mm);
                page.set_right_margin(margin, gtk::Unit::Mm);
                print.set_page_setup(&page);
                let fail_tx = tx.clone();
                print.connect_failed(move |_, e| {
                    let _ = fail_tx.send(Err(e.to_string()));
                });
                print.connect_finished(move |_| {
                    let _ = tx.send(Ok(()));
                });
                print.print();
            } else {
                web.snapshot(
                    webkit2gtk::SnapshotRegion::FullDocument,
                    webkit2gtk::SnapshotOptions::NONE,
                    None::<&gio::Cancellable>,
                    move |result| {
                        let result = (|| {
                            let surface = result.map_err(err)?;
                            let mut file = fs::File::create(output).map_err(err)?;
                            surface.write_to_png(&mut file).map_err(err)
                        })();
                        let _ = tx.send(result);
                    },
                );
            }
        })
        .map_err(err)?;
    rx.recv_timeout(Duration::from_secs(120)).map_err(err)?
}
