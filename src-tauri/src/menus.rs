use crate::i18n::text as tr;
use crate::state::*;
use serde_json::{json, Value};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    AppHandle, LogicalPosition, Manager, WebviewWindow,
};
fn role_label(role: &str) -> &str {
    match role {
        "windowMenu" => tr("窗口", "Window"),
        "minimize" => tr("最小化", "Minimize"),
        "zoom" => tr("缩放", "Zoom"),
        "toggleTabBar" => tr("显示标签栏", "Show Tab Bar"),
        "selectPreviousTab" => tr("显示上一个标签页", "Show Previous Tab"),
        "selectNextTab" => tr("显示下一个标签页", "Show Next Tab"),
        "showAllTabs" => tr("显示所有标签页", "Show All Tabs"),
        "moveTabToNewWindow" => tr("将标签页移到新窗口", "Move Tab to New Window"),
        "mergeAllWindows" => tr("合并所有窗口", "Merge All Windows"),
        "front" => tr("前置全部窗口", "Bring All to Front"),
        "about" => tr("关于 Aropyt", "About Aropyt"),
        "services" => tr("服务", "Services"),
        "hide" => tr("隐藏 Aropyt", "Hide Aropyt"),
        "hideOthers" => tr("隐藏其他", "Hide Others"),
        "unhide" => tr("显示全部", "Show All"),
        "quit" => tr("退出 Aropyt", "Quit Aropyt"),
        _ => role,
    }
}
fn registered(entry: &Value) -> bool {
    entry["registerAccelerator"] != false
        && !matches!(
            entry["accelerator"].as_str(),
            Some("Ctrl+A" | "CommandOrControl+A")
        )
}

fn build(
    app: &AppHandle,
    entries: &Value,
    popup: bool,
    actions: &mut std::collections::HashMap<String, Value>,
) -> Result<Vec<MenuItemKind<tauri::Wry>>> {
    let mut items = vec![];
    for (n, e) in entries.as_array().ok_or(tr("菜单数据无效", "Invalid menu data"))?.iter().enumerate() {
        let id = e["id"]
            .as_str()
            .map(String::from)
            .unwrap_or_else(|| format!("popup-{}-{n}", uuid::Uuid::new_v4()));
        let role = e["role"].as_str().unwrap_or("");
        let label = e["label"].as_str().unwrap_or_else(|| role_label(role));
        let enabled = e["enabled"] != false;
        let kind = if e["type"] == "separator" {
            MenuItemKind::Predefined(PredefinedMenuItem::separator(app).map_err(err)?)
        } else if role == "services" {
            MenuItemKind::Predefined(PredefinedMenuItem::services(app, Some(label)).map_err(err)?)
        } else if role == "cut" {
            MenuItemKind::Predefined(PredefinedMenuItem::cut(app, Some(label)).map_err(err)?)
        } else if role == "copy" {
            MenuItemKind::Predefined(PredefinedMenuItem::copy(app, Some(label)).map_err(err)?)
        } else if role == "paste" {
            MenuItemKind::Predefined(PredefinedMenuItem::paste(app, Some(label)).map_err(err)?)
        } else if e["submenu"].is_array() {
            let submenu = Submenu::with_id(app, &id, label, enabled).map_err(err)?;
            for item in build(app, &e["submenu"], popup, actions)? {
                submenu.append(&item).map_err(err)?;
            }
            MenuItemKind::Submenu(submenu)
        } else {
            actions.insert(id.clone(), if popup {
                json!({"type":"menu","arg":{"action":e["action"]}})
            } else {
                json!({"type":"native-menu","arg":{
                    "id":id,"role":if role.is_empty(){Value::Null}else{json!(role)},
                    "event":e["event"],"action":e["action"],"arg":e["arg"]
                }})
            });
            let role_accel = match role {
                "quit" => Some("CmdOrCtrl+Q"),
                "hide" => Some("CmdOrCtrl+H"),
                "hideOthers" => Some("CmdOrCtrl+Alt+H"),
                "minimize" => Some("CmdOrCtrl+M"),
                _ => None,
            };
            let registered = registered(e);
            let accel = e["accelerator"]
                .as_str()
                // AppKit needs a real key equivalent to draw its shortcut
                // column. Display-only equivalents are cleared after install
                // and restored only while the menu is being shown.
                .filter(|_| registered || cfg!(target_os = "macos"))
                .or(role_accel)
                .map(|s| {
                    s.replace("CommandOrControl", "CmdOrCtrl")
                        .replace("Backspace", "Backspace")
                });
            let label = if !registered && cfg!(target_os = "windows") {
                let hint = e["accelerator"]
                    .as_str()
                    .unwrap_or("")
                    .replace("CommandOrControl+", "⌘")
                    .replace("Ctrl+", "Ctrl+")
                    .replace("Shift+", "⇧")
                    .replace("Alt+", "⌥");
                format!("{label}\t{hint}")
            } else {
                label.to_string()
            };
            if matches!(e["type"].as_str(), Some("checkbox" | "radio")) {
                MenuItemKind::Check(
                    CheckMenuItem::with_id(
                        app,
                        id,
                        label,
                        enabled,
                        e["checked"] == true,
                        accel.as_deref(),
                    )
                    .map_err(err)?,
                )
            } else {
                MenuItemKind::MenuItem(
                    MenuItem::with_id(app, id, label, enabled, accel.as_deref()).map_err(err)?,
                )
            }
        };
        items.push(kind);
    }
    Ok(items)
}
// Every window has a bridge and may refresh the application menu at once.
// Keep replacement and display-only shortcut installation in one sequence;
// otherwise one refresh can capture another menu's already-cleared keys.
static INSTALL: std::sync::Mutex<()> = std::sync::Mutex::new(());
#[cfg(target_os = "macos")]
pub fn mac_snapshot(preview: bool) -> Result<Value> {
    let _install = INSTALL.lock().map_err(err)?;
    crate::native::menu_snapshot(preview)
}
pub fn dispatch_event(app: &AppHandle, win: &WebviewWindow, id: &str) -> Option<Value> {
    let action = app.state::<AppState>().menu_actions.lock().unwrap().get(id).cloned()?;
    crate::send(win, action.clone());
    Some(action)
}

