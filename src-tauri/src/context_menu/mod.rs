//! File manager right-click "Upload" entries that import files exactly like a window drop.

#[cfg(target_os = "windows")]
mod cmrs;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "windows")]
mod registry;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "windows")]
use windows as platform;

use crate::screen_manager::screenshot_manager::HistoryItemType;
use crate::{HttpClientHandler, SettingsHandler};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tauri::State;
use tauri::async_runtime::Mutex;

pub const IMPORT_ARG: &str = "--import";
pub const UNREGISTER_ARG: &str = "--unregister-context-menu";

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuStatus {
    /// Whether this platform can add entries at all.
    pub supported: bool,
    pub enabled: bool,
    /// Platform-specific detail about where the entry shows up.
    pub note: Option<&'static str>,
    /// Only present where the Windows 11 menu exists.
    pub windows11: Option<Windows11MenuStatus>,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Windows11MenuStatus {
    pub enabled: bool,
    pub developer_mode: bool,
    pub cmrs: CmrsStatus,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CmrsStatus {
    pub latest_version: &'static str,
    pub installed: bool,
    /// `None` when not installed or not a published release.
    pub installed_version: Option<&'static str>,
    /// The installed version supports everything our config uses.
    pub compatible: bool,
}

pub(crate) struct MenuTitle {
    pub single: &'static str,
    pub plural: &'static str,
}

pub(crate) const FILE_TITLE: MenuTitle = MenuTitle {
    single: "Upload file",
    plural: "Upload files",
};

pub(crate) const TYPED_TITLES: [(&[&str], MenuTitle); 2] = [
    (
        HistoryItemType::IMAGE_EXTENSIONS,
        MenuTitle {
            single: "Upload image",
            plural: "Upload images",
        },
    ),
    (
        HistoryItemType::VIDEO_EXTENSIONS,
        MenuTitle {
            single: "Upload video",
            plural: "Upload videos",
        },
    ),
];

static APPLY_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

async fn blocking<T: Send + 'static>(task: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|err| err.to_string())
}

/// The paths following `--import`, resolved against the launching process's cwd.
pub fn import_paths_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    args.iter()
        .skip_while(|arg| *arg != IMPORT_ARG)
        .skip(1)
        .map(|path| cwd.join(path))
        .collect()
}

pub fn launched_with_import() -> bool {
    std::env::args().any(|arg| arg == IMPORT_ARG)
}

#[tauri::command]
pub async fn get_context_menu_status() -> Result<ContextMenuStatus, String> {
    blocking(platform::status).await
}

#[tauri::command]
pub async fn set_context_menu(
    http_client: State<'_, HttpClientHandler>,
    settings_handle: State<'_, SettingsHandler>,
    enabled: bool,
) -> Result<ContextMenuStatus, String> {
    let _guard = APPLY_LOCK.lock().await;
    platform::set_enabled(http_client.inner(), enabled).await?;

    let mut settings = settings_handle.write().await;
    let mut general = settings.get_general().clone();
    general.context_menu = enabled;
    settings.set_general(general).map_err(|err| err.to_string())?;
    drop(settings);

    get_context_menu_status().await
}

#[tauri::command]
pub async fn set_windows11_context_menu(
    http_client: State<'_, HttpClientHandler>,
    enabled: bool,
) -> Result<ContextMenuStatus, String> {
    #[cfg(target_os = "windows")]
    {
        let _guard = APPLY_LOCK.lock().await;
        windows::set_windows11_enabled(http_client.inner(), enabled).await?;
        get_context_menu_status().await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (http_client, enabled);
        Err("The Windows 11 context menu only exists on Windows 11".into())
    }
}

#[tauri::command]
pub async fn update_cmrs(
    http_client: State<'_, HttpClientHandler>,
) -> Result<ContextMenuStatus, String> {
    #[cfg(target_os = "windows")]
    {
        let _guard = APPLY_LOCK.lock().await;
        cmrs::update(http_client.inner()).await?;
        get_context_menu_status().await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = http_client;
        Err("windows11-context-rs only exists on Windows".into())
    }
}

/// Adds the entry when the setting wants it (on by default), then re-points
/// installed entries at the running exe and current labels.
pub async fn sync_on_startup(http_client: &HttpClientHandler, settings_handle: &SettingsHandler) {
    let wanted = settings_handle.read().await.get_general().context_menu;
    let _guard = APPLY_LOCK.lock().await;

    if wanted {
        let status = blocking(platform::status).await;
        if status.is_ok_and(|status| status.supported && !status.enabled) {
            if let Err(err) = platform::set_enabled(http_client, true).await {
                eprintln!("Failed to add the context menu entry: {err}");
            }
        }
    }

    // A dev build would steal the entries from the installed app on every launch.
    if !cfg!(debug_assertions) {
        platform::refresh(http_client).await;
    }
}

/// Uninstaller entry point; never touches the network.
pub fn unregister_all() {
    platform::unregister();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn import_paths_follow_the_import_flag() {
        let cwd = Path::new("/work");
        let paths = import_paths_from_args(&args(&["rosemyne", IMPORT_ARG, "/a.png", "b.mp4"]), cwd);
        assert_eq!(paths, [PathBuf::from("/a.png"), cwd.join("b.mp4")]);

        assert!(import_paths_from_args(&args(&["rosemyne", "--autostart"]), cwd).is_empty());
        assert!(import_paths_from_args(&args(&["rosemyne", IMPORT_ARG]), cwd).is_empty());
    }
}
