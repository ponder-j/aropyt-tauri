use crate::{dialogs, files::*, images, native, state::*};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewWindow};
use wait_timeout::ChildExt;
pub fn formats() -> Value {
    json!({"docx":{"writer":"docx","extension":"docx","name":"Word"},"odt":{"writer":"odt","extension":"odt","name":"OpenOffice"},"latex":{"writer":"latex","extension":"tex","name":"LaTeX"},"epub":{"writer":"epub3","extension":"epub","name":"Epub"},"rtf":{"writer":"rtf","extension":"rtf","name":"RTF"},"mediawiki":{"writer":"mediawiki","extension":"wiki","name":"MediaWiki"},"rst":{"writer":"rst","extension":"rst","name":"reStructuredText"},"textile":{"writer":"textile","extension":"textile","name":"Textile"},"opml":{"writer":"opml","extension":"opml","name":"OPML"}})
}
pub fn execute(binary: &str, args: &[String], input: Option<String>) -> Result<String> {
    let mut command = Command::new(binary);
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "未找到程序，请在偏好设置中配置完整路径：".to_string() + binary
        } else {
            err(e)
        }
    })?;
    let mut stdin = child.stdin.take().unwrap();
    let write = std::thread::spawn(move || {
        if let Some(input) = input {
            let _ = stdin.write_all(input.as_bytes());
        }
    });
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let out = std::thread::spawn(move || {
        let mut bytes = vec![];
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let errors = std::thread::spawn(move || {
        let mut bytes = vec![];
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });
    let status = child.wait_timeout(Duration::from_secs(120)).map_err(err)?;
    if status.is_none() {
        let _ = child.kill();
        let _ = child.wait();
        return Err("转换程序超时".into());
    }
    let _ = write.join();
    let out = out.join().map_err(|_| "输出读取失败")?;
    let errors = errors.join().map_err(|_| "错误输出读取失败")?;
    if !status.unwrap().success() {
        return Err(String::from_utf8_lossy(&errors).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
}
fn binary(st: &AppState) -> String {
    let settings = st.config();
    if let Some(p) = settings["pandocPath"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
    {
        return p.into();
    }
    for p in [
        "/opt/homebrew/bin/pandoc",
        "/usr/local/bin/pandoc",
        "/usr/bin/pandoc",
    ] {
        if Path::new(p).is_file() {
            return p.into();
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let p = Path::new(&local).join("Pandoc/pandoc.exe");
        if p.exists() {
            return p.to_string_lossy().into();
        }
    }
    "pandoc".into()
}
pub fn pandoc(st: &AppState, args: Vec<String>, input: Option<String>) -> Result<String> {
    execute(&binary(st), &args, input)
}
pub fn default_path(st: &AppState, file: Option<&str>, name: &str) -> String {
    let settings = st.config();
    let dir = if settings["exportFolder"] == "custom" {
        settings["exportCustomFolder"].as_str().map(PathBuf::from)
    } else {
        file.and_then(|f| Path::new(f).parent().map(PathBuf::from))
    };
    dir.map(|d| d.join(name).to_string_lossy().into_owned())
        .unwrap_or_else(|| name.into())
}
fn files_svg_size(svg: &str) -> (f64, f64) {
    let view = attrs(svg, "viewBox")
        .map(|v| {
            v.split_whitespace()
                .filter_map(|s| s.parse::<f64>().ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let width = attrs(svg, "width")
        .and_then(|s| s.parse().ok())
        .or_else(|| view.get(2).copied())
        .unwrap_or(1000.);
    let height = attrs(svg, "height")
        .and_then(|s| s.parse().ok())
        .or_else(|| view.get(3).copied())
        .unwrap_or(800.);
    (width.max(1.), height.max(1.))
}
fn attrs(tag: &str, name: &str) -> Option<String> {
    let pat = format!(r#"(?i)\b{}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#, name);
    let re = regex::Regex::new(&pat).ok()?;
    let c = re.captures(tag)?;
    c.get(1)
        .or(c.get(2))
        .or(c.get(3))
        .map(|v| v.as_str().into())
}
fn image_node(tag: &str, directory: &Path) -> Result<Value> {
    let src = attrs(tag, "src").unwrap_or_default();
    let alt = attrs(tag, "alt").unwrap_or_default();
    let title = attrs(tag, "title").unwrap_or_default();
    let path = if src.starts_with("file:") {
        local_path(&src)
    } else {
        directory.join(
            percent_encoding::percent_decode_str(&src)
                .decode_utf8_lossy()
                .as_ref(),
        )
    };
    let mut dimensions = vec![];
    let data = images::bytes(
        if src.starts_with("http:") || src.starts_with("https:") || src.starts_with("data:") {
            &src
        } else {
            path.to_str().unwrap_or("")
        },
    )
    .ok();
    let natural = data.and_then(|d| {
        image::load_from_memory(&d)
            .ok()
            .map(|i| (i.width() as f64, i.height() as f64))
            .or_else(|| {
                let text = String::from_utf8_lossy(&d);
                Some((
                    attrs(&text, "width")?.parse().ok()?,
                    attrs(&text, "height")?.parse().ok()?,
                ))
            })
    });
    if let Some((nw, nh)) = natural {
        let style = attrs(tag, "style").unwrap_or_default();
        let css = |key: &str| {
            regex::Regex::new(&format!(r"(?i)(?:^|;)\s*{}\s*:\s*([0-9.]+)(%|px)?", key))
                .unwrap()
                .captures(&style)
                .map(|c| {
                    (
                        c[1].parse::<f64>().unwrap_or(0.),
                        c.get(2).map(|m| m.as_str() == "%").unwrap_or(false),
                    )
                })
        };
        let mut width = attrs(tag, "width")
            .and_then(|s| s.parse().ok())
            .unwrap_or(nw);
        let mut height = attrs(tag, "height").and_then(|s| s.parse().ok()).unwrap_or(
            if attrs(tag, "width").is_some() {
                width * nh / nw
            } else {
                nh
            },
        );
        if attrs(tag, "height").is_some() && attrs(tag, "width").is_none() {
            width = height * nw / nh;
        }
        if let Some((w, pct)) = css("width") {
            width = if pct { 800. * w / 100. } else { w };
            height = width * nh / nw;
        }
        if let Some((h, pct)) = css("height") {
            height = if pct { 800. * h / 100. } else { h };
            if css("width").is_none() {
                width = height * nw / nh;
            }
        }
        let scale = css("zoom")
            .map(|(v, pct)| if pct { v / 100. } else { v })
            .unwrap_or(1.);
        dimensions = vec![
            json!(["width", format!("{}px", width * scale)]),
            json!(["height", format!("{}px", height * scale)]),
        ];
    }
    Ok(
        json!({"t":"Image","c":[["",[],dimensions],if alt.is_empty(){vec![]}else{vec![json!({"t":"Str","c":alt})]},[src,title]]}),
    )
}
fn prepare_html_images(st: &AppState, source: &str, directory: &Path) -> Result<Option<String>> {
    if !source.to_lowercase().contains("<img") {
        return Ok(None);
    }
    let mut doc: Value = serde_json::from_str(&pandoc(
        st,
        vec![
            "--from=markdown+tex_math_dollars+pipe_tables+task_lists".into(),
            "--to=json".into(),
        ],
        Some(source.into()),
    )?)
    .map_err(err)?;
    fn visit(v: &mut Value, d: &Path) -> Result<()> {
        let t = v["t"].as_str().unwrap_or("").to_string();
        if ["RawInline", "RawBlock"].contains(&t.as_str()) && v["c"][0] == "html" {
            let html = v["c"][1].as_str().unwrap_or("");
            if regex::Regex::new(r"(?is)^\s*<img\b[^>]*>\s*$")
                .unwrap()
                .is_match(html)
            {
                let image = image_node(html, d)?;
                *v = if t == "RawBlock" {
                    json!({"t":"Para","c":[image]})
                } else {
                    image
                };
                return Ok(());
            }
        }
        if let Some(map) = v.as_object_mut() {
            for child in map.values_mut() {
                visit(child, d)?;
            }
        } else if let Some(array) = v.as_array_mut() {
            for child in array {
                visit(child, d)?;
            }
        }
        Ok(())
    }
    visit(&mut doc, directory)?;
    Ok(Some(serde_json::to_string(&doc).map_err(err)?))
}
pub fn convert(st: &AppState, request: &Value, output: &Path) -> Result<()> {
    let format = request["format"].as_str().ok_or("缺少导出格式")?;
    let catalog = formats();
    let spec = &catalog[format];
    if spec.is_null() {
        return Err("不支持的导出格式".into());
    }
    let source = request["source"].as_str().unwrap_or("");
    let temp = tempfile::tempdir().map_err(err)?;
    let mut replacements = vec![];
    let mut index = 0;
    for (event, range) in
        pulldown_cmark::Parser::new_ext(source, pulldown_cmark::Options::all()).into_offset_iter()
    {
        if let pulldown_cmark::Event::Start(pulldown_cmark::Tag::CodeBlock(
            pulldown_cmark::CodeBlockKind::Fenced(info),
        )) = event
        {
            let lang = info.split_whitespace().next().unwrap_or("");
            if lang.starts_with("mermaid") || ["flow", "sequence", "gantt"].contains(&lang) {
                let svg = request["diagrams"][index]
                    .as_str()
                    .ok_or("图表尚未渲染完成，未生成导出文件。")?;
                let p = temp.path().join(format!("diagram-{}.png", index + 1));
                let (size, height) = files_svg_size(svg);
                let png = native::render(
                    &format!("<html><body style='margin:0;background:white'>{svg}</body></html>"),
                    "png",
                    size,
                    height,
                    &st.config(),
                )?;
                fs::write(&p, png).map_err(err)?;
                replacements.push((
                    range,
                    format!("![图表 {}](<{}>)\n\n", index + 1, p.display()),
                ));
                index += 1;
            }
        }
    }
    let mut body = source.to_string();
    for (range, markdown) in replacements.into_iter().rev() {
        body.replace_range(range, &markdown);
    }
    let input = temp.path().join("document.md");
    let resource = request["file"]
        .as_str()
        .and_then(|p| Path::new(p).parent())
        .map(PathBuf::from)
        .unwrap_or(std::env::current_dir().map_err(err)?);
    let mut args = vec![
        input.to_string_lossy().into_owned(),
        "--from=markdown+tex_math_dollars+pipe_tables+task_lists".into(),
        format!("--to={}", spec["writer"].as_str().unwrap()),
        "--standalone".into(),
        format!("--resource-path={}", resource.display()),
        format!("--output={}", output.display()),
    ];
    if ["latex", "rst", "textile", "mediawiki"].contains(&format) {
        let media = output.with_extension("assets");
        if index > 0 {
            fs::create_dir_all(&media).map_err(err)?;
            for n in 1..=index {
                fs::copy(
                    temp.path().join(format!("diagram-{n}.png")),
                    media.join(format!("diagram-{n}.png")),
                )
                .map_err(err)?;
            }
            body = body.replace(
                &temp.path().to_string_lossy().to_string(),
                &media.to_string_lossy(),
            );
        }
        args.push(format!("--extract-media={}", media.display()));
    }
    fs::write(&input, &body).map_err(err)?;
    if let Some(prepared) = prepare_html_images(st, &body, &resource)? {
        let p = temp.path().join("document.json");
        fs::write(&p, prepared).map_err(err)?;
        args[0] = p.to_string_lossy().into_owned();
        args[1] = "--from=json".into();
    }
    pandoc(st, args, None)?;
    Ok(())
}
pub fn handle(app: &AppHandle, win: &WebviewWindow, method: &str, args: &[Value]) -> Result<Value> {
    let st = app.state::<AppState>();
    match method {
        "pandoc.version" => Ok(json!(pandoc(&st, vec!["--version".into()], None)?
            .lines()
            .next()
            .unwrap_or(""))),
        "pandoc.import" => {
            let pick = if let Some(input) = args.first().and_then(Value::as_str) {
                json!({"canceled":false,"filePaths":[input]})
            } else {
                dialogs::open(
                    app,
                    win,
                    &json!({"properties":["openFile"],"filters":[{"name":"Documents","extensions":["docx","odt","epub","html","htm","rst","tex","textile","opml"]}]}),
                )
            };
            if pick["canceled"] == true {
                return Ok(Value::Null);
            }
            let input = pick["filePaths"][0].as_str().unwrap();
            let root = st.data.join("imports");
            fs::create_dir_all(&root).map_err(err)?;
            let temp = tempfile::tempdir_in(root).map_err(err)?;
            let content = pandoc(
                &st,
                vec![
                    input.into(),
                    "--to=markdown+pipe_tables+tex_math_dollars".into(),
                    "--wrap=none".into(),
                    format!("--extract-media={}", temp.path().display()),
                ],
                None,
            )?;
            let _ = temp.keep();
            Ok(json!({"content":content,"source":input}))
        }
        "pandoc.export" => {
            let req = &args[0];
            let format = req["format"].as_str().unwrap_or("");
            let formats = formats();
            let spec = &formats[format];
            if spec.is_null() {
                return Err("不支持的导出格式".into());
            }
            let file = req["file"].as_str();
            let name = format!(
                "{}.{}",
                file.and_then(|p| Path::new(p).file_stem())
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled"),
                spec["extension"].as_str().unwrap()
            );
            let picked = if let Some(output) = req["output"].as_str() {
                json!({"canceled":false,"filePath":output})
            } else {
                dialogs::save(
                    app,
                    win,
                    &json!({"defaultPath":default_path(&st,file,&name),"filters":[{"name":spec["name"],"extensions":[spec["extension"]]}]}),
                )
            };
            if picked["canceled"] == true {
                return Ok(Value::Null);
            }
            let output = picked["filePath"].as_str().unwrap();
            convert(&st, req, Path::new(output))?;
            Ok(json!(output))
        }
        _ => Err(format!("未知转换操作：{method}")),
    }
}