// The authenticated harness selects an item from the installed native template
// and exercises the same action lookup and targeted delivery as a native click.
pub fn dispatch_label(app: &AppHandle, win: &WebviewWindow, label: &str) -> Result<Value> {
    fn find<'a>(entries: &'a Value, label: &str) -> Option<&'a str> {
        for entry in entries.as_array()? {
            if entry["label"] == label && entry["enabled"] != false && !entry["submenu"].is_array() {
                if let Some(id) = entry["id"].as_str() { return Some(id); }
            }
            if let Some(id) = find(&entry["submenu"], label) { return Some(id); }
        }
        None
    }
    let _install = INSTALL.lock().map_err(err)?;
    let template = app.state::<AppState>().menu_template.lock().unwrap().clone();
    let id = find(&template, label).ok_or_else(|| format!("Installed menu item not found: {label}"))?;
    dispatch_event(app, win, id).ok_or_else(|| format!("Installed menu item has no command: {label}"))
}
pub fn install(app: &AppHandle, template: Value) -> Result<()> {
    let _install = INSTALL.lock().map_err(err)?;
    let st = app.state::<AppState>();
    let mut actions = std::collections::HashMap::new();
    let menu = Menu::new(app).map_err(err)?;
    for item in build(app, &template, false, &mut actions)? {
        menu.append(&item).map_err(err)?;
    }
    *st.menu_actions.lock().unwrap() = actions;
    *st.menu_template.lock().unwrap() = template.clone();
    app.set_menu(menu).map_err(err)?;
    #[cfg(target_os = "macos")]
    crate::native::menu_hints(&template)?;
    #[cfg(target_os = "linux")]
    install_gtk_hints(app, &template)?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn install_gtk_hints(app: &AppHandle, template: &Value) -> Result<()> {
    use gtk::prelude::*;
    fn walk(widgets: Vec<gtk::Widget>, entries: &[Value]) {
        for (widget, entry) in widgets.into_iter().zip(entries) {
            let Ok(item) = widget.downcast::<gtk::MenuItem>() else {
                continue;
            };
            if let Some(children) = entry["submenu"].as_array() {
                if let Some(menu) = item.submenu().and_then(|w| w.downcast::<gtk::Menu>().ok()) {
                    walk(menu.children(), children);
                }
            } else if !registered(entry) {
                let Some(accel) = entry["accelerator"].as_str() else {
                    continue;
                };
                // GtkAccelLabel can display a shortcut without adding an
                // accelerator closure that would steal the editor's keys.
                if let Some(label) = item
                    .child()
                    .and_then(|w| w.downcast::<gtk::AccelLabel>().ok())
                {
                    let mut parts: Vec<_> = accel.split('+').collect();
                    let key = match parts.pop().unwrap_or("") {
                        "=" => "equal",
                        "-" => "minus",
                        "[" => "bracketleft",
                        "]" => "bracketright",
                        "`" => "grave",
                        "\\" => "backslash",
                        "/" => "slash",
                        "," => "comma",
                        "." => "period",
                        "Enter" => "Return",
                        "Backspace" => "BackSpace",
                        key => key,
                    };
                    let modifiers = parts
                        .into_iter()
                        .map(|part| match part {
                            "Ctrl" | "CommandOrControl" | "CmdOrCtrl" => "<Control>",
                            "Shift" => "<Shift>",
                            "Alt" => "<Alt>",
                            "Super" | "Meta" => "<Super>",
                            _ => "",
                        })
                        .collect::<String>();
                    let (key, modifiers) = gtk::accelerator_parse(&format!("{modifiers}{key}"));
                    label.set_accel(key, modifiers);
                }
            }
        }
    }
    let entries = template.as_array().ok_or(tr("菜单数据无效", "Invalid menu data"))?.clone();
    let handle = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        for win in handle.webview_windows().values() {
            if let Ok(container) = win.default_vbox() {
                for child in container.children() {
                    if let Ok(bar) = child.downcast::<gtk::MenuBar>() {
                        walk(bar.children(), &entries);
                    }
                }
            }
        }
        let _ = tx.send(());
    })
    .map_err(err)?;
    rx.recv_timeout(std::time::Duration::from_secs(10))
        .map_err(err)?;
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn gtk_snapshot(app: &AppHandle, window: &WebviewWindow) -> Result<Value> {
    use gtk::prelude::*;
    // A second window may be refreshing the shared menu after the requesting
    // bridge's refresh finished. Never inspect GTK between remove and install.
    let _install = INSTALL.lock().map_err(err)?;
    fn presentation(widget: gtk::Widget) -> Option<(String, u32, u32)> {
        if let Ok(label) = widget.clone().downcast::<gtk::Label>() {
            let (key, modifiers) = widget.downcast::<gtk::AccelLabel>().ok()
                .map(|label| { let (key, modifiers) = label.accel(); (key, modifiers.bits()) })
                .unwrap_or((0, 0));
            // text() is the displayed string, with GTK mnemonic escaping
            // removed. Submenus wrap this label in a Box beside an icon.
            return Some((label.text().to_string(), key, modifiers));
        }
        widget.downcast::<gtk::Container>().ok()?.children()
            .into_iter().find_map(presentation)
    }
    fn walk(widgets: Vec<gtk::Widget>) -> Vec<Value> {
        widgets.into_iter().filter_map(|widget| {
            let item = widget.downcast::<gtk::MenuItem>().ok()?;
            let (label, key, modifiers) = item.child().and_then(presentation)
                .unwrap_or_default();
            let mut value = json!({"label":label,"keyValue":key,"modifiers":modifiers,
                "displayOnly":key != 0 && item.list_accel_closures().is_empty()});
            if let Some(menu) = item.submenu().and_then(|w| w.downcast::<gtk::Menu>().ok()) {
                value["submenu"] = json!(walk(menu.children()));
            }
            Some(value)
        }).collect()
    }
    let window = window.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        if let Ok(container) = window.default_vbox() {
            for child in container.children() {
                if let Ok(bar) = child.downcast::<gtk::MenuBar>() {
                    let _ = tx.send(json!(walk(bar.children())));
                    return;
                }
            }
        }
        let _ = tx.send(json!([]));
    })
    .map_err(err)?;
    rx.recv_timeout(std::time::Duration::from_secs(10))
        .map_err(err)
}
pub fn popup(app: &AppHandle, win: &WebviewWindow, entries: Value, x: f64, y: f64) -> Result<()> {
    let mut actions = std::collections::HashMap::new();
    let menu = Menu::new(app).map_err(err)?;
    for item in build(app, &entries, true, &mut actions)? {
        menu.append(&item).map_err(err)?;
    }
    app.state::<AppState>()
        .menu_actions
        .lock()
        .unwrap()
        .extend(actions);
    win.popup_menu_at(&menu, LogicalPosition::new(x, y))
        .map_err(err)
}
