use std::sync::atomic::{AtomicBool, Ordering};

// The interface preference is application-wide. The webview supplies the OS
// locale on startup so automatic mode agrees with every renderer window.
static CHINESE: AtomicBool = AtomicBool::new(false);
static SYSTEM_CHINESE: AtomicBool = AtomicBool::new(false);

pub fn configure(preference: &str, locale: Option<&str>) {
    if let Some(locale) = locale {
        SYSTEM_CHINESE.store(locale.to_ascii_lowercase().starts_with("zh"), Ordering::Relaxed);
    }
    CHINESE.store(match preference {
        "zh" => true,
        "en" => false,
        _ => SYSTEM_CHINESE.load(Ordering::Relaxed),
    }, Ordering::Relaxed);
}

pub fn is_chinese() -> bool { CHINESE.load(Ordering::Relaxed) }

pub fn text<'a>(zh: &'a str, en: &'a str) -> &'a str {
    if is_chinese() { zh } else { en }
}

// External tool and OS diagnostics are preserved verbatim after a localized
// application message. In particular, never translate embedded user paths.
pub fn external_error(message: &str) -> String {
    let detail = message.strip_prefix("操作失败：")
        .or_else(|| message.strip_prefix("Operation failed: ")).unwrap_or(message);
    format!("{}{}", text("操作失败：", "Operation failed: "), detail)
}

// Native rendering returns these fixed messages through the C callback. Do
// not translate arbitrary NSError text, file names, or external tool output.
pub fn native_error(message: &str) -> String {
    match message {
        "PDF 导出失败" => text("PDF 导出失败", "PDF export failed"),
        "图片导出失败" => text("图片导出失败", "Image export failed"),
        "文档太长，无法导出为单张图片，请导出为 PDF" => text("文档太长，无法导出为单张图片，请导出为 PDF", "The document is too long for a single image. Export it as PDF instead."),
        _ => return external_error(message),
    }.into()
}
