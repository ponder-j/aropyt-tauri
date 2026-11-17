use crate::{i18n::text as tr, state::*, send};
use serde_json::{json, Value};
use std::{sync::{atomic::{AtomicBool, Ordering}, Mutex}, time::Duration};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Updates {
    startup_claimed: AtomicBool,
    installing: AtomicBool,
    pending: Mutex<Option<(String, Update, Option<Vec<u8>>)>>,
}

pub fn is_installing(app: &AppHandle) -> bool {
    app.try_state::<Updates>().is_some_and(|state| state.installing.load(Ordering::SeqCst))
}

pub fn current_build() -> i64 {
    serde_json::from_str::<Value>(include_str!("../updater-build.json")).ok()
        .and_then(|value| value["build"].as_i64()).unwrap_or(0)
}

fn builder(app: &AppHandle) -> Result<tauri_plugin_updater::UpdaterBuilder> {
    let builder = app.updater_builder().timeout(Duration::from_secs(20));
    let settings = app.state::<AppState>().config();
    let proxy = settings["updateProxy"].as_str().unwrap_or("").trim();
    let builder = if proxy.is_empty() { builder } else {
        let url = url::Url::parse(proxy).ok().filter(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
            .ok_or(tr("更新代理地址无效，请在偏好设置中填写 HTTP 或 HTTPS 代理地址。", "Invalid update proxy. Enter an HTTP or HTTPS proxy URL in Preferences."))?;
        builder.proxy(url)
    };
    #[cfg(target_os = "macos")]
    let builder = builder.version_comparator(|current, release| {
        release.version > current || release.version == current
            && release.pub_date.is_some_and(|date| date.unix_timestamp() > current_build())
    });
    Ok(builder)
}

// The build marker is inside the signed archive. Changing a manifest date
// cannot relabel an older signed package as a new build of the same version.
#[cfg(target_os = "macos")]
fn verify_build(update: &Update, bytes: &[u8]) -> Result<()> {
    use std::io::Read;
    let expected = update.date.ok_or(tr("更新清单缺少构建日期。", "The update manifest has no build date."))?.unix_timestamp();
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
    let mut builds = vec![];
    for entry in archive.entries().map_err(err)? {
        let mut entry = entry.map_err(err)?;
        if entry.path().map_err(err)?.ends_with("Contents/Resources/updater-build.json") {
            let mut marker = String::new();
            entry.by_ref().take(16385).read_to_string(&mut marker).map_err(err)?;
            if marker.len() > 16384 { return Err("Invalid update build marker".into()); }
            let marker: Value = serde_json::from_str(&marker).map_err(err)?;
            builds.push(marker["build"].as_i64().unwrap_or(0));
        }
    }
    if expected <= 0 || builds != [expected] {
        return Err(tr("更新包的构建标识与清单不一致，请稍后重试。", "The signed update build does not match its manifest. Please try again later.").into());
    }
    Ok(())
}

pub fn reopen_after_update(app: &AppHandle) -> Option<Vec<String>> {
    let file = app.state::<AppState>().data.join("update-reopen.json");
    let bytes = std::fs::read(&file).ok()?;
    let files: Vec<String> = serde_json::from_slice(&bytes).ok()?;
    std::fs::remove_file(file).ok()?;
    Some(files.into_iter().filter(|file| std::path::Path::new(file).is_file()).collect())
}

#[cfg(target_os = "macos")]
fn restart_macos(app: &AppHandle) -> Result<()> {
    use std::{process::{Command, Stdio}, os::unix::process::CommandExt};
    let executable = std::env::current_exe().map_err(err)?;
    let bundle = executable.parent().and_then(|p| p.parent()).and_then(|p| p.parent())
        .filter(|p| p.extension().is_some_and(|ext| ext == "app"))
        .ok_or(tr("请先将 Aropyt 安装到应用程序文件夹。", "Install Aropyt in Applications first."))?;
    // Wait for the previous process to exit before using LaunchServices. This
    // prevents single-instance forwarding back to the app being replaced.
    let mut command = Command::new("/bin/sh");
    command.args(["-c", "while kill -0 \"$1\" 2>/dev/null; do sleep 0.1; done; shift; exec \"$@\"", "aropyt-update-restart"])
        .arg(std::process::id().to_string()).arg("/usr/bin/open").arg("-n").arg(bundle);
    if crate::testing::isolated() {
        for key in ["AROPYT_DATA_DIR", "AROPYT_TEST_PORT", "AROPYT_TEST_TOKEN"] {
            if let Ok(value) = std::env::var(key) { command.arg("--env").arg(format!("{key}={value}")); }
        }
    }
    // Our one-shot document list owns restoration after an update; Cocoa must
    // not interrupt it with persistent windows from an earlier app crash.
    command.args(["--args", "--aropyt-update-restart", "-ApplePersistenceIgnoreState", "YES"])
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).process_group(0)
        .spawn().map_err(err)?;
    let app = app.clone();
    std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(200)); app.exit(0); });
    Ok(())
}

