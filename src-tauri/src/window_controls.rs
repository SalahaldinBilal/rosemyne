use serde::Deserialize;
use tauri::WebviewWindow;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowAction {
    Minimize,
    ToggleMaximize,
    Close,
    StartDragging,
}

/// The custom title bar's actions, an app command so the window plugin's ACL doesn't need widening.
#[tauri::command]
pub fn window_control(window: WebviewWindow, action: WindowAction) -> Result<(), String> {
    let result = match action {
        WindowAction::Minimize => window.minimize(),
        WindowAction::ToggleMaximize => match window.is_maximized() {
            Ok(true) => window.unmaximize(),
            Ok(false) => window.maximize(),
            Err(error) => Err(error),
        },
        WindowAction::Close => window.close(),
        WindowAction::StartDragging => window.start_dragging(),
    };

    result.map_err(|error| error.to_string())
}
