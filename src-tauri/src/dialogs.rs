use crate::i18n::text as tr;
use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
fn file_dialog(
    app: &AppHandle,
    win: &WebviewWindow,
    opts: &Value,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let mut d = app.dialog().file().set_parent(win);
    if let Some(title) = opts["title"].as_str() {
        d = d.set_title(title);
    }
    if let Some(path) = opts["defaultPath"].as_str() {
        let p = Path::new(path);
        if let Some(parent) = p.parent() {
            if parent.is_dir() {
                d = d.set_directory(parent);
            }
        }
        if let Some(name) = p.file_name() {
            d = d.set_file_name(name.to_string_lossy());
        }
    }
    if let Some(filters) = opts["filters"].as_array() {
        for filter in filters {
            let exts: Vec<&str> = filter["extensions"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .filter(|s| *s != "*")
                        .collect()
                })
                .unwrap_or_default();
            if !exts.is_empty() {
                d = d.add_filter(filter["name"].as_str().unwrap_or(tr("文件", "Files")), &exts);
            }
        }
    }
    d
}
pub fn open(app: &AppHandle, win: &WebviewWindow, opts: &Value) -> Value {
    let properties = opts["properties"].as_array().cloned().unwrap_or_default();
    let folder = properties.iter().any(|v| v == "openDirectory");
    let multiple = properties.iter().any(|v| v == "multiSelections");
    let d = file_dialog(app, win, opts).set_title(opts["title"].as_str().unwrap_or(if folder { tr("打开文件夹", "Open Folder") } else { tr("打开文件", "Open File") }));
    let paths = if folder {
        if multiple {
            d.blocking_pick_folders()
        } else {
            d.blocking_pick_folder().map(|p| vec![p])
        }
    } else if multiple {
        d.blocking_pick_files()
    } else {
        d.blocking_pick_file().map(|p| vec![p])
    };
    let paths: Vec<String> = paths
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.to_string())
        .collect();
    json!({"canceled":paths.is_empty(),"filePaths":paths})
}
pub fn save(app: &AppHandle, win: &WebviewWindow, opts: &Value) -> Value {
    let p = file_dialog(app, win, opts)
        .set_title(opts["title"].as_str().unwrap_or(tr("保存文件", "Save File")))
        .blocking_save_file()
        .map(|p| p.to_string());
    json!({"canceled":p.is_none(),"filePath":p})
}
pub fn message(app: &AppHandle, win: &WebviewWindow, opts: &Value) -> Value {
    let mut labels: Vec<String> = opts["buttons"]
        .as_array()
        .map(|v| {
            v.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_else(|| vec![tr("确定", "OK").into()]);
    if labels.is_empty() { labels.push(tr("确定", "OK").into()); }
    let buttons = match labels.as_slice() {
        [a] => MessageDialogButtons::OkCustom(a.clone()),
        [a, b] => MessageDialogButtons::OkCancelCustom(a.clone(), b.clone()),
        [a, b, c, ..] => MessageDialogButtons::YesNoCancelCustom(a.clone(), b.clone(), c.clone()),
        _ => MessageDialogButtons::Ok,
    };
    let text = format!(
        "{}{}{}",
        opts["message"].as_str().unwrap_or(""),
        if opts["detail"].is_string() {
            "\n\n"
        } else {
            ""
        },
        opts["detail"].as_str().unwrap_or("")
    );
    let result = app
        .dialog()
        .message(text)
        .parent(win)
        .title(opts["title"].as_str().unwrap_or("Aropyt"))
        .kind(match opts["type"].as_str() {
            Some("error") => MessageDialogKind::Error,
            Some("warning") => MessageDialogKind::Warning,
            _ => MessageDialogKind::Info,
        })
        .buttons(buttons)
        .blocking_show_with_result();
    let response = match result {
        MessageDialogResult::Custom(s) => labels
            .iter()
            .position(|l| l == &s)
            .unwrap_or(opts["cancelId"].as_u64().unwrap_or(0) as usize),
        MessageDialogResult::Ok | MessageDialogResult::Yes => 0,
        MessageDialogResult::No => 1,
        MessageDialogResult::Cancel => opts["cancelId"]
            .as_u64()
            .map(|v| v as usize)
            .unwrap_or(labels.len().saturating_sub(1)),
    };
    json!({"response":response,"checkboxChecked":false})
}
