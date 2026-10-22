use crate::state::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub fn local_path(s: &str) -> PathBuf {
    if s.starts_with("file:") {
        if let Ok(url) = url::Url::parse(s) {
            if let Ok(p) = url.to_file_path() {
                return p;
            }
        }
    }
    for prefix in [
        "asset://localhost/",
        "http://asset.localhost/",
        "https://asset.localhost/",
    ] {
        if let Some(p) = s.strip_prefix(prefix) {
            return PathBuf::from(
                percent_encoding::percent_decode_str(p)
                    .decode_utf8_lossy()
                    .as_ref(),
            );
        }
    }
    PathBuf::from(s)
}
pub fn abs(p: &str) -> String {
    let p = local_path(p);
    if p.is_absolute() {
        p
    } else {
        std::env::current_dir().unwrap().join(p)
    }
    .to_string_lossy()
    .into()
}
pub fn encoding(name: &str) -> Option<&'static Encoding> {
    match name.to_lowercase().as_str() {
        "utf16le" => Some(UTF_16LE),
        "utf16be" => Some(UTF_16BE),
        "latin1" | "iso-8859-1" => Some(encoding_rs::WINDOWS_1252),
        "win1252" => Some(encoding_rs::WINDOWS_1252),
        other => Encoding::for_label(other.as_bytes()),
    }
}
pub fn read_text(st: &AppState, file: &str, force: Option<&str>) -> Result<Value> {
    let p = local_path(file);
    let bytes = fs::read(&p).map_err(err)?;
    let cached = st.encodings.lock().unwrap().get(file).cloned();
    let enc = if let Some(label) = force.or(cached.as_deref()) {
        encoding(label).ok_or_else(|| format!("{}{label}", crate::i18n::text("未知编码：", "Unknown encoding: ")))?
    } else if let Some((e, _)) = Encoding::for_bom(&bytes) {
        e
    } else {
        let mut detector = chardetng::EncodingDetector::new();
        detector.feed(&bytes, true);
        detector.guess(None, true)
    };
    let (content, _, _) = enc.decode(&bytes);
    let name = if enc == UTF_8 {
        "utf-8".into()
    } else {
        enc.name().to_lowercase()
    };
    st.encodings
        .lock()
        .unwrap()
        .insert(file.into(), name.clone());
    Ok(json!({"content":content.trim_start_matches('\u{feff}'),"encoding":name}))
}
pub fn write_text(st: &AppState, file: &str, content: &str, force: Option<&str>) -> Result<()> {
    let settings = st.config();
    let mut body = content.to_string();
    if settings["insertFinalNewLineOnSave"] == true && !body.is_empty() && !body.ends_with('\n') {
        body.push('\n');
    }
    if settings["trimTrailingWhitespace"] == true {
        body = regex::Regex::new(r"(?m)[ \t]+$")
            .unwrap()
            .replace_all(&body, "")
            .into_owned();
    }
    match settings["lineEndings"].as_str() {
        Some("crlf") => body = body.replace("\r\n", "\n").replace('\n', "\r\n"),
        Some("lf") => body = body.replace("\r\n", "\n"),
        _ => {}
    }
    let cached = st.encodings.lock().unwrap().get(file).cloned();
    let name = force.or(cached.as_deref()).unwrap_or("utf-8");
    let enc = encoding(name).ok_or_else(|| format!("{}{name}", crate::i18n::text("未知编码：", "Unknown encoding: ")))?;
    let bytes = if enc == UTF_16LE {
        body.encode_utf16().flat_map(u16::to_le_bytes).collect()
    } else if enc == UTF_16BE {
        body.encode_utf16().flat_map(u16::to_be_bytes).collect()
    } else {
        let (bytes, _, loss) = enc.encode(&body);
        if loss {
            return Err(if crate::i18n::is_chinese() { format!("内容包含 {name} 无法保存的字符，请使用 UTF-8。") } else { format!("The content contains characters that {name} cannot save. Use UTF-8 instead.") });
        }
        bytes.into_owned()
    };
    atomic_write(&local_path(file), &bytes)?;
    st.encodings
        .lock()
        .unwrap()
        .insert(file.into(), name.into());
    Ok(())
}
pub fn is_markdown(p: &Path) -> bool {
    matches!(
        p.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str(),
        "md" | "markdown" | "mdown" | "mkd" | "mdwn" | "mdtxt" | "mdtext" | "text" | "txt" | "rmd"
    )
}
pub fn stat(p: &Path) -> Result<Value> {
    let s = fs::metadata(p).map_err(err)?;
    Ok(
        json!({"size":s.len(),"mtime":s.modified().ok().and_then(|t|t.duration_since(UNIX_EPOCH).ok()).map(|d|d.as_millis()).unwrap_or(0),"isDir":s.is_dir()}),
    )
}
pub fn read_dir(dir: &Path) -> Result<Vec<Value>> {
    let mut out = vec![];
    for item in fs::read_dir(dir).map_err(err)? {
        let item = item.map_err(err)?;
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        if let Ok(mut v) = stat(&item.path()) {
            v["name"] = json!(name);
            v["path"] = json!(item.path());
            out.push(v);
        }
    }
    out.sort_by(|a, b| {
        b["isDir"]
            .as_bool()
            .cmp(&a["isDir"].as_bool())
            .then(a["name"].as_str().cmp(&b["name"].as_str()))
    });
    Ok(out)
}
pub fn list_markdown(dir: &Path, depth: usize) -> Vec<Value> {
    fn walk(d: &Path, level: usize, max: usize, out: &mut Vec<Value>) {
        if level > max {
            return;
        }
        if let Ok(items) = read_dir(d) {
            for e in items {
                let p = local_path(e["path"].as_str().unwrap());
                if e["isDir"] == true {
                    walk(&p, level + 1, max, out);
                } else if is_markdown(&p) {
                    out.push(e);
                }
            }
        }
    }
    let mut out = vec![];
    walk(dir, 0, depth, &mut out);
    out
}
pub fn mime(p: &Path) -> &'static str {
    match p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "eot" => "application/vnd.ms-fontobject",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}
