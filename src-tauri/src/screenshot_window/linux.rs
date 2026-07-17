use tauri::{AppHandle, PhysicalPosition, Runtime, WebviewWindow};

use super::{base_window_builder, manager_trait::ScreenshotWindowManager};
use crate::{ScreenshotWebview, screen_manager::window::WindowBounds};

pub struct LinuxScreenshotWindowManager;

impl ScreenshotWindowManager for LinuxScreenshotWindowManager {
    fn create<R: Runtime>(
        app_handle: &AppHandle<R>,
        bounds: &WindowBounds,
    ) -> tauri::Result<WebviewWindow<R>> {
        // Off-screen parking doesn't work on most compositors (Wayland ignores
        // absolute positioning), so keep the window genuinely hidden instead.
        let window = base_window_builder(app_handle, bounds)
            .position(bounds.left as f64, bounds.top as f64)
            .visible(false)
            .build()?;

        window.set_ignore_cursor_events(true).ok();

        Ok(window)
    }

    fn show<R: Runtime>(webview: &ScreenshotWebview<R>) {
        webview.window.show().ok();
        webview
            .window
            .set_position(PhysicalPosition::new(
                webview.position.left,
                webview.position.top,
            ))
            .ok();
        webview.window.set_ignore_cursor_events(false).ok();
        webview.window.set_focus().ok();
    }

    fn hide<R: Runtime>(webview: &ScreenshotWebview<R>) {
        webview.window.set_ignore_cursor_events(true).ok();
        webview.window.hide().ok();
    }
}
