mod conversion;
mod dialogs;
mod dictionaries;
mod files;
mod images;
mod menus;
mod native;
mod state;
mod testing;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use state::*;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::mpsc,
    time::Duration,
};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

pub fn send(win: &WebviewWindow, event: Value) {
    let _ = win.emit("aropyt:event", event);
}
fn broadcast(app: &AppHandle, event: Value) {
    let _ = app.emit("aropyt:event", event);
}
fn focused(app: &AppHandle) -> Option<WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| {
            app.webview_windows()
                .into_values()
                .find(|w| w.label().starts_with("editor-"))
        })
}
fn editors(app: &AppHandle) -> Vec<WebviewWindow> {
    let mut windows: Vec<_> = app
        .webview_windows()
        .into_values()
        .filter(|w| w.label().starts_with("editor-"))
        .collect();
    windows.sort_by(|a, b| a.label().cmp(b.label()));
    windows
}
pub fn evaluate(win: &WebviewWindow, code: &str) -> Result<Value> {
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel();
    win.state::<AppState>()
        .evaluations
        .lock()
        .unwrap()
        .insert(id.clone(), tx);
    let js = format!(
        r#"Promise.resolve().then(()=>(0,eval)({code})).then(value=>window.__TAURI_INTERNALS__.invoke('eval_result',{{id:{id},value:{{ok:true,value:value??null}}}}),error=>window.__TAURI_INTERNALS__.invoke('eval_result',{{id:{id},value:{{ok:false,error:String(error)+'\n'+String(error.stack||'')}}}}))"#,
        id = json!(id),
        code = json!(code)
    );
    win.eval(&js).map_err(err)?;
    let result = rx.recv_timeout(Duration::from_secs(150)).map_err(err);
    win.state::<AppState>()
        .evaluations
        .lock()
        .unwrap()
        .remove(&id);
    let v = result?;
    if v["ok"] == false {
        return Err(v["error"].as_str().unwrap_or("JavaScript failed").into());
    }
    Ok(v["value"].clone())
}
#[tauri::command]
fn eval_result(app: AppHandle, id: String, value: Value) {
    if let Some(tx) = app
        .state::<AppState>()
        .evaluations
        .lock()
        .unwrap()
        .remove(&id)
    {
        let _ = tx.send(value);
    }
}
pub fn new_window(app: &AppHandle, file: Option<String>) -> Result<WebviewWindow> {
    let label = format!("editor-{}", uuid::Uuid::new_v4());
    let file = file.map(|f| files::abs(&f));
    let doc = Doc {
        file: file.clone(),
        dirty: false,
        token: uuid::Uuid::new_v4().to_string(),
    };
    app.state::<AppState>()
        .docs
        .lock()
        .unwrap()
        .insert(label.clone(), doc);
    let script = format!("window.__AROPYT_FILE__={};", json!(file));
    let builder = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App("dist/renderer/index.html".into()),
    )
    .title("Aropyt")
    .inner_size(1180., 780.)
    .min_inner_size(420., 260.)
    .initialization_script(script)
    .on_navigation(|url| {
        matches!(url.scheme(), "tauri" | "http" | "https")
            && (url.host_str() == Some("localhost") || url.host_str() == Some("tauri.localhost"))
    })
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    #[cfg(target_os = "macos")]
    let builder = builder.tabbing_identifier("aropyt-documents");
    eprintln!("[aropyt] creating webview {label}");
    let win = builder.build().map_err(err)?;
    eprintln!("[aropyt] webview created");
    if let Some(file) = &file {
        app.state::<AppState>().recent("recentFiles", file, true)?;
    }
    let target = win.clone();
    let handle = app.clone();
    win.on_window_event(move|event|match event{
        WindowEvent::CloseRequested{api,..}=>{let dirty=handle.state::<AppState>().docs.lock().unwrap().get(target.label()).is_some_and(|d|d.dirty);if dirty{api.prevent_close();send(&target,json!({"type":"request-close"}));}},
        WindowEvent::Destroyed=>{let st=handle.state::<AppState>();let doc=st.docs.lock().unwrap().remove(target.label());if let Some(file)=doc.and_then(|d|d.file){let _=st.recent("lastClosedFiles",&file,true);}},
        WindowEvent::ThemeChanged(theme)=>broadcast(&handle,json!({"type":"native-theme","arg":*theme==tauri::Theme::Dark})),
        WindowEvent::Resized(_)=>send(&target,json!({"type":"window-state","arg":if target.is_fullscreen().unwrap_or(false){"fullscreen"}else if target.is_maximized().unwrap_or(false){"maximized"}else{"normal"}})),_=>{}
    });
    let _ = native::window(&win, "setup", None);
    if app.state::<AppState>().config()["debugMode"] == true {
        win.open_devtools();
    }
    Ok(win)
}
fn preferences(app: &AppHandle, pane: Option<&str>) -> Result<()> {
    if let Some(win) = app.get_webview_window("preferences") {
        win.set_focus().map_err(err)?;
        if let Some(pane) = pane {
            win.eval(format!(
                "location.search={}",
                json!(format!("?pane={pane}"))
            ))
            .map_err(err)?;
        }
        return Ok(());
    }
    let path = format!(
        "dist/renderer/preferences.html{}",
        pane.map(|p| format!("?pane={p}")).unwrap_or_default()
    );
    let win = WebviewWindowBuilder::new(app, "preferences", WebviewUrl::App(path.into()))
        .title("Preferences")
        .inner_size(920., 720.)
        .min_inner_size(700., 500.)
        .build()
        .map_err(err)?;
    win.set_focus().map_err(err)?;
    Ok(())
}
fn open_path(app: &AppHandle, path: &Path) -> Result<()> {
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(err)
}
fn set_dirty(win: &WebviewWindow, dirty: bool) {
    if let Some(doc) = win
        .state::<AppState>()
        .docs
        .lock()
        .unwrap()
        .get_mut(win.label())
    {
        doc.dirty = dirty;
    }
    let _ = native::window(win, if dirty { "edited" } else { "saved" }, None);
}
fn str_arg(args: &[Value], n: usize) -> &str {
    args.get(n).and_then(Value::as_str).unwrap_or("")
}
fn bool_arg(args: &[Value], n: usize) -> bool {
    args.get(n) == Some(&json!(true))
}
fn value(args: &[Value], n: usize) -> Value {
    args.get(n).cloned().unwrap_or(Value::Null)
}
fn dictionary_language(st: &AppState) -> String {
    let s = st.config();
    let name = s["presetSpellCheck"].as_str().unwrap_or("en-US");
    if name == "auto" || name == "off" || name == "zh" || name == "ja" {
        "en-US".into()
    } else {
        name.into()
    }
}
pub fn dispatch(
    app: &AppHandle,
    win: &WebviewWindow,
    method: &str,
    args: &[Value],
) -> Result<Value> {
    let st = app.state::<AppState>();
    let text = |n| str_arg(args, n);
    let flag = |n| bool_arg(args, n);
    let v = |n| value(args, n);
    let ok = || Ok(json!(true));
    match method {
        "bridge.send" => {
            if text(0) == "doc.syncChange" {
                set_dirty(win, v(1)["dirty"] == true);
            }
            ok()
        }
        "window.minimize" => {
            win.minimize().map_err(err)?;
            ok()
        }
        "window.maximize" => {
            win.maximize().map_err(err)?;
            ok()
        }
        "window.restore" => {
            win.unmaximize().map_err(err)?;
            ok()
        }
        "window.toggleMaximize" => {
            if win.is_maximized().map_err(err)? {
                win.unmaximize()
            } else {
                win.maximize()
            }
            .map_err(err)?;
            ok()
        }
        "window.close" => {
            win.close().map_err(err)?;
            ok()
        }
        "window.focus" => {
            win.set_focus().map_err(err)?;
            ok()
        }
        "window.pin" | "window.unpin" | "window.updateMenuForIsAlwaysOnTop" => {
            win.set_always_on_top(if method == "window.updateMenuForIsAlwaysOnTop" {
                flag(0)
            } else {
                method == "window.pin"
            })
            .map_err(err)?;
            ok()
        }
        "window.toggleAlwaysOnTop" => {
            let on = !win.is_always_on_top().map_err(err)?;
            win.set_always_on_top(on).map_err(err)?;
            Ok(json!(on))
        }
        "window.fullscreen"
        | "window.enterFullscreen"
        | "window.exitFullscreen"
        | "window.toggleFullScreen" => {
            win.set_fullscreen(match method {
                "window.fullscreen" => flag(0),
                "window.enterFullscreen" => true,
                "window.toggleFullScreen" => !win.is_fullscreen().map_err(err)?,
                _ => false,
            })
            .map_err(err)?;
            ok()
        }
        "window.setTitle" => {
            let title = if cfg!(target_os = "macos") {
                text(0).trim_end_matches(" - Aropyt").trim_end_matches(" •")
            } else {
                text(0)
            };
            win.set_title(title).map_err(err)?;
            ok()
        }
        "window.setMenuBarVisibility" => {
            if flag(0) {
                win.show_menu()
            } else {
                win.hide_menu()
            }
            .map_err(err)?;
            ok()
        }
        "window.checkAsFocus" => Ok(json!(win.is_focused().map_err(err)?)),
        "window.toggleDevTools" | "window.inspectElement" => {
            if win.is_devtools_open() {
                win.close_devtools();
            } else {
                win.open_devtools();
            }
            ok()
        }
        "window.nativeAction" => {
            let action = match text(0) {
                "toggleTabBar" => "toggleTabBar",
                "selectPreviousTab" => "selectPreviousTab",
                "selectNextTab" => "selectNextTab",
                "showAllTabs" => "toggleTabOverview",
                "moveTabToNewWindow" => "moveTabToNewWindow",
                "mergeAllWindows" => "mergeAllWindows",
                "front" => "arrangeInFront",
                "hide" => "hide",
                "hideOthers" => "hideOtherApplications",
                "unhide" => "unhideAllApplications",
                _ => text(0),
            };
            native::window(win, action, None)?;
            ok()
        }
        "window.emoji" => {
            native::window(win, "emoji", None)?;
            ok()
        }
        "window.about" => {
            dialogs::message(
                app,
                win,
                &json!({"message":"Aropyt 1.0.0","detail":"基于 Tauri 2 的 Markdown 编辑器\nMIT License"}),
            );
            ok()
        }
        "window.openPreferences" => {
            preferences(app, args.first().and_then(Value::as_str))?;
            ok()
        }
        "getPath" => {
            let path = match text(0) {
                "userData" => st.data.clone(),
                "home" => app.path().home_dir().map_err(err)?,
                "documents" => app.path().document_dir().map_err(err)?,
                "downloads" => app.path().download_dir().map_err(err)?,
                "temp" => std::env::temp_dir(),
                _ => return Err(format!("未知数据目录：{}", text(0))),
            };
            Ok(json!(path))
        }
        "app.openFile" | "app.openFolder" | "app.openFileOrFolder" => {
            let folder = method == "app.openFolder";
            let pick = dialogs::open(
                app,
                win,
                &json!({"properties":[if folder{"openDirectory"}else{"openFile"}],"filters":if folder{json!([])}else{json!([{"name":"Markdown","extensions":["md","markdown","mdown","mkd","mdwn","text","txt","rmd"]},{"name":"All Files","extensions":["*"]}])}}),
            );
            if pick["canceled"] == true {
                return Ok(Value::Null);
            }
            let path = pick["filePaths"][0].as_str().unwrap();
            if folder {
                st.recent("recentFolders", path, true)?;
                st.put("lastFolder", json!(path))?;
            } else {
                send(win, json!({"type":"open-file","arg":path}));
            }
            if method == "app.openFileOrFolder" {
                Ok(if folder {
                    json!({"folder":path})
                } else {
                    json!({"file":path})
                })
            } else {
                Ok(json!(path))
            }
        }
        "app.openOrSwitch" => {
            send(win, json!({"type":"open-file","arg":files::abs(text(0))}));
            ok()
        }
        "app.sendEvent" => {
            if text(0) == "doc.dirty" {
                set_dirty(win, v(1)["dirty"] == true);
            }
            ok()
        }
        "app.onCloseWin" => {
            set_dirty(win, false);
            win.destroy().map_err(err)?;
            ok()
        }
        "app.quit" => {
            for target in editors(app) {
                if evaluate(
                    &target,
                    "window.__aropyt ? window.__aropyt.confirmSave() : true",
                )? == false
                {
                    return Ok(json!(false));
                }
            }
            app.exit(0);
            ok()
        }
        "app.download" | "shell.openExternal" => {
            let url = url::Url::parse(text(0)).map_err(err)?;
            if !matches!(url.scheme(), "http" | "https" | "mailto") {
                return Err("不支持的外部链接协议".into());
            }
            app.opener()
                .open_url(url.as_str(), None::<&str>)
                .map_err(err)?;
            ok()
        }
        "dialog.showMessageBox" => Ok(dialogs::message(app, win, &v(0))),
        "dialog.showOpenDialog" => Ok(dialogs::open(app, win, &v(0))),
        "dialog.showSaveDialog" => Ok(dialogs::save(app, win, &v(0))),
        "document.getContent" => {
            if !Path::new(text(0)).exists() {
                Ok(json!({"content":"","encoding":"utf-8"}))
            } else {
                files::read_text(&st, text(0), None)
            }
        }
        "document.loadData" => {
            if !Path::new(text(0)).exists() {
                Ok(Value::Null)
            } else {
                files::read_text(&st, text(0), None)
            }
        }
        "document.reopenEncoding" => {
            if !Path::new(text(0)).exists() {
                return Ok(Value::Null);
            }
            let encoding = if text(1).is_empty() || text(1) == "auto" {
                st.encodings.lock().unwrap().remove(text(0));
                None
            } else {
                Some(text(1))
            };
            files::read_text(&st, text(0), encoding)
        }
        "document.setContent" => {
            files::write_text(&st, text(0), text(1), args.get(2).and_then(Value::as_str))?;
            if let Some(doc) = st.docs.lock().unwrap().get_mut(win.label()) {
                doc.file = Some(files::abs(text(0)));
            }
            st.recent("recentFiles", text(0), true)?;
            ok()
        }
        "document.rename" => {
            fs::rename(text(0), text(1)).map_err(err)?;
            let mut enc = st.encodings.lock().unwrap();
            if let Some(old) = enc.remove(text(0)) {
                enc.insert(text(1).into(), old);
            }
            st.recent("recentFiles", text(0), false)?;
            st.recent("recentFiles", text(1), true)?;
            ok()
        }
        "document.newWindow" | "document.newTab" => {
            let next = new_window(app, args.first().and_then(Value::as_str).map(String::from))?;
            if method == "document.newTab" {
                native::window(win, "attach", Some(&next))?;
            }
            ok()
        }
        "document.nextWindow" => {
            let all = editors(app);
            if let Some(index) = all.iter().position(|w| w.label() == win.label()) {
                all[(index + 1) % all.len()].set_focus().map_err(err)?;
            }
            ok()
        }
        "document.noOtherWindow" => Ok(json!(editors(app).len() <= 1)),
        "document.hasDuplicateName" => Ok(json!(Path::new(text(0)).exists())),
        "document.activate" => {
            if let Some(doc) = st.docs.lock().unwrap().get_mut(win.label()) {
                doc.file = args.first().and_then(Value::as_str).map(files::abs);
                doc.dirty = false;
                doc.token = uuid::Uuid::new_v4().to_string();
            }
            if let Some(file) = args.first().and_then(Value::as_str) {
                st.recent("recentFiles", file, true)?;
            }
            ok()
        }
        "document.saveAll" => {
            for target in editors(app) {
                if evaluate(
                    &target,
                    "window.__aropyt.state.dirty ? window.__aropyt.runAction('save') : true",
                )? == false
                {
                    return Ok(json!(false));
                }
            }
            ok()
        }
        "document.properties" => {
            if args.first().is_none_or(Value::is_null) {
                return Ok(json!({"file":null}));
            }
            let stat = fs::metadata(text(0)).map_err(err)?;
            let iso = |time: std::io::Result<std::time::SystemTime>| {
                time.map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                    .unwrap_or_default()
            };
            Ok(
                json!({"file":text(0),"size":stat.len(),"created":iso(stat.created()),"modified":iso(stat.modified())}),
            )
        }
        "document.saveDraft" => {
            let token = st
                .docs
                .lock()
                .unwrap()
                .get(win.label())
                .map(|d| d.token.clone())
                .unwrap_or_else(|| win.label().into());
            let key = args.first().and_then(Value::as_str).unwrap_or(&token);
            let id = format!("{:x}", Sha256::digest(key.as_bytes()))[..32].to_string();
            let draft = Draft {
                id: id.clone(),
                file: v(0),
                content: text(1).into(),
                encoding: args
                    .get(2)
                    .and_then(Value::as_str)
                    .unwrap_or("utf-8")
                    .into(),
                modified: now(),
            };
            atomic_write(
                &st.data.join(format!("drafts/{id}.json")),
                &serde_json::to_vec(&draft).map_err(err)?,
            )?;
            Ok(json!(id))
        }
        "document.listDrafts" => {
            let dir = st.data.join("drafts");
            fs::create_dir_all(&dir).map_err(err)?;
            let mut drafts: Vec<Draft> = fs::read_dir(dir)
                .map_err(err)?
                .flatten()
                .filter_map(|e| {
                    fs::read(e.path())
                        .ok()
                        .and_then(|s| serde_json::from_slice(&s).ok())
                })
                .collect();
            drafts.sort_by_key(|d| std::cmp::Reverse(d.modified));
            Ok(json!(drafts))
        }
        "document.getDraft" | "document.removeDraft" => {
            if text(0).len() != 32 || !text(0).bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("无效的草稿".into());
            }
            let p = st.data.join(format!("drafts/{}.json", text(0)));
            if method == "document.getDraft" {
                Ok(fs::read(&p)
                    .ok()
                    .and_then(|b| serde_json::from_slice(&b).ok())
                    .unwrap_or(Value::Null))
            } else {
                if p.exists() {
                    fs::remove_file(p).map_err(err)?;
                }
                ok()
            }
        }
        "setting.put" => {
            st.put(text(0), v(1))?;
            if text(0) == "presetSpellCheck" {
                st.put("spellCheck", json!(text(1) != "off"))?;
            }
            if text(0) == "recordRecent" && !flag(1) {
                st.put("recentFiles", json!([]))?;
                st.put("recentFolders", json!([]))?;
                st.put("lastClosedFiles", json!([]))?;
            }
            if text(0) == "debugMode" {
                for w in editors(app) {
                    if flag(1) {
                        w.open_devtools();
                    } else {
                        w.close_devtools();
                    }
                }
            }
            broadcast(
                app,
                json!({"type":"setting-changed","arg":{"key":text(0),"value":v(1)}}),
            );
            ok()
        }
        "setting.get" => Ok(st.config()[text(0)].clone()),
        "setting.getAll" => Ok(st.config()),
        "setting.getThemes" => Ok(json!(files::themes(&st)
            .iter()
            .map(|v| v["name"].clone())
            .collect::<Vec<_>>())),
        "setting.setCurTheme" => {
            st.put("theme", v(0))?;
            ok()
        }
        "setting.getRecentFiles" => Ok(st.config()["recentFiles"].clone()),
        "setting.getRecentFolders" => Ok(st.config()["recentFolders"].clone()),
        "setting.addRecentFolder" | "controller.switchFolder" => {
            st.recent("recentFolders", text(0), true)?;
            ok()
        }
        "setting.removeRecentFolder" => {
            st.recent("recentFolders", text(0), false)?;
            ok()
        }
        "setting.removeRecentDocument" => {
            st.recent("recentFiles", text(0), false)?;
            ok()
        }
        "setting.updateRecentFile" => {
            st.recent("recentFiles", text(0), true)?;
            ok()
        }
        "setting.clearRecentDocuments" => {
            st.put("recentFiles", json!([]))?;
            st.put("recentFolders", json!([]))?;
            ok()
        }
        "setting.getKeyBinding" => Ok(st.config()["keyBinding"].clone()),
        "setting.getUnsavedDraftsPath" => Ok(json!(st.data.join("drafts"))),
        "setting.getUserDictionaryPath" => Ok(json!(st.data.join("conf/user-dict.txt"))),
        "setting.loadExports" => Ok(conversion::formats()),
        "setting.openConfFolder"
        | "setting.openUserDataFolder"
        | "theme.openFolder"
        | "dictionary.openFolder" => {
            let p = st.data.join(match method {
                "setting.openConfFolder" => "conf",
                "theme.openFolder" => "themes",
                "dictionary.openFolder" => "dictionaries",
                _ => "",
            });
            fs::create_dir_all(&p).map_err(err)?;
            open_path(app, &p)?;
            ok()
        }
        "prefs.themeChanged" => {
            broadcast(app, json!({"type":"reapply-theme"}));
            ok()
        }
        "prefs.applyChrome" => {
            broadcast(app, json!({"type":"reapply-chrome"}));
            ok()
        }
        "prefs.setMode" => {
            broadcast(
                app,
                json!({"type":"set-mode","arg":{"mode":text(0),"on":flag(1)}}),
            );
            ok()
        }
        "theme.getCss" => Ok(json!(files::theme_css(&st, text(0)))),
        "theme.listThemes" => Ok(json!(files::themes(&st))),
        "theme.setThemeSource" => {
            let theme = match text(0) {
                "dark" => Some(tauri::Theme::Dark),
                "light" => Some(tauri::Theme::Light),
                _ => None,
            };
            app.set_theme(theme);
            Ok(json!(win.theme().map_err(err)? == tauri::Theme::Dark))
        }
        "theme.isDark" => Ok(json!(win.theme().map_err(err)? == tauri::Theme::Dark)),
        "fs.readDir" => Ok(json!(files::read_dir(&files::local_path(text(0)))?)),
        "fs.exists" | "document.hasDuplicate" => Ok(json!(files::local_path(text(0)).exists())),
        "fs.isDir" | "shell.isFolder" => Ok(json!(files::local_path(text(0)).is_dir())),
        "fs.readText" => files::read_text(&st, text(0), args.get(1).and_then(Value::as_str)),
        "fs.writeText" => {
            files::write_text(&st, text(0), text(1), args.get(2).and_then(Value::as_str))?;
            ok()
        }
        "fs.mkdir" => {
            fs::create_dir_all(text(0)).map_err(err)?;
            ok()
        }
        "fs.stat" => files::stat(&files::local_path(text(0))),
        "fs.listMarkdown" => Ok(json!(files::list_markdown(
            &files::local_path(text(0)),
            args.get(1).and_then(Value::as_u64).unwrap_or(3) as usize
        ))),
        "shell.openItem" => {
            open_path(app, &files::local_path(text(0)))?;
            Ok(json!(""))
        }
        "shell.showItemInFolder" => {
            app.opener()
                .reveal_item_in_dir(files::local_path(text(0)))
                .map_err(err)?;
            ok()
        }
        "shell.trashItem" | "path.delete" => {
            trash::delete(files::local_path(text(0))).map_err(err)?;
            ok()
        }
        "shell.removeIfEmpty" => {
            let _ = fs::remove_dir(text(0));
            ok()
        }
        "path.copyFile" | "path.moveFile" => {
            let to = files::local_path(text(1));
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(err)?;
            }
            if method == "path.copyFile" {
                fs::copy(files::local_path(text(0)), &to).map_err(err)?;
            } else {
                fs::rename(files::local_path(text(0)), &to).map_err(err)?;
            }
            ok()
        }
        "clipboard.write" | "clipboard.writeRich" => {
            native::clipboard(|clip| {
                if method == "clipboard.writeRich" && !text(1).is_empty() {
                    clip.set_html(text(1), Some(text(0))).map_err(err)
                } else {
                    clip.set_text(text(0)).map_err(err)
                }
            })?;
            ok()
        }
        "clipboard.read" | "clipboard.readRich" => native::clipboard(|clip| {
            let text = clip.get_text().unwrap_or_default();
            Ok(if method == "clipboard.readRich" {
                json!({"text":text,"html":clip.get().html().unwrap_or_default()})
            } else {
                json!(text)
            })
        }),
        "clipboard.writeImage" => {
            images::write_clipboard_image(&images::bytes(text(0))?, &st.config())?;
            ok()
        }
        "export.defaultPath" => Ok(json!(conversion::default_path(
            &st,
            args.first().and_then(Value::as_str),
            text(1)
        ))),
        "export.getStyles" => {
            let with_styles = args.get(1) != Some(&json!(false));
            let read = |file: PathBuf| -> Result<String> {
                let css = fs::read_to_string(&file).map_err(err)?;
                Ok(files::inline_css(&css, file.parent().unwrap()))
            };
            let base = if with_styles {
                read(st.resources.join("resources/styles/base.css"))?
                    + "\n"
                    + &files::theme_css(&st, text(0))
            } else {
                "body{font:16px/1.6 -apple-system,sans-serif;color:#333}#write{max-width:860px;margin:auto;padding:30px}pre{background:#f8f8f8;padding:10px}".into()
            };
            Ok(json!(
                base + "\n"
                    + &read(
                        st.resources
                            .join("resources/renderer-styles/hljs-inline.css")
                    )?
                    + "\n"
                    + &read(st.resources.join("resources/renderer-styles/export.css"))?
            ))
        }
        "export.inlineImage" => {
            let src = text(0);
            Ok(json!(if src.starts_with("file:")
                || src.starts_with("asset:")
                || src.contains("://asset.localhost/")
            {
                files::data_uri(&files::local_path(src))?
            } else {
                src.to_string()
            }))
        }
        "export.saveFile" => {
            let opts = v(0);
            let pick = dialogs::save(app, win, &opts);
            if pick["canceled"] == true {
                return Ok(Value::Null);
            }
            let p = pick["filePath"].as_str().unwrap();
            let bytes = if let Some(b64) = opts["base64"].as_str() {
                B64.decode(b64).map_err(err)?
            } else {
                opts["content"].as_str().unwrap_or("").as_bytes().to_vec()
            };
            atomic_write(Path::new(p), &bytes)?;
            Ok(json!(p))
        }
        "export.htmlToPDF" | "export.htmlToImage" | "export.print" => {
            let mode = match method {
                "export.htmlToPDF" => "pdf",
                "export.print" => "print",
                _ => "png",
            };
            let bytes = native::render(text(0), mode, 1000., 0., &st.config())?;
            if method == "export.print" {
                Ok(json!(bytes == b"true"))
            } else {
                Ok(json!(B64.encode(bytes)))
            }
        }
        "export.printToPDF" | "export.captureImage" => {
            let html = evaluate(win, "document.documentElement.outerHTML")?;
            let bytes = native::render(
                html.as_str().unwrap_or(""),
                if method == "export.printToPDF" {
                    "pdf"
                } else {
                    "png"
                },
                1000.,
                0.,
                &st.config(),
            )?;
            Ok(json!(B64.encode(bytes)))
        }
        "menu.install" => {
            menus::install(app, v(0))?;
            ok()
        }
        "menu.popup" => {
            menus::popup(
                app,
                win,
                v(0),
                v(1).as_f64().unwrap_or(0.),
                v(2).as_f64().unwrap_or(0.),
            )?;
            ok()
        }
        "url.request" => {
            let response = reqwest::blocking::get(text(0)).map_err(err)?;
            let status = response.status().as_u16();
            Ok(json!({"status":status,"text":response.text().map_err(err)?}))
        }
        "filesOp.getFocusPath" => Ok(st
            .docs
            .lock()
            .unwrap()
            .get(win.label())
            .and_then(|d| d.file.clone())
            .map(|s| json!(s))
            .unwrap_or(Value::Null)),
        "search.findAll" => Ok(files::search(&st, Path::new(text(0)), text(1), &v(2))),
        "dictionary.exists" => Ok(json!(dictionaries::exists(&st, text(0)))),
        "dictionary.read" => dictionaries::read(&st, text(0)),
        "dictionary.users" => Ok(dictionaries::users(&st)),
        "dictionary.detect" => Ok(json!(dictionaries::detect(text(0), text(1)))),
        "dictionary.learn" => {
            let users = dictionaries::learn(&st, text(0), text(1), flag(2))?;
            broadcast(app, json!({"type":"dictionary-users"}));
            Ok(users)
        }
        "dictionary.install" | "dictionary.installSelected" => {
            let language = if method == "dictionary.installSelected" {
                dictionary_language(&st)
            } else {
                text(0).into()
            };
            let result = dictionaries::install(&st, &language)?;
            broadcast(app, json!({"type":"dictionary-installed","arg":language}));
            Ok(result)
        }
        "dictionary.importSelected" => {
            let language = dictionary_language(&st);
            let pick = dialogs::open(
                app,
                win,
                &json!({"title":format!("导入 {language} 词典：同时选择 .aff 和 .dic"),"properties":["openFile","multiSelections"],"filters":[{"name":"Hunspell / All Files","extensions":["*"]}]}),
            );
            if pick["canceled"] == true {
                return Ok(Value::Null);
            }
            let paths = pick["filePaths"].as_array().unwrap();
            let aff = paths
                .iter()
                .filter_map(Value::as_str)
                .find(|p| p.to_lowercase().ends_with(".aff"))
                .ok_or("请选择 .aff 和 .dic 两个文件")?;
            let dic = paths
                .iter()
                .filter_map(Value::as_str)
                .find(|p| p.to_lowercase().ends_with(".dic"))
                .ok_or("请选择 .aff 和 .dic 两个文件")?;
            let result = dictionaries::import(&st, &language, Path::new(aff), Path::new(dic))?;
            broadcast(app, json!({"type":"dictionary-installed","arg":language}));
            Ok(result)
        }
        "dictionary.status" => Ok(json!(dictionaries::manifest()["languages"]
            .as_object()
            .unwrap()
            .keys()
            .map(|l| json!({"language":l,"installed":dictionaries::exists(&st,l)}))
            .collect::<Vec<_>>())),
        "help.open" => {
            if text(0) == "repository" {
                app.opener()
                    .open_url("https://github.com/ponder-j/aropyt-tauri", None::<&str>)
                    .map_err(err)?;
            } else if text(0) == "license" {
                dialogs::message(
                    app,
                    win,
                    &json!({"message":"Aropyt 许可证","detail":"项目包声明为 MIT。Aropyt 没有商业激活服务，第三方组件保留原始授权。"}),
                );
            } else {
                let file = match text(0) {
                    "privacy" => "docs/privacy.md",
                    "credits" => "docs/credits.md",
                    "changelog" => "docs/migration.md",
                    _ => "docs/user-guide.md",
                };
                new_window(
                    app,
                    Some(st.resources.join(file).to_string_lossy().into_owned()),
                )?;
            }
            ok()
        }
        m if m.starts_with("images.") || m == "media.output" => {
            images::handle(app, win, method, args)
        }
        m if m.starts_with("pandoc.") => conversion::handle(app, win, method, args),
        _ => Err(format!("未知操作：{method}")),
    }
}
#[tauri::command]
async fn bridge(app: AppHandle, window: WebviewWindow, method: String, args: Vec<Value>) -> Value {
    match tauri::async_runtime::spawn_blocking(move || dispatch(&app, &window, &method, &args))
        .await
    {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => json!({"error":e}),
        Err(e) => json!({"error":e.to_string()}),
    }
}
fn open_files(app: &AppHandle, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    if let Some(win) = focused(app) {
        send(&win, json!({"type":"open-file","arg":files[0]}));
        let _ = win.unminimize();
        let _ = win.set_focus();
        for file in files.into_iter().skip(1) {
            let _ = new_window(app, Some(file));
        }
    } else {
        for file in files {
            let _ = new_window(app, Some(file));
        }
    }
}
fn launch_files(argv: impl Iterator<Item = String>, cwd: &Path) -> Vec<String> {
    argv.filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| {
            let p = if arg.starts_with("file:") {
                files::local_path(&arg)
            } else {
                cwd.join(arg)
            };
            if p.is_file() && files::is_markdown(&p) {
                Some(p.to_string_lossy().into_owned())
            } else {
                None
            }
        })
        .collect()
}
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let files = launch_files(argv.into_iter().skip(1), Path::new(&cwd));
            open_files(app, files);
        }))
        .invoke_handler(tauri::generate_handler![bridge, eval_result])
        .on_menu_event(|app, event| {
            let action = app
                .state::<AppState>()
                .menu_actions
                .lock()
                .unwrap()
                .get(event.id().as_ref())
                .cloned();
            if let (Some(win), Some(action)) = (focused(app), action) {
                send(&win, action);
            }
        })
        .setup(|app| {
            let _ = native::HOST.set(app.handle().clone());
            let state = AppState::new(app.handle()).map_err(std::io::Error::other)?;
            app.manage(state);
            let initial = launch_files(std::env::args().skip(1), &std::env::current_dir()?);
            let settings = app.state::<AppState>().config();
            let restored: Vec<String> = if initial.is_empty() && settings["onLaunch"] == "both" {
                settings["lastClosedFiles"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|v| {
                        v.as_str()
                            .filter(|p| Path::new(p).is_file())
                            .map(String::from)
                    })
                    .take(12)
                    .collect()
            } else {
                initial
            };
            if restored.is_empty() {
                new_window(app.handle(), None).map_err(std::io::Error::other)?;
            } else {
                for file in restored {
                    new_window(app.handle(), Some(file)).map_err(std::io::Error::other)?;
                }
            }
            eprintln!("[aropyt] windows created");
            testing::start(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Aropyt could not start");
    app.run(|app, event| match event {
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => open_files(
            app,
            urls.into_iter()
                .filter_map(|u| {
                    u.to_file_path()
                        .ok()
                        .map(|p| p.to_string_lossy().into_owned())
                })
                .collect(),
        ),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                let _ = new_window(app, None);
            }
        }
        RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none() {
                api.prevent_exit();
                if let Some(win) = focused(app) {
                    let handle = app.clone();
                    std::thread::spawn(move || {
                        let _ = dispatch(&handle, &win, "app.quit", &[]);
                    });
                } else {
                    app.exit(0);
                }
            }
        }
        _ => {}
    });
}