pub fn data_uri(p: &Path) -> Result<String> {
    Ok(format!(
        "data:{};base64,{}",
        mime(p),
        B64.encode(fs::read(p).map_err(err)?)
    ))
}
pub fn inline_css(css: &str, directory: &Path) -> String {
    let re = regex::Regex::new(r#"url\(\s*['"]?([^'"\)]+)['"]?\s*\)"#).unwrap();
    re.replace_all(css, |c: &regex::Captures| {
        let src = c[1].trim();
        if src.starts_with("data:")
            || src.starts_with("http:")
            || src.starts_with("https:")
            || src.starts_with('#')
        {
            return c[0].into();
        }
        let p = if src.starts_with("file:") {
            local_path(src)
        } else {
            directory.join(
                percent_encoding::percent_decode_str(src.split(['?', '#']).next().unwrap())
                    .decode_utf8_lossy()
                    .as_ref(),
            )
        };
        format!(
            "url(\"{}\")",
            data_uri(&p).unwrap_or_else(|_| "data:,".into())
        )
    })
    .into_owned()
}
pub fn themes(st: &AppState) -> Vec<Value> {
    let mut result = vec![];
    for (dir, builtin) in [
        (st.resources.join("resources/styles/themes"), true),
        (st.data.join("themes"), false),
    ] {
        if let Ok(entries) = fs::read_dir(dir) {
            for e in entries.flatten() {
                if e.path().extension().is_some_and(|s| s == "css") {
                    let name = e.path().file_stem().unwrap().to_string_lossy().into_owned();
                    if !result.iter().any(|v: &Value| v["name"] == name) {
                        result.push(json!({"name":name,"path":e.path(),"builtin":builtin}));
                    }
                }
            }
        }
    }
    result.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    result
}
pub fn theme_css(st: &AppState, name: &str) -> String {
    themes(st)
        .iter()
        .find(|v| v["name"] == name)
        .and_then(|v| v["path"].as_str())
        .and_then(|p| {
            fs::read_to_string(p)
                .ok()
                .map(|s| inline_css(&s, Path::new(p).parent().unwrap()))
        })
        .unwrap_or_default()
}
pub fn search(st: &AppState, dir: &Path, query: &str, opts: &Value) -> Value {
    if query.is_empty() {
        return json!([]);
    }
    let pat = if opts["regex"] == true {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pat = if opts["wholeWord"] == true {
        format!(r"\b(?:{pat})\b")
    } else {
        pat
    };
    let Ok(re) = regex::RegexBuilder::new(&pat)
        .case_insensitive(opts["caseSensitive"] != true)
        .build()
    else {
        return json!([]);
    };
    let mut hits = vec![];
    for e in list_markdown(dir, 4) {
        if hits.len() > 500 {
            break;
        }
        if e["size"].as_u64().unwrap_or(0) > 2_000_000 {
            continue;
        }
        let f = e["path"].as_str().unwrap();
        if let Ok(v) = read_text(st, f, None) {
            for (line, text) in v["content"].as_str().unwrap().lines().enumerate() {
                if let Some(m) = re.find(text) {
                    hits.push(json!({"file":f,"line":line,"text":text.chars().take(300).collect::<String>(),"start":text[..m.start()].encode_utf16().count(),"end":text[..m.end()].encode_utf16().count()}));
                    if hits.len() > 500 {
                        break;
                    }
                }
            }
        }
    }
    json!(hits)
}
