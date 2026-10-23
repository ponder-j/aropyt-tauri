use crate::{i18n::text as tr, state::*, send};
use serde_json::{json, Value};
use std::{sync::{atomic::{AtomicBool, Ordering}, Mutex}, time::Duration};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Updates {
    startup_claimed: AtomicBool,
    pending: Mutex<Option<(String, Update, Option<Vec<u8>>)>>,
}

// Runs on the bridge's blocking worker; no UI thread or document lock is held
// while querying GitHub, downloading, or waiting for a save dialog.
pub fn dispatch(app: &AppHandle, win: &WebviewWindow, method: &str) -> Result<Value> {
    let state = app.state::<Updates>();
    if method == "update.claimStartup" {
        let enabled = cfg!(target_os = "windows") && !cfg!(debug_assertions)
            && !crate::testing::isolated();
        return Ok(json!(enabled && !state.startup_claimed.swap(true, Ordering::SeqCst)));
    }
    if !cfg!(target_os = "windows") {
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
            let install_dir = std::env::current_exe().map_err(err)?.parent().ok_or("Missing executable directory")?.to_path_buf();
            let updater = app.updater_builder().installer_arg(format!("/D={}", install_dir.display()))
                .timeout(Duration::from_secs(20)).build().map_err(err)?;
            let update = tauri::async_runtime::block_on(updater.check()).map_err(err)?;
            let info = update.as_ref().map(|u| json!({"version":u.version,"currentVersion":u.current_version,"body":u.body}));
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
            update.install(bytes).map_err(err)?;
            Ok(json!(true))
        }
        "update.clear" => { *pending = None; Ok(json!(true)) }
        _ => Err("Unknown update command".into()),
    }
}

// Only the authenticated, isolated regression harness can stage a synthetic
// newer manifest. Signature verification is still the real plugin verifier.
pub fn test_fixture(app: &AppHandle, win: &WebviewWindow, manifest: Value, file: &str, stage: bool) -> Result<Value> {
    if !crate::testing::isolated() { return Err("Update fixture requires an isolated test profile".into()); }
    let builder = app.updater_builder().installer_args(["/NS".to_string(), format!("/D={}", std::env::current_exe().map_err(err)?.parent().ok_or("Missing executable directory")?.display())]);
    // Permit a same-version reinstall only in this isolated test entry point.
    // Keep the signed version unchanged: updater signatures bind the version.
    let builder = if stage { builder.version_comparator(|_, _| true) } else { builder };
    let updater = builder.build().map_err(err)?;
    let update = updater.restore_update(manifest).map_err(err)?;
    let Some(update) = update else { return Ok(Value::Null); };
    let bytes = std::fs::read(file).map_err(err)?;
    update.verify(&bytes).map_err(err)?;
    let result = json!({"version":update.version,"verified":true,"size":bytes.len()});
    if stage { *app.state::<Updates>().pending.lock().unwrap() = Some((win.label().to_string(), update, Some(bytes))); }
    Ok(result)
}
