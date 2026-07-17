use tauri::{AppHandle, Runtime, WebviewUrl, WebviewWindowBuilder};

use crate::screen_manager::window::WindowBounds;

pub mod manager_trait;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "windows")]
pub type WindowManager = windows::WindowsScreenshotWindowManager;
#[cfg(target_os = "linux")]
pub type WindowManager = linux::LinuxScreenshotWindowManager;

pub const SCREENSHOT_WINDOW_LABEL: &str = "screenshotter";

pub(crate) fn base_window_builder<'a, R: Runtime>(
    app_handle: &'a AppHandle<R>,
    bounds: &WindowBounds,
) -> WebviewWindowBuilder<'a, R, AppHandle<R>> {
    WebviewWindowBuilder::new(
        app_handle,
        SCREENSHOT_WINDOW_LABEL,
        WebviewUrl::App("/screenshot".into()),
    )
    .title("Rosemyne screenshotter")
    .skip_taskbar(true)
    .shadow(false)
    .decorations(false)
    .transparent(true)
    .maximizable(false)
    .minimizable(false)
    .always_on_top(true)
    .inner_size(bounds.width() as f64, bounds.height() as f64)
}
