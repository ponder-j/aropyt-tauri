use crate::state::*;
use serde_json::{json, Value};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    AppHandle, LogicalPosition, Manager, WebviewWindow,
};
fn role_label(role: &str) -> &str {
    match role {
        "windowMenu" => "Window",
        "minimize" => "Minimize",
        "zoom" => "Zoom",
        "toggleTabBar" => "Show Tab Bar",
        "selectPreviousTab" => "Show Previous Tab",
        "selectNextTab" => "Show Next Tab",
        "showAllTabs" => "Show All Tabs",
        "moveTabToNewWindow" => "Move Tab to New Window",
        "mergeAllWindows" => "Merge All Windows",
        "front" => "Bring All to Front",
        "about" => "About Aropyt",
        "services" => "Services",
        "hide" => "Hide Aropyt",
        "hideOthers" => "Hide Others",
        "unhide" => "Show All",
        "quit" => "Quit Aropyt",
        _ => role,
    }
}
fn build(
    app: &AppHandle,
    entries: &Value,
    popup: bool,
    actions: &mut std::collections::HashMap<String, Value>,
) -> Result<Vec<MenuItemKind<tauri::Wry>>> {
    let mut items = vec![];
    for (n, e) in entries.as_array().ok_or("菜单数据无效")?.iter().enumerate() {
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
            actions.insert(id.clone(),if popup{json!({"type":"menu","arg":{"action":e["action"]}})}else{json!({"type":"native-menu","arg":{"id":id,"role":if role.is_empty(){Value::Null}else{json!(role)}}})});
            let role_accel = match role {
                "quit" => Some("CmdOrCtrl+Q"),
                "hide" => Some("CmdOrCtrl+H"),
                "hideOthers" => Some("CmdOrCtrl+Alt+H"),
                "minimize" => Some("CmdOrCtrl+M"),
                _ => None,
            };
            let registered = e["registerAccelerator"] != false
                && !matches!(
                    e["accelerator"].as_str(),
                    Some("Ctrl+A" | "CommandOrControl+A")
                );
            let accel = e["accelerator"]
                .as_str()
                .filter(|_| registered)
                .or(role_accel)
                .map(|s| {
                    s.replace("CommandOrControl", "CmdOrCtrl")
                        .replace("Backspace", "Backspace")
                });
            let label = if !registered {
                let hint = e["accelerator"]
                    .as_str()
                    .unwrap_or("")
                    .replace("CommandOrControl+", "⌘")
                    .replace("Ctrl+", "Ctrl+")
                    .replace("Shift+", "⇧")
                    .replace("Alt+", "⌥");
                format!("{label}    {hint}")
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
pub fn install(app: &AppHandle, template: Value) -> Result<()> {
    let st = app.state::<AppState>();
    let mut actions = std::collections::HashMap::new();
    let menu = Menu::new(app).map_err(err)?;
    for item in build(app, &template, false, &mut actions)? {
        menu.append(&item).map_err(err)?;
    }
    *st.menu_actions.lock().unwrap() = actions;
    *st.menu_template.lock().unwrap() = template;
    app.set_menu(menu).map_err(err)?;
    Ok(())
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
