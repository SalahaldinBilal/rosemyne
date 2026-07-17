use tauri::{AppHandle, Runtime, WebviewWindow};

use crate::{ScreenshotWebview, screen_manager::window::WindowBounds};

pub trait ScreenshotWindowManager {
    /// Must be called on the main thread , the window inherits thread-level
    /// platform attributes (e.g. DPI awareness on Windows) from its creator.
    fn create<R: Runtime>(
        app_handle: &AppHandle<R>,
        bounds: &WindowBounds,
    ) -> tauri::Result<WebviewWindow<R>>;

    fn show<R: Runtime>(webview: &ScreenshotWebview<R>);

    fn hide<R: Runtime>(webview: &ScreenshotWebview<R>);
}
