use crate::i18n::text as tr;
use crate::{dialogs, files::*, native, state::*};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_opener::OpenerExt;
pub fn bytes(source: &str) -> Result<Vec<u8>> {
    if source.starts_with("data:") {
        let (head, body) = source.split_once(',').ok_or(tr("图片数据无效", "Invalid image data"))?;
        return if head.contains(";base64") {
            B64.decode(body).map_err(err)
        } else {
            Ok(percent_encoding::percent_decode_str(body).collect())
        };
    }
    if source.starts_with("http:") || source.starts_with("https:") {
        return reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(err)?
            .get(source)
            .send()
            .map_err(err)?
            .error_for_status()
            .map_err(err)?
            .bytes()
            .map(|b| b.to_vec())
            .map_err(err);
    }
    fs::read(local_path(source)).map_err(err)
}
pub fn directory(settings: &Value, document: Option<&str>) -> Option<PathBuf> {
    let doc = Path::new(document?);
    let parent = doc.parent()?;
    match settings["actionWhenInsertImage"].as_str().unwrap_or("none") {
        "fileAssets" => Some(parent.join(format!("{}.assets", doc.file_stem()?.to_string_lossy()))),
        "assets" => Some(parent.join("assets")),
        "custom" => Some(parent.join(settings["imageCustomFolder"].as_str().unwrap_or("assets"))),
        "copy" => Some(parent.into()),
        _ => None,
    }
}
pub fn reference(st: &AppState, target: &Path, doc: Option<&str>, escape: bool) -> String {
    let s = st.config();
    let absolute = || url::Url::from_file_path(target).unwrap().to_string();
    if doc.is_none() || s["relativePathWithDot"] == false {
        return absolute();
    }
    let Some(relative) = pathdiff::diff_paths(
        target,
        Path::new(doc.unwrap()).parent().unwrap_or(Path::new(".")),
    ) else {
        return absolute();
    };
    if relative.is_absolute() {
        return absolute();
    }
    let mut path = relative.to_string_lossy().replace('\\', "/");
    if s["addDotSlash"] == true && !path.starts_with('.') {
        path = "./".to_string() + &path;
    }
    if escape {
        path.split('/')
            .map(|part| {
                percent_encoding::utf8_percent_encode(part, percent_encoding::NON_ALPHANUMERIC)
                    .to_string()
                    .replace("%2E", ".")
                    .replace("%2D", "-")
                    .replace("%5F", "_")
                    .replace("%7E", "~")
                    .replace("%21", "!")
                    .replace("%27", "'")
                    .replace("%2A", "*")
            })
            .collect::<Vec<_>>()
            .join("/")
    } else {
        path
    }
}
fn name(source: &str) -> String {
    if source.starts_with("data:") {
        return tr("图片.png", "image.png").into();
    }
    if let Ok(url) = url::Url::parse(source) {
        if url.scheme() == "http" || url.scheme() == "https" {
            return Path::new(url.path())
                .file_name()
                .map(|s| {
                    percent_encoding::percent_decode_str(&s.to_string_lossy())
                        .decode_utf8_lossy()
                        .into_owned()
                })
                .unwrap_or(tr("图片.png", "image.png").into());
        }
    }
    local_path(source)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or(tr("图片.png", "image.png").into())
}
fn unique(target: PathBuf, input: Option<&Path>) -> PathBuf {
    if target.exists() && input != Some(target.as_path()) {
        target.parent().unwrap().join(format!(
            "{}-{}",
            &uuid::Uuid::new_v4().to_string()[..8],
            target.file_name().unwrap().to_string_lossy()
        ))
    } else {
        target
    }
}
fn upload_files(st: &AppState, files: &[String]) -> Result<Vec<String>> {
    let settings = st.config();
    let uploader = settings["imageUploader"].as_str().unwrap_or("none");
    if uploader == "picgoApp" || uploader == "piclist" {
        let response = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(err)?
            .post(
                settings["imageUploadEndpoint"]
                    .as_str()
                    .unwrap_or("http://127.0.0.1:36677/upload"),
            )
            .json(&json!({"list":files}))
            .send()
            .map_err(err)?
            .error_for_status()
            .map_err(err)?
            .json::<Value>()
            .map_err(err)?;
        if response["success"] == false || !response["result"].is_array() {
            return Err(format!("{}{}", tr("图片上传失败。", "Image upload failed."), response["message"]
                .as_str().filter(|message| !message.is_empty())
                .map(|message| format!("\n{message}"))
                .unwrap_or_else(|| format!("\n{}", tr("图床程序未返回图片地址", "The image uploader did not return an image URL")))));
        }
        return Ok(response["result"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect());
    }
    let command = settings["imageUploadCommand"]
        .as_str()
        .unwrap_or(if uploader == "picgoCore" {
            "picgo upload"
        } else {
            ""
        });
    let parts = shlex::split(command).ok_or(tr("上传命令无效", "Invalid upload command"))?;
    if parts.is_empty() {
        return Err(tr("请在偏好设置 → 图像中选择图床并配置上传命令。", "Select an image uploader and configure its upload command in Preferences → Images.").into());
    }
    let output = crate::conversion::execute(
        &parts[0],
        &parts[1..]
            .iter()
            .cloned()
            .chain(files.iter().cloned())
            .collect::<Vec<_>>(),
        None,
    )?;
    let urls: Vec<String> = regex::Regex::new(r#"https?://[^\s\"<>]+"#)
        .unwrap()
        .find_iter(&output)
        .map(|m| m.as_str().to_string())
        .collect();
    if urls.len() < files.len() {
        return Err(tr("上传命令没有为每张图片返回地址。", "The upload command did not return a URL for every image.").into());
    }
    Ok(urls[urls.len() - files.len()..].to_vec())
}
fn upload(st: &AppState, sources: &[String]) -> Result<Vec<String>> {
    let temp = tempfile::tempdir_in(&st.data).map_err(err)?;
    let mut files = vec![];
    for (n, source) in sources.iter().enumerate() {
        if source.starts_with("data:")
            || source.starts_with("http:")
            || source.starts_with("https:")
        {
            let p = temp.path().join(format!("image-{n}-{}", name(source)));
            fs::write(&p, bytes(source)?).map_err(err)?;
            files.push(p.to_string_lossy().into_owned());
        } else {
            files.push(local_path(source).to_string_lossy().into_owned());
        }
    }
    let urls = upload_files(st, &files)?;
    if urls.len() != sources.len()
        || urls
            .iter()
            .any(|u| !(u.starts_with("https://") || u.starts_with("http://")))
    {
        return Err(tr("图床返回的图片地址不完整", "The image uploader returned incomplete image URLs").into());
    }
    Ok(urls)
}
pub fn write_clipboard_image(data: &[u8], settings: &Value) -> Result<()> {
    let data = if String::from_utf8_lossy(&data[..data.len().min(4096)]).contains("<svg") {
        native::render(&format!("<html><body style='margin:0'><img src='data:image/svg+xml;base64,{}'></body></html>",B64.encode(data)),"png",1000.,800.,settings)?
    } else {
        data.to_vec()
    };
    let image = image::load_from_memory(&data).map_err(err)?.to_rgba8();
    let (width, height) = image.dimensions();
    native::clipboard(|clipboard| {
        clipboard
            .set_image(arboard::ImageData {
                width: width as usize,
                height: height as usize,
                bytes: std::borrow::Cow::Owned(image.into_raw()),
            })
            .map_err(err)
    })
}
pub fn handle(app: &AppHandle, win: &WebviewWindow, method: &str, args: &[Value]) -> Result<Value> {
    let st = app.state::<AppState>();
    let s = st.config();
    let source = || args.first().and_then(Value::as_str).unwrap_or("");
    match method{
        "images.pickLocal"=>Ok(dialogs::open(app,win,&json!({"properties":["openFile","multiSelections"],"filters":[{"name":tr("图片", "Images"),"extensions":["png","jpg","jpeg","gif","svg","webp","bmp","tiff"]}]}))["filePaths"].clone()),
        "images.saveClipboard"=>{let image=native::clipboard(|clipboard|clipboard.get_image().map(|image|(image.width,image.height,image.bytes.into_owned())).map_err(err));let Ok((width,height,bytes))=image else{return Ok(Value::Null)};let p=st.data.join("pasted-images").join(format!("{}.png",uuid::Uuid::new_v4()));fs::create_dir_all(p.parent().unwrap()).map_err(err)?;image::save_buffer_with_format(&p,&bytes,width as u32,height as u32,image::ColorType::Rgba8,image::ImageFormat::Png).map_err(err)?;Ok(json!(p))},
        "images.prepare"=>{let sources:Vec<String>=args[0].as_array().ok_or(tr("图片列表无效", "Invalid image list"))?.iter().filter_map(|v|v.as_str().map(String::from)).collect();let doc=args.get(1).and_then(Value::as_str);let force=args.get(2)==Some(&json!(true));let action=if force{"upload"}else{s["actionWhenInsertImage"].as_str().unwrap_or("none")};
            let eligible:Vec<String>=if action=="upload"{sources.iter().filter(|v|force||if v.starts_with("http:")||v.starts_with("https:")||v.starts_with("data:"){s["applyRulesToOnline"]==true}else{s["applyRulesToLocal"]!=false}).cloned().collect()}else{vec![]};let urls=if eligible.is_empty(){vec![]}else{upload(&st,&eligible)?};let mut result=vec![];
            for input in sources{if let Some(n)=eligible.iter().position(|v|v==&input){result.push(urls[n].clone());continue;}let local=!(input.starts_with("http:")||input.starts_with("https:")||input.starts_with("data:"));let mut target=if local{local_path(&input).to_string_lossy().into_owned()}else{input.clone()};
                if doc.is_some()&&action!="none"&&action!="upload"&&if local{s["applyRulesToLocal"]!=false}else{s["applyRulesToOnline"]==true}{let dir=directory(&s,doc).unwrap_or_else(||Path::new(doc.unwrap()).parent().unwrap().into());fs::create_dir_all(&dir).map_err(err)?;let p=unique(dir.join(name(&input)),if local{Some(Path::new(&target))}else{None});if !local||p!=local_path(&input){fs::write(&p,bytes(&input)?).map_err(err)?;}target=p.to_string_lossy().into_owned();}
                if !(target.starts_with("http:")||target.starts_with("https:")||target.starts_with("data:")){target=reference(&st,Path::new(&target),doc,s["autoEscapeImageURL"]!=false);}if s["autoEscapeImageURL"]!=false{target=target.replace(' ',"%20").replace('(',"%28").replace(')',"%29");}result.push(target);
            }Ok(json!(result))},
        "images.copyImage"=>{write_clipboard_image(&bytes(source())?,&s)?;Ok(json!(true))},
        "images.open"=>{app.opener().open_path(local_path(source()).to_string_lossy(),None::<&str>).map_err(err)?;Ok(json!(true))},
        "images.reveal"=>{app.opener().reveal_item_in_dir(local_path(source())).map_err(err)?;Ok(json!(true))},
        "images.target"=>{let doc=args.get(1).and_then(Value::as_str);let dir=directory(&s,doc);Ok(dir.filter(|d|local_path(source()).parent()!=Some(d.as_path())).map(|d|json!(d.file_name().unwrap().to_string_lossy())).unwrap_or(Value::Null))},
        "images.transfer"=>{let mode=args[1].as_str().unwrap_or("");if !["copy","move","copy-target","move-target"].contains(&mode){return Err(tr("无效的图片操作", "Invalid image operation").into());}let moving=mode.starts_with("move");let local=source().starts_with("file:")||source().starts_with("asset:")||Path::new(source()).is_absolute();if moving&&!local{return Err(tr("只能移动本地图片", "Only local images can be moved").into());}let doc=args.get(2).and_then(Value::as_str);
            let target=if mode.ends_with("-target"){let dir=directory(&s,doc).ok_or(tr("请先设置图片存储目录", "Set an image storage folder first"))?;fs::create_dir_all(&dir).map_err(err)?;{let input=local_path(source());unique(dir.join(name(source())),if local{Some(input.as_path())}else{None})}}else{let picked=dialogs::save(app,win,&json!({"defaultPath":if local{local_path(source()).to_string_lossy().into_owned()}else{name(source())}}));if picked["canceled"]==true{return Ok(Value::Null);}local_path(picked["filePath"].as_str().unwrap())};
            if !local||target!=local_path(source()){atomic_write(&target,&bytes(source())?)?;if moving{fs::remove_file(local_path(source())).map_err(err)?;}}Ok(json!(reference(&st,&target,doc,true)))},
        "images.trash"=>{trash::delete(local_path(source())).map_err(err)?;Ok(json!(true))},
        "media.output"=>{let media=&args[0];let action=args[1].as_str().unwrap_or("");let svg=media["svg"].as_str().filter(|s|s.starts_with("<svg")).ok_or(tr("媒体数据无效", "Invalid media data"))?;if !["copy","save"].contains(&action){return Err(tr("无效的媒体操作", "Invalid media operation").into());}let target=if action=="save"{let pick=dialogs::save(app,win,&json!({"defaultPath":tr("图表.svg", "diagram.svg"),"filters":[{"name":"SVG","extensions":["svg"]},{"name":"PNG","extensions":["png"]}]}));if pick["canceled"]==true{return Ok(json!(false));}Some(local_path(pick["filePath"].as_str().unwrap()))}else{None};if let Some(p)=&target{if p.extension().is_some_and(|e|e=="svg"){atomic_write(p,svg.as_bytes())?;return Ok(json!(true));}}
            let png=native::render(&format!("<html><body style='margin:0;background:white'>{svg}</body></html>"),"png",media["width"].as_f64().unwrap_or(1000.).clamp(1.,8192.),media["height"].as_f64().unwrap_or(800.).clamp(1.,8192.),&s)?;
            if let Some(p)=target{atomic_write(&p,&png)?;}else{write_clipboard_image(&png,&s)?;}Ok(json!(true))},
        "images.testUploader"=>{let temp=tempfile::tempdir_in(&st.data).map_err(err)?;let p=temp.path().join("test.png");fs::write(&p,B64.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==").unwrap()).map_err(err)?;Ok(json!({"ok":true,"urls":upload_files(&st,&[p.to_string_lossy().into_owned()])?}))},
        _=>Err(format!("{}{method}", tr("未知图片操作：", "Unknown image operation: ")))
    }
}
