use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::screen_manager::window::WindowBounds;

pub const OVERLAY_HUD_LABEL: &str = "capture-hud";
pub const OVERLAY_BORDER_LABEL: &str = "capture-border";

const HUD_LOGICAL_WIDTH: f64 = 300.0;
const HUD_LOGICAL_HEIGHT: f64 = 56.0;
const HUD_MARGIN: i32 = 12;
/// Stroke width (physical px) of the border ring drawn *outside* the region ,
/// it never covers or appears in the captured/recorded pixels.
const BORDER_PX: i32 = 3;

/// Pre-creates the border ring + status HUD hidden, so showing them later is
/// a reposition + show instead of a multi-second webview spin-up.
pub fn create_overlay_windows(app_handle: &AppHandle) {
    let handle = app_handle.clone();

    let result = app_handle.run_on_main_thread(move || {
        if handle.get_webview_window(OVERLAY_BORDER_LABEL).is_none() {
            create_border_window(&handle);
        }
        if handle.get_webview_window(OVERLAY_HUD_LABEL).is_none() {
            create_hud_window(&handle);
        }
    });

    if let Err(err) = result {
        eprintln!("Failed to schedule the capture overlay windows creation: {}", err);
    }
}

/// Shows the border ring and status HUD around the region, both excluded from
/// capture. Callers emit their own feature-specific "overlay-shown" event.
pub fn show_overlay_windows(app_handle: &AppHandle, region: WindowBounds, monitors: Vec<WindowBounds>) {
    let handle = app_handle.clone();

    let result = app_handle.run_on_main_thread(move || {
        show_border_window(&handle, &region);
        show_hud_window(&handle, &region, &monitors);
    });

    if let Err(err) = result {
        eprintln!("Failed to schedule the capture overlay windows show: {}", err);
    }
}

fn create_border_window(app_handle: &AppHandle) -> Option<WebviewWindow> {
    let window = WebviewWindowBuilder::new(
        app_handle,
        OVERLAY_BORDER_LABEL,
        WebviewUrl::App("/capture-border".into()),
    )
    .title("Rosemyne capture border")
    .inner_size(64.0, 64.0)
    .visible(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .focused(false)
    .build();

    let window = match window {
        Ok(window) => window,
        Err(err) => {
            eprintln!("Failed to create the capture border: {}", err);
            return None;
        }
    };

    exclude_from_capture(&window);
    disable_window_dragging(&window);
    let _ = window.set_ignore_cursor_events(true);
    Some(window)
}

fn show_border_window(app_handle: &AppHandle, region: &WindowBounds) {
    let Some(window) = app_handle
        .get_webview_window(OVERLAY_BORDER_LABEL)
        .or_else(|| create_border_window(app_handle))
    else {
        return;
    };

    // Physical bounds + 1:1 zoom (the screenshotter trick) so the CSS border
    // ring maps exactly onto the inflation around the region.
    let _ = window.set_position(tauri::PhysicalPosition::new(
        region.left - BORDER_PX,
        region.top - BORDER_PX,
    ));
    let _ = window.set_size(tauri::PhysicalSize::new(
        (region.right - region.left + 2 * BORDER_PX) as u32,
        (region.bottom - region.top + 2 * BORDER_PX) as u32,
    ));
    if let Ok(scale) = window.scale_factor() {
        let _ = window.set_zoom(1.0 / scale);
    }
    let _ = window.show();
}

fn create_hud_window(app_handle: &AppHandle) -> Option<WebviewWindow> {
    let window = WebviewWindowBuilder::new(
        app_handle,
        OVERLAY_HUD_LABEL,
        WebviewUrl::App("/capture-hud".into()),
    )
    .title("Rosemyne capture")
    .inner_size(HUD_LOGICAL_WIDTH, HUD_LOGICAL_HEIGHT)
    .visible(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .focused(false)
    .build();

    let window = match window {
        Ok(window) => window,
        Err(err) => {
            eprintln!("Failed to create the capture HUD: {}", err);
            return None;
        }
    };

    exclude_from_capture(&window);
    disable_window_dragging(&window);
    Some(window)
}

fn show_hud_window(app_handle: &AppHandle, region: &WindowBounds, monitors: &[WindowBounds]) {
    let Some(window) = app_handle
        .get_webview_window(OVERLAY_HUD_LABEL)
        .or_else(|| create_hud_window(app_handle))
    else {
        return;
    };

    // Land on the target monitor first so the scale factor reflects it, not
    // wherever the reused window last sat.
    let _ = window.set_position(tauri::PhysicalPosition::new(region.left, region.bottom));

    let scale = window.scale_factor().unwrap_or(1.0);
    let hud_width = (HUD_LOGICAL_WIDTH * scale) as i32;
    let hud_height = (HUD_LOGICAL_HEIGHT * scale) as i32;

    let monitor = monitors
        .iter()
        .find(|monitor| {
            let center_x = region.left + (region.right - region.left) / 2;
            let center_y = region.top + (region.bottom - region.top) / 2;
            center_x >= monitor.left
                && center_x < monitor.right
                && center_y >= monitor.top
                && center_y < monitor.bottom
        })
        .cloned()
        .unwrap_or_else(|| region.clone());

    let x = (region.right - hud_width)
        .max(monitor.left + HUD_MARGIN)
        .min(monitor.right - hud_width - HUD_MARGIN);

    let below = region.bottom + BORDER_PX + HUD_MARGIN;
    let above = region.top - BORDER_PX - HUD_MARGIN - hud_height;
    let y = if below + hud_height + HUD_MARGIN <= monitor.bottom {
        below
    } else if above >= monitor.top + HUD_MARGIN {
        above
    } else {
        region.bottom - HUD_MARGIN - hud_height
    };

    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    let _ = window.show();
}

/// Hides the capture chrome (the windows persist for next time). Callers are
/// responsible for emitting their own feature-specific "overlay-hidden" event.
pub fn hide_overlay_windows(app_handle: &AppHandle) {
    for label in [OVERLAY_HUD_LABEL, OVERLAY_BORDER_LABEL] {
        if let Some(window) = app_handle.get_webview_window(label) {
            let _ = window.hide();
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn exclude_from_capture(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    };

    match window.hwnd() {
        Ok(hwnd) => unsafe {
            if let Err(err) = SetWindowDisplayAffinity(HWND(hwnd.0 as _), WDA_EXCLUDEFROMCAPTURE) {
                eprintln!("Failed to exclude the capture overlay from capture: {}", err);
            }
        },
        Err(err) => eprintln!("Failed to get the capture overlay window handle: {}", err),
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn exclude_from_capture(_window: &tauri::WebviewWindow) {}

/// Blocks tools (e.g. AltSnap) that move/resize windows via `WM_SYSCOMMAND`, bypassing the title bar.
#[cfg(target_os = "windows")]
pub(crate) fn disable_window_dragging<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::SetWindowSubclass;

    match window.hwnd() {
        Ok(hwnd) => unsafe {
            let _ = SetWindowSubclass(HWND(hwnd.0 as _), Some(no_drag_subclass_proc), 1, 0);
        },
        Err(err) => eprintln!("Failed to get the window handle to disable dragging: {}", err),
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn disable_window_dragging<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

#[cfg(target_os = "windows")]
unsafe extern "system" fn no_drag_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::{SC_MOVE, SC_SIZE, WM_SYSCOMMAND};

    if msg == WM_SYSCOMMAND {
        let command = (wparam.0 as u32) & 0xFFF0;
        if command == SC_MOVE || command == SC_SIZE {
            return windows::Win32::Foundation::LRESULT(0);
        }
    }

    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}