#[cfg(target_os = "macos")]
fn install_macos(app: &AppHandle, update: &Update, bytes: &[u8]) -> Result<()> {
    verify_build(update, bytes)?;
    let state = app.state::<Updates>();
    state.installing.store(true, Ordering::SeqCst);
    let windows: Vec<_> = app.webview_windows().into_values().collect();
    let snapshot = app.state::<AppState>().data.join("update-reopen.json");
    let result = (|| {
        for window in &windows { window.set_enabled(false).map_err(err)?; }
        for editor in crate::editors(app) {
            if crate::evaluate(&editor, "(()=>{document.activeElement?.blur();return window.__aropyt.state.dirty})()")? == true {
                return Err(tr("仍有未保存的文稿，请先保存后再安装。", "There are unsaved documents. Save them before installing.").into());
            }
        }
        let files: Vec<String> = app.state::<AppState>().docs.lock().unwrap().values()
            .filter_map(|doc| doc.file.clone()).collect();
        atomic_write(&snapshot, &serde_json::to_vec(&files).map_err(err)?)?;
        update.install(bytes).map_err(err)?;
        restart_macos(app)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(snapshot);
        for window in &windows { let _ = window.set_enabled(true); }
        state.installing.store(false, Ordering::SeqCst);
    }
    result
}

// Runs on the bridge's blocking worker; no UI thread or document lock is held
// while querying GitHub, downloading, or waiting for a save dialog.
pub fn dispatch(app: &AppHandle, win: &WebviewWindow, method: &str) -> Result<Value> {
    let state = app.state::<Updates>();
    if method == "update.claimStartup" {
        let enabled = cfg!(any(target_os = "windows", target_os = "macos")) && !cfg!(debug_assertions)
            && !crate::testing::isolated();
        return Ok(json!(enabled && !state.startup_claimed.swap(true, Ordering::SeqCst)));
    }
    if method == "update.info" { return Ok(json!({"version":app.package_info().version.to_string(),"build":current_build()})); }
    if !cfg!(any(target_os = "windows", target_os = "macos")) {
        return Err(tr("此平台请从 GitHub Releases 下载更新。", "Download updates for this platform from GitHub Releases.").into());
    }
    let mut pending = state.pending.try_lock().map_err(|_| tr("正在处理更新，请稍后再试。", "An update operation is already in progress. Please try again shortly."))?;
    if let Some((owner, _, _)) = pending.as_ref() {
        if app.get_webview_window(owner).is_none() { *pending = None; }
        else if owner != win.label() { return Err(tr("另一窗口正在处理更新。", "Another window is handling an update.").into()); }
    }
    match method {
        "update.check" => {
            *pending = None;
            let builder = builder(app)?;
            #[cfg(windows)]
            let builder = builder.installer_arg(format!("/D={}", std::env::current_exe().map_err(err)?.parent().ok_or("Missing executable directory")?.display()));
            let updater = builder.build().map_err(err)?;
            let update = tauri::async_runtime::block_on(updater.check()).map_err(err)?;
            let info = update.as_ref().map(|u| json!({"version":u.version,"currentVersion":u.current_version,"body":u.body,
                "build":u.date.map(|date|date.unix_timestamp()),"currentBuild":current_build()}));
            *pending = update.map(|u| (win.label().to_string(), u, None));
            Ok(json!(info))
        }
        "update.download" => {
            let (_, update, bytes) = pending.as_mut().ok_or(tr("请先检查更新。", "Check for updates first."))?;
            // A download can take longer than the small manifest request.
            update.timeout = Some(Duration::from_secs(600));
            let mut received = 0_u64;
            let mut last = std::time::Instant::now() - Duration::from_secs(1);
            let download = tauri::async_runtime::block_on(update.download(|chunk, total| {
                received += chunk as u64;
                if last.elapsed() >= Duration::from_millis(150) {
                    send(win, json!({"type":"update-progress","arg":{"received":received,"total":total}}));
                    last = std::time::Instant::now();
                }
            }, || {})).map_err(err)?;
            #[cfg(target_os = "macos")]
            verify_build(update, &download)?;
            let size = download.len();
            *bytes = Some(download); // download() verifies the pinned public key.
            Ok(json!({"received":size}))
        }
        "update.install" => {
            let (_, update, bytes) = pending.as_ref().ok_or(tr("请先下载更新。", "Download the update first."))?;
            let bytes = bytes.as_ref().ok_or(tr("请先下载更新。", "Download the update first."))?;
            // Check every editor immediately before the installer exits the app.
            // Saving/cancelling is explicit; no unsaved window is silently lost.
            if app.state::<AppState>().docs.lock().unwrap().values().any(|doc| doc.dirty) {
                return Err(tr("仍有未保存的文稿。请保存所有窗口中的更改，再重试安装。", "There are unsaved documents. Save changes in every window, then retry installation.").into());
            }
            #[cfg(target_os = "macos")]
            install_macos(app, update, bytes)?;
            #[cfg(not(target_os = "macos"))]
            update.install(bytes).map_err(err)?;
            Ok(json!(true))
        }
        "update.clear" => { *pending = None; Ok(json!(true)) }
        _ => Err("Unknown update command".into()),
    }
}

// Only the authenticated, isolated regression harness can stage an update for
// a same-version reinstall. Signature verification is the real plugin verifier.
pub fn test_fixture(app: &AppHandle, win: &WebviewWindow, manifest: Value, file: &str, stage: bool) -> Result<Value> {
    if !crate::testing::isolated() { return Err("Update fixture requires an isolated test profile".into()); }
    let builder = builder(app)?;
    #[cfg(windows)]
    let builder = builder.installer_args(["/NS".to_string(), format!("/D={}", std::env::current_exe().map_err(err)?.parent().ok_or("Missing executable directory")?.display())]);
    // Permit a same-version reinstall only in this isolated test entry point.
    // Keep the signed version unchanged: updater signatures bind the version.
    let builder = if stage { builder.version_comparator(|_, _| true) } else { builder };
    let updater = builder.build().map_err(err)?;
    let update = updater.restore_update(manifest).map_err(err)?;
    let Some(update) = update else { return Ok(Value::Null); };
    let bytes = std::fs::read(file).map_err(err)?;
    update.verify(&bytes).map_err(err)?;
    #[cfg(target_os = "macos")]
    verify_build(&update, &bytes)?;
    let result = json!({"version":update.version,"verified":true,"size":bytes.len()});
    if stage { *app.state::<Updates>().pending.lock().unwrap() = Some((win.label().to_string(), update, Some(bytes))); }
    Ok(result)
}
