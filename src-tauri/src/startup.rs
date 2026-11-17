use std::sync::Mutex;

// Collect launch requests from before setup until the first windows are chosen.
// Once consumed, ordinary open events each create their own window.
pub struct StartupFiles(Mutex<Option<Vec<String>>>);

impl Default for StartupFiles {
    fn default() -> Self {
        Self(Mutex::new(Some(Vec::new())))
    }
}

impl StartupFiles {
    pub fn defer(&self, files: &[String]) -> bool {
        let mut pending = self.0.lock().unwrap();
        let Some(pending) = pending.as_mut() else {
            return false;
        };
        for file in files {
            if !pending.contains(file) {
                pending.push(file.clone());
            }
        }
        true
    }

    pub fn take_pending(&self) -> Vec<String> {
        self.0.lock().unwrap().as_mut().map(std::mem::take).unwrap_or_default()
    }

    pub fn finish(&self) -> Option<Vec<String>> {
        self.0.lock().unwrap().take()
    }

    #[cfg(target_os = "macos")]
    pub fn has_files(&self) -> bool {
        self.0
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|files| !files.is_empty())
    }

    #[cfg(any(target_os = "macos", test))]
    pub fn is_pending(&self) -> bool {
        self.0.lock().unwrap().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::StartupFiles;

    #[test]
    fn cold_open_events_are_kept_once_in_order() {
        let startup = StartupFiles::default();
        assert!(startup.defer(&["first.md".into(), "second.md".into()]));
        assert!(startup.defer(&["first.md".into()]));
        assert_eq!(startup.take_pending(), ["first.md", "second.md"]);
        assert!(startup.is_pending());
    }

    #[test]
    fn events_during_setup_survive_until_ready() {
        let startup = StartupFiles::default();
        startup.defer(&["before-setup.md".into()]);
        assert_eq!(startup.take_pending(), ["before-setup.md"]);
        startup.defer(&["during-setup.md".into()]);
        assert_eq!(startup.finish(), Some(vec!["during-setup.md".into()]));
        assert!(!startup.is_pending());
        assert!(!startup.defer(&["after-ready.md".into()]));
        assert!(startup.finish().is_none());
    }
}
