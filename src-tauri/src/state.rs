use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
};
use tauri::{AppHandle, Manager};

pub type Result<T> = std::result::Result<T, String>;
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
pub fn atomic_write(p: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let temp = p.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temp, bytes).map_err(err)?;
    // rename replaces atomically on Unix; Windows needs ReplaceFile semantics.
    #[cfg(windows)]
    if p.exists() {
        fs::remove_file(p).map_err(err)?;
    }
    fs::rename(temp, p).map_err(err)
}
#[derive(Clone, Default)]
pub struct Doc {
    pub file: Option<String>,
    pub dirty: bool,
    pub token: String,
}
pub struct AppState {
    pub data: PathBuf,
    pub resources: PathBuf,
    pub settings: Mutex<Value>,
    pub docs: Mutex<HashMap<String, Doc>>,
    pub encodings: Mutex<HashMap<String, String>>,
    pub evaluations: Mutex<HashMap<String, mpsc::Sender<Value>>>,
    pub menu_actions: Mutex<HashMap<String, Value>>,
    pub menu_template: Mutex<Value>,
}
pub fn copy_tree(from: &Path, to: &Path) -> Result<()> {
    fs::create_dir_all(to).map_err(err)?;
    for entry in fs::read_dir(from).map_err(err)? {
        let e = entry.map_err(err)?;
        let target = to.join(e.file_name());
        if e.file_type().map_err(err)?.is_dir() {
            copy_tree(&e.path(), &target)?;
        } else if !target.exists() {
            fs::copy(e.path(), target).map_err(err)?;
        }
    }
    Ok(())
}
impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let override_dir = std::env::var_os("AROPYT_DATA_DIR").map(PathBuf::from);
        let data = override_dir
            .clone()
            .unwrap_or(app.path().app_data_dir().map_err(err)?);
        let mut resources = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .to_path_buf()
        } else {
            app.path().resource_dir().map_err(err)?
        };
        if !resources.join("resources/styles").is_dir() {
            if let Ok(executable) = std::env::current_exe() {
                if let Some(parent) = executable.parent() {
                    if parent.join("resources/styles").is_dir() {
                        resources = parent.to_path_buf();
                    }
                }
            }
        }
        fs::create_dir_all(&data).map_err(err)?;
        let marker = data.join("migration.json");
        if override_dir.is_none() && !marker.exists() {
            let legacy = if cfg!(target_os = "macos") {
                app.path()
                    .home_dir()
                    .map_err(err)?
                    .join("Library/Application Support/aropyt")
            } else if cfg!(windows) {
                app.path().config_dir().map_err(err)?.join("aropyt")
            } else {
                app.path().config_dir().map_err(err)?.join("aropyt")
            };
            if legacy.exists() {
                for name in ["conf", "themes", "drafts", "imports", "pasted-images"] {
                    if legacy.join(name).exists() {
                        copy_tree(&legacy.join(name), &data.join(name))?;
                    }
                }
            }
            atomic_write(
                &marker,
                &serde_json::to_vec_pretty(
                    &json!({"source":legacy,"copied":legacy.exists(),"time":now()}),
                )
                .map_err(err)?,
            )?;
        }
        let mut settings: Value =
            serde_json::from_str(include_str!("../../resources/defaults.json")).map_err(err)?;
        if let Ok(raw) = fs::read_to_string(data.join("conf/conf.user.json")) {
            let values: Value = deser_hjson::from_str(&raw)
                .map_err(|e| format!("无法读取偏好设置，原文件已保留：{e}"))?;
            if let Some(map) = values.as_object() {
                for (k, v) in map {
                    if !v.is_null() {
                        settings[k] = v.clone();
                    }
                }
            }
        }
        if !settings["remapPunctuation"].is_boolean() {
            settings["remapPunctuation"] = json!(matches!(
                settings["remapPunctuation"].as_str(),
                Some("On" | "on" | "true")
            ));
        }
        Ok(Self {
            data,
            resources,
            settings: Mutex::new(settings),
            docs: Mutex::new(HashMap::new()),
            encodings: Mutex::new(HashMap::new()),
            evaluations: Mutex::new(HashMap::new()),
            menu_actions: Mutex::new(HashMap::new()),
            menu_template: Mutex::new(Value::Null),
        })
    }
    pub fn config(&self) -> Value {
        self.settings.lock().unwrap().clone()
    }
    pub fn put(&self, key: &str, value: Value) -> Result<()> {
        let mut s = self.settings.lock().unwrap();
        s[key] = value;
        atomic_write(
            &self.data.join("conf/conf.user.json"),
            &serde_json::to_vec_pretty(&*s).map_err(err)?,
        )
    }
    pub fn recent(&self, key: &str, path: &str, add: bool) -> Result<()> {
        if add && self.config()["recordRecent"] == false {
            return Ok(());
        }
        let mut list: Vec<Value> = self.config()[key]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.as_str() != Some(path))
            .collect();
        if add {
            list.insert(0, json!(path));
        }
        list.truncate(24);
        self.put(key, json!(list))
    }
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Draft {
    pub id: String,
    pub file: Value,
    pub content: String,
    pub modified: i64,
    pub encoding: String,
}
