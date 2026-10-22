use crate::{files::*, state::*};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::{fs, io::Read, path::Path};
pub fn manifest() -> Value {
    serde_json::from_str(include_str!("../../resources/dictionaries.json")).unwrap()
}
pub fn valid_language(code: &str) -> bool {
    manifest()["languages"].get(code).is_some()
}
pub fn exists(st: &AppState, lang: &str) -> bool {
    valid_language(lang)
        && ["aff", "dic"].iter().all(|e| {
            st.data
                .join(format!("dictionaries/{lang}/index.{e}.gz"))
                .is_file()
        })
}
pub fn read(st: &AppState, lang: &str) -> Result<Value> {
    if !exists(st, lang) {
        return Err(format!("尚未安装 {lang} 拼写词典"));
    }
    let mut result = vec![];
    for ext in ["aff", "dic"] {
        let file = fs::File::open(st.data.join(format!("dictionaries/{lang}/index.{ext}.gz")))
            .map_err(err)?;
        let mut bytes = vec![];
        GzDecoder::new(file).read_to_end(&mut bytes).map_err(err)?;
        result.push(B64.encode(bytes));
    }
    Ok(json!(result))
}
fn normalize(bytes: Vec<u8>, encoding_name: &str, aff: bool) -> Result<Vec<u8>> {
    if encoding_name.eq_ignore_ascii_case("UTF-8") {
        return Ok(bytes);
    }
    let enc = encoding(encoding_name).ok_or("不支持的词典编码")?;
    let (text, _, loss) = enc.decode(&bytes);
    if loss {
        return Err("词典编码无效".into());
    }
    let text = if aff {
        regex::Regex::new(r"(?m)^SET\s+[^\r\n]+")
            .unwrap()
            .replace(&text, "SET UTF-8")
            .into_owned()
    } else {
        text.into_owned()
    };
    Ok(text.into_bytes())
}
fn write_pack(st: &AppState, lang: &str, aff: &[u8], dic: &[u8], license: &str) -> Result<()> {
    if !valid_language(lang) {
        return Err("未知词典语言".into());
    }
    let root = st.data.join("dictionaries");
    fs::create_dir_all(&root).map_err(err)?;
    let temp = tempfile::tempdir_in(&root).map_err(err)?;
    for (ext, bytes) in [("aff", aff), ("dic", dic)] {
        let mut zip = GzEncoder::new(Vec::new(), Compression::best());
        zip.write_all(bytes).map_err(err)?;
        fs::write(
            temp.path().join(format!("index.{ext}.gz")),
            zip.finish().map_err(err)?,
        )
        .map_err(err)?;
    }
    fs::write(temp.path().join("LICENSE"), license).map_err(err)?;
    let target = root.join(lang);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(err)?;
    }
    fs::rename(temp.path(), target).map_err(err)?;
    Ok(())
}
pub fn install(st: &AppState, lang: &str) -> Result<Value> {
    let manifest = manifest();
    let item = &manifest["languages"][lang];
    if item.is_null() {
        return Err("未知词典语言".into());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(err)?;
    let mut files = vec![];
    for ext in ["aff", "dic"] {
        let info = &item["files"][ext];
        let bytes = client
            .get(info["url"].as_str().unwrap())
            .send()
            .map_err(err)?
            .error_for_status()
            .map_err(err)?
            .bytes()
            .map_err(err)?;
        if bytes.len() > 60_000_000 {
            return Err("词典文件过大".into());
        }
        let bytes = normalize(
            bytes.to_vec(),
            item["encoding"].as_str().unwrap_or("UTF-8"),
            ext == "aff",
        )?;
        let hash = format!("{:x}", Sha256::digest(&bytes));
        if hash != info["sha256"].as_str().unwrap() {
            return Err(format!("{lang}.{ext} 校验失败，未安装词典。"));
        }
        files.push(bytes);
    }
    write_pack(
        st,
        lang,
        &files[0],
        &files[1],
        item["license"].as_str().unwrap_or(""),
    )?;
    Ok(json!({"installed":true,"language":lang}))
}
pub fn import(st: &AppState, lang: &str, aff: &Path, dic: &Path) -> Result<Value> {
    let aff_bytes = fs::read(aff).map_err(err)?;
    let head = String::from_utf8_lossy(&aff_bytes);
    let enc = regex::Regex::new(r"(?m)^SET\s+(\S+)")
        .unwrap()
        .captures(&head)
        .map(|c| c[1].to_string())
        .unwrap_or("UTF-8".into());
    let aff = normalize(aff_bytes, &enc, true)?;
    let dic = normalize(fs::read(dic).map_err(err)?, &enc, false)?;
    if !String::from_utf8_lossy(&aff).contains("SET ")
        || String::from_utf8_lossy(&dic)
            .lines()
            .next()
            .and_then(|s| s.trim().parse::<usize>().ok())
            .is_none()
    {
        return Err("请选择有效的 Hunspell .aff 和 .dic 文件。".into());
    }
    write_pack(st, lang, &aff, &dic, "User imported Hunspell dictionary")?;
    Ok(json!({"installed":true,"language":lang}))
}
pub fn users(st: &AppState) -> Value {
    let file = st.data.join("conf/user-dict.json");
    if let Ok(raw) = fs::read(&file) {
        if let Ok(v) = serde_json::from_slice::<Value>(&raw) {
            if v.is_object() {
                return v;
            }
        }
    }
    let legacy = st.data.join("conf/user-dict.txt");
    if let Ok(raw) = fs::read_to_string(legacy) {
        return json!({"en-US":raw.lines().filter(|s|!s.is_empty()).collect::<Vec<_>>()});
    }
    json!({})
}
pub fn learn(st: &AppState, lang: &str, word: &str, remove: bool) -> Result<Value> {
    let mut value = users(st);
    let mut words: Vec<Value> = value[lang]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|w| w.as_str() != Some(word))
        .collect();
    if !remove {
        words.push(json!(word));
    }
    words.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    value[lang] = json!(words);
    atomic_write(
        &st.data.join("conf/user-dict.json"),
        &serde_json::to_vec_pretty(&value).map_err(err)?,
    )?;
    Ok(value)
}
pub fn detect(text: &str, environment: &str) -> String {
    use cld2_sys::*;
    use std::ffi::{CStr, CString};
    let hint = CString::new(environment).ok();
    let hints = CLDHints {
        content_language_hint: hint.as_ref().map_or(std::ptr::null(), |s| s.as_ptr()),
        tld_hint: std::ptr::null(),
        encoding_hint: 0,
        language_hint: Language::UNKNOWN_LANGUAGE,
    };
    let mut languages = [Language::UNKNOWN_LANGUAGE; 3];
    let mut percentages = [0; 3];
    let mut scores = [0.; 3];
    let mut count = 0;
    let mut reliable = false;
    // c_char is unsigned on Linux ARM and signed on macOS. Let the FFI
    // signature infer its pointer type instead of hard-coding i8.
    let language = unsafe {
        CLD2_ExtDetectLanguageSummary4(
            text.as_ptr().cast(),
            text.len().min(i32::MAX as usize) as i32,
            true,
            &hints,
            0,
            languages.as_mut_ptr(),
            percentages.as_mut_ptr(),
            scores.as_mut_ptr(),
            std::ptr::null_mut(),
            &mut count,
            &mut reliable,
        )
    };
    if reliable && percentages[0] >= 85 && language != Language::UNKNOWN_LANGUAGE {
        let code = unsafe { CLD2_LanguageCode(language) };
        if !code.is_null() {
            return unsafe { CStr::from_ptr(code) }
                .to_string_lossy()
                .into_owned();
        }
    }
    environment.into()
}
