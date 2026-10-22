use crate::state::*;
#[cfg(target_os = "macos")]
use std::{
    ffi::{c_char, c_void, CStr, CString},
    sync::mpsc,
    time::Duration,
};
use tauri::{AppHandle, WebviewWindow};
pub static HOST: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
#[cfg(not(target_os = "macos"))]
#[path = "portable_export.rs"]
mod portable_export;
#[cfg(target_os = "macos")]
extern "C" {
    fn aropyt_render(
        html: *const c_char,
        mode: *const c_char,
        width: f64,
        height: f64,
        paper_width: f64,
        paper_height: f64,
        margin: f64,
        callback: extern "C" fn(*mut c_void, *const u8, usize, *const c_char),
        context: *mut c_void,
    );
    fn aropyt_window(window: *mut c_void, action: *const c_char, other: *mut c_void);
}
#[cfg(target_os = "macos")]
extern "C" fn completed(context: *mut c_void, data: *const u8, len: usize, error: *const c_char) {
    let tx: Box<mpsc::Sender<Result<Vec<u8>>>> = unsafe { Box::from_raw(context.cast()) };
    let value = if !error.is_null() {
        Err(unsafe { CStr::from_ptr(error) }.to_string_lossy().into())
    } else if data.is_null() {
        Ok(vec![])
    } else {
        Ok(unsafe { std::slice::from_raw_parts(data, len) }.to_vec())
    };
    let _ = tx.send(value);
}
pub fn render(
    html: &str,
    mode: &str,
    width: f64,
    height: f64,
    settings: &serde_json::Value,
) -> Result<Vec<u8>> {
    #[cfg(target_os = "macos")]
    {
        let html = CString::new(html).map_err(err)?;
        let mode = CString::new(mode).map_err(err)?;
        let (pw, ph) = match settings["exportPaperSize"].as_str().unwrap_or("A4") {
            "A3" => (841.89, 1190.55),
            "A5" => (419.53, 595.28),
            "Letter" | "US Letter" => (612., 792.),
            "Legal" | "US Legal" => (612., 1008.),
            "Tabloid" => (792., 1224.),
            _ => (595.28, 841.89),
        };
        let margin = settings["exportMargin"].as_f64().unwrap_or(18.).max(0.) * 72. / 25.4;
        let (tx, rx) = mpsc::channel();
        let context = Box::into_raw(Box::new(tx)).cast();
        unsafe {
            aropyt_render(
                html.as_ptr(),
                mode.as_ptr(),
                width,
                height,
                pw,
                ph,
                margin,
                completed,
                context,
            );
        }
        rx.recv_timeout(Duration::from_secs(180)).map_err(err)?
    }
    #[cfg(not(target_os = "macos"))]
    {
        portable_export::render(
            HOST.get().ok_or("原生导出未初始化")?,
            html,
            mode,
            width,
            height,
            settings,
        )
    }
}
pub fn window(win: &WebviewWindow, action: &str, other: Option<&WebviewWindow>) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let ptr = win.ns_window().map_err(err)?;
        let other = other
            .map(|w| w.ns_window())
            .transpose()
            .map_err(err)?
            .unwrap_or(std::ptr::null_mut());
        let a = CString::new(action).map_err(err)?;
        unsafe {
            aropyt_window(ptr, a.as_ptr(), other);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (win, action, other);
    }
    Ok(())
}
// X11 selection ownership lasts as long as the Clipboard instance. Reuse it
// for all operations instead of dropping the owner immediately after a write.
static CLIPBOARD: std::sync::Mutex<Option<arboard::Clipboard>> = std::sync::Mutex::new(None);
pub fn clipboard<T>(operation: impl FnOnce(&mut arboard::Clipboard) -> Result<T>) -> Result<T> {
    let mut owner = CLIPBOARD.lock().map_err(err)?;
    if owner.is_none() {
        *owner = Some(arboard::Clipboard::new().map_err(err)?);
    }
    operation(owner.as_mut().unwrap())
}
