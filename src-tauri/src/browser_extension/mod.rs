//! Local HTTP endpoint the browser extension sends media bytes to.

mod server;

use crate::SettingsHandler;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

/// Tried in order by both sides; all below the Windows ephemeral range (49152+).
pub const PORTS: [u16; 3] = [41873, 37619, 28463];

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserExtensionStatus {
    pub enabled: bool,
    pub port: Option<u16>,
    pub error: Option<String>,
}

struct Running {
    port: u16,
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

struct ServerState {
    running: Option<Running>,
    error: Option<String>,
}

static STATE: Mutex<ServerState> = Mutex::new(ServerState {
    running: None,
    error: None,
});

fn state() -> std::sync::MutexGuard<'static, ServerState> {
    STATE.lock().expect("browser extension state not poisoned")
}

pub(crate) fn temp_root() -> PathBuf {
    std::env::temp_dir().join("rosemyne-extension")
}

fn bind() -> Result<(tiny_http::Server, u16), String> {
    for port in PORTS {
        if let Ok(server) = tiny_http::Server::http(("127.0.0.1", port)) {
            return Ok((server, port));
        }
    }

    let ports = PORTS.map(|port| port.to_string()).join(", ");
    Err(format!("Ports {ports} are all in use by other programs"))
}

fn start(app_handle: &AppHandle) {
    let mut state = state();
    if state.running.is_some() {
        return;
    }

    match bind() {
        Ok((server, port)) => {
            let stop = Arc::new(AtomicBool::new(false));
            let thread_stop = stop.clone();
            let app_handle = app_handle.clone();
            let thread =
                std::thread::spawn(move || server::serve(server, port, thread_stop, app_handle));
            state.running = Some(Running { port, stop, thread });
            state.error = None;
        }
        Err(error) => state.error = Some(error),
    }
}

fn stop() {
    let running = {
        let mut state = state();
        state.error = None;
        state.running.take()
    };

    // Joined so the port is free again before a following start tries to bind it.
    if let Some(running) = running {
        running.stop.store(true, Ordering::SeqCst);
        let _ = running.thread.join();
    }
}

fn status(enabled: bool) -> BrowserExtensionStatus {
    let state = state();
    BrowserExtensionStatus {
        enabled,
        port: state.running.as_ref().map(|running| running.port),
        error: state.error.clone(),
    }
}

async fn apply(app_handle: &AppHandle, enabled: bool) -> Result<(), String> {
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if enabled {
            start(&app_handle);
        } else {
            stop();
        }
    })
    .await
    .map_err(|err| err.to_string())
}

pub async fn start_on_launch(app_handle: &AppHandle, settings_handle: &SettingsHandler) {
    let _ = std::fs::remove_dir_all(temp_root());

    if settings_handle.read().await.get_general().browser_extension {
        if let Err(err) = apply(app_handle, true).await {
            eprintln!("Failed to start the browser extension server: {err}");
        }
    }
}

#[tauri::command]
pub async fn get_browser_extension_status(
    settings_handle: State<'_, SettingsHandler>,
) -> Result<BrowserExtensionStatus, String> {
    Ok(status(settings_handle.read().await.get_general().browser_extension))
}

#[tauri::command]
pub async fn set_browser_extension(
    app_handle: AppHandle,
    settings_handle: State<'_, SettingsHandler>,
    enabled: bool,
) -> Result<BrowserExtensionStatus, String> {
    let mut settings = settings_handle.write().await;
    let mut general = settings.get_general().clone();
    general.browser_extension = enabled;
    settings.set_general(general).map_err(|err| err.to_string())?;
    drop(settings);

    apply(&app_handle, enabled).await?;
    Ok(status(enabled))
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExtensionStore {
    Chrome,
    Firefox,
}

impl ExtensionStore {
    fn url(self) -> &'static str {
        match self {
            ExtensionStore::Chrome => {
                "https://chromewebstore.google.com/detail/nhbdhfnpclndkganplkoggeeemkefmbb"
            }
            ExtensionStore::Firefox => "https://addons.mozilla.org/firefox/addon/rosemyne/",
        }
    }
}

#[tauri::command]
pub fn open_extension_store(app_handle: AppHandle, store: ExtensionStore) -> Result<(), String> {
    app_handle
        .opener()
        .open_url(store.url(), None::<&str>)
        .map_err(|err| err.to_string())
}
