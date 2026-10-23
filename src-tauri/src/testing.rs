use crate::{dispatch, editors, evaluate, new_window, state::*};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
};
use tauri::{AppHandle, Manager};
// Opt-in loopback harness, protected by an unguessable token. Never starts in
// normal app launches; it tests the same native webview and command dispatcher.
pub fn isolated() -> bool {
    std::env::var_os("AROPYT_DATA_DIR").is_some()
        && std::env::var("AROPYT_TEST_PORT").ok().and_then(|v| v.parse::<u16>().ok()).is_some()
        && std::env::var("AROPYT_TEST_TOKEN").is_ok_and(|v| v.len() >= 32)
}
pub fn start(app: &AppHandle) {
    let Ok(port) = std::env::var("AROPYT_TEST_PORT") else {
        return;
    };
    let Ok(token) = std::env::var("AROPYT_TEST_TOKEN") else {
        return;
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        let listener =
            TcpListener::bind(format!("127.0.0.1:{port}")).expect("test port unavailable");
        for stream in listener.incoming().flatten() {
            let app = handle.clone();
            let token = token.clone();
            std::thread::spawn(move || {
                let _ = request(stream, app, &token);
            });
        }
    });
}
fn request(mut stream: TcpStream, app: AppHandle, token: &str) -> Result<()> {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(10)))
        .map_err(err)?;
    let mut bytes = vec![];
    let mut buffer = [0; 8192];
    let end = loop {
        let n = stream.read(&mut buffer).map_err(err)?;
        if n == 0 {
            return Ok(());
        }
        bytes.extend_from_slice(&buffer[..n]);
        if let Some(i) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
            break i + 4;
        }
        if bytes.len() > 2_000_000 {
            return Err("test request too large".into());
        }
    };
    let header = String::from_utf8_lossy(&bytes[..end]);
    if !header
        .lines()
        .any(|s| s.trim() == format!("Authorization: Bearer {token}"))
    {
        stream
            .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            .map_err(err)?;
        return Ok(());
    }
    let size = header
        .lines()
        .find_map(|l| {
            l.to_lowercase()
                .strip_prefix("content-length:")
                .map(|s| s.trim().parse::<usize>().unwrap_or(0))
        })
        .unwrap_or(0);
    if size > 40_000_000 {
        return Err("test request too large".into());
    }
    while bytes.len() < end + size {
        let n = stream.read(&mut buffer).map_err(err)?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..n]);
    }
    let req: Value = serde_json::from_slice(&bytes[end..end + size]).map_err(err)?;
    let result = (|| -> Result<Value> {
        let win = if let Some(label) = req["window"].as_str() {
            app.get_webview_window(label)
        } else {
            editors(&app).into_iter().next()
        }
        .ok_or("No editor window")?;
        match req["op"].as_str().unwrap_or("eval") {
            "eval" => evaluate(&win, req["code"].as_str().unwrap_or("null")),
            "invoke" => dispatch(
                &app,
                &win,
                req["method"].as_str().unwrap_or(""),
                req["args"].as_array().map(Vec::as_slice).unwrap_or(&[]),
            ),
            "windows" => Ok(json!(app.webview_windows().keys().collect::<Vec<_>>())),
            "send-event" => {
                crate::send(&win, req["event"].clone());
                Ok(json!(true))
            }
            "menu-event" => crate::menus::dispatch_label(&app, &win, req["label"].as_str().unwrap_or("")),
            "update-fixture" => crate::updates::test_fixture(&app, &win, req["manifest"].clone(), req["file"].as_str().unwrap_or(""), req["stage"] == true),
            #[cfg(target_os = "macos")]
            "native-menu" => crate::menus::mac_snapshot(req["preview"] == true),
            #[cfg(target_os = "linux")]
            "native-menu" => crate::menus::gtk_snapshot(&app, &win),
            "new" => Ok(json!(new_window(
                &app,
                req["file"].as_str().map(String::from)
            )?
            .label())),
            "quit" => {
                app.exit(0);
                Ok(json!(true))
            }
            _ => Err("Unknown test action".into()),
        }
    })();
    let body = serde_json::to_vec(&match result {
        Ok(value) => json!({"ok":true,"value":value}),
        Err(error) => json!({"ok":false,"error":error}),
    })
    .map_err(err)?;
    stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).as_bytes()).map_err(err)?;
    stream.write_all(&body).map_err(err)?;
    Ok(())
}
