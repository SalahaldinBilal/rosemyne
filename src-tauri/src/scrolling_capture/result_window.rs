use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const RESULT_WINDOW_LABEL: &str = "scroll-capture-result";

const FALLBACK_WIDTH: f64 = 1000.0;
const FALLBACK_HEIGHT: f64 = 750.0;
const MAX_WIDTH: f64 = 1400.0;
const MAX_HEIGHT: f64 = 1000.0;

/// Unlike `capture_overlay`'s HUD/border or the screenshotter window, this one
/// has no "must appear instantly" requirement, it's a normal content-review
/// window the user looks at for a while, not a live overlay. So it's built
/// fresh on demand rather than pre-created hidden and reused; the caller is
/// expected to have already stored whatever session data the window's page
/// will ask for.
pub fn show_result_window(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window(RESULT_WINDOW_LABEL) {
        let _ = window.set_focus();
        return;
    }

    let (width, height) = default_size(app_handle);

    let result = WebviewWindowBuilder::new(
        app_handle,
        RESULT_WINDOW_LABEL,
        WebviewUrl::App("/scroll-capture-result".into()),
    )
    .title("Scrolling Capture")
    .inner_size(width, height)
    .min_inner_size(480.0, 360.0)
    .resizable(true)
    .decorations(true)
    .build();

    if let Err(err) = result {
        eprintln!("Failed to create the scrolling-capture result window: {}", err);
    }
}

/// Closes (not hides, there's nothing to reuse) the result window, if open.
pub fn close_result_window(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window(RESULT_WINDOW_LABEL) {
        let _ = window.close();
    }
}

fn default_size(app_handle: &AppHandle) -> (f64, f64) {
    let Ok(Some(monitor)) = app_handle.primary_monitor() else {
        return (FALLBACK_WIDTH, FALLBACK_HEIGHT);
    };

    let scale = monitor.scale_factor();
    let logical_width = monitor.size().width as f64 / scale;
    let logical_height = monitor.size().height as f64 / scale;

    ((logical_width * 0.9).min(MAX_WIDTH), (logical_height * 0.85).min(MAX_HEIGHT))
}
