use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::{
    HistoryStoreHandler, SettingsHandler, emit_on_main_thread,
    recording::commands::{disable_window_dragging, exclude_from_capture},
    screen_manager::{commands::monitor_identity, screenshot_manager::HistoryItemType, window::WindowBounds},
};

use super::{CAPTURE_PREVIEW_LABEL, PreviewClickAction, PreviewCorner};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CapturePreviewPayload {
    file_name: String,
    item_type: HistoryItemType,
    url: Option<String>,
    max_width: u32,
    max_height: u32,
    auto_dismiss_ms: u32,
    left_click_action: PreviewClickAction,
    right_click_action: PreviewClickAction,
}

pub fn create_capture_preview_window(app_handle: &AppHandle) {
    let handle = app_handle.clone();
    let result = app_handle.run_on_main_thread(move || {
        if handle.get_webview_window(CAPTURE_PREVIEW_LABEL).is_none() {
            create_window(&handle);
        }
    });

    if let Err(err) = result {
        eprintln!("Failed to schedule the capture preview window creation: {}", err);
    }
}

fn create_window(app_handle: &AppHandle) -> Option<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app_handle, CAPTURE_PREVIEW_LABEL, WebviewUrl::App("/capture-preview".into()))
        .title("Rosemyne capture preview")
        .inner_size(1.0, 1.0)
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
            eprintln!("Failed to create the capture preview window: {}", err);
            return None;
        }
    };

    exclude_from_capture(&window);
    disable_window_dragging(&window);
    Some(window)
}

/// Called after save and again after auto-upload; each call re-reads history so it reflects the latest state.
pub async fn trigger(app_handle: &AppHandle, history_store: &HistoryStoreHandler, file_name: &str) {
    let settings_handle = app_handle.state::<SettingsHandler>();
    let settings = settings_handle.read().await.get_capture_preview().clone();
    if !settings.enabled {
        return;
    }

    let Ok(Some(entry)) = history_store.get_by_file_name(file_name) else {
        return;
    };

    create_capture_preview_window(app_handle);

    emit_on_main_thread!(
        app_handle,
        "capture-preview://show",
        CapturePreviewPayload {
            file_name: entry.file_name,
            item_type: entry.item_type,
            url: entry.url,
            max_width: settings.max_width,
            max_height: settings.max_height,
            auto_dismiss_ms: settings.auto_dismiss_ms,
            left_click_action: settings.left_click_action,
            right_click_action: settings.right_click_action,
        }
    );
}

/// Sized to the frontend's measured content, not a fixed max canvas, so there's no transparent margin left over to block clicks.
#[tauri::command]
pub async fn show_capture_preview_window(
    app_handle: AppHandle,
    settings_handle: State<'_, SettingsHandler>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let settings = settings_handle.read().await.get_capture_preview().clone();

    if app_handle.get_webview_window(CAPTURE_PREVIEW_LABEL).is_none() {
        return Err("Capture preview window not found".into());
    }

    let (bounds, scale_factor) =
        resolve_monitor(&app_handle, &settings.monitor_id).ok_or("No monitor available")?;

    let margin_x = (settings.margin_x as f64 * scale_factor).round() as i32;
    let margin_y = (settings.margin_y as f64 * scale_factor).round() as i32;
    let (x, y) = compute_position(&bounds, settings.corner, margin_x, margin_y, width as i32, height as i32);

    let handle = app_handle.clone();
    let result = app_handle.run_on_main_thread(move || {
        let Some(window) = handle.get_webview_window(CAPTURE_PREVIEW_LABEL) else { return };
        let _ = window.set_size(PhysicalSize::new(width, height));
        let _ = window.set_position(PhysicalPosition::new(x, y));
        // Toggle off then on: setting `true` alone is a no-op and won't rejump it above the taskbar's band.
        let _ = window.set_always_on_top(false);
        let _ = window.set_always_on_top(true);
        let _ = window.show();
    });

    result.map_err(|err| err.to_string())
}

#[tauri::command]
pub fn hide_capture_preview_window(app_handle: AppHandle) {
    if let Some(window) = app_handle.get_webview_window(CAPTURE_PREVIEW_LABEL) {
        let _ = window.hide();
    }
}

fn compute_position(bounds: &WindowBounds, corner: PreviewCorner, margin_x: i32, margin_y: i32, width: i32, height: i32) -> (i32, i32) {
    let x = match corner {
        PreviewCorner::TopLeft | PreviewCorner::BottomLeft => bounds.left + margin_x,
        PreviewCorner::TopRight | PreviewCorner::BottomRight => bounds.right - margin_x - width,
    };
    let y = match corner {
        PreviewCorner::TopLeft | PreviewCorner::TopRight => bounds.top + margin_y,
        PreviewCorner::BottomLeft | PreviewCorner::BottomRight => bounds.bottom - margin_y - height,
    };
    (x, y)
}

/// Re-resolved by id on every show (not cached), since monitors can reconnect in a different order.
fn resolve_monitor(app_handle: &AppHandle, monitor_id: &Option<String>) -> Option<(WindowBounds, f64)> {
    if let Some(id) = monitor_id {
        if let Ok(monitors) = app_handle.available_monitors() {
            let found = monitors.iter().enumerate().find_map(|(index, monitor)| {
                if &monitor_identity(monitor.name(), index) != id {
                    return None;
                }
                Some(monitor_to_bounds(monitor))
            });

            if found.is_some() {
                return found;
            }
        }
    }

    if let Ok(Some(monitor)) = app_handle.primary_monitor() {
        return Some(monitor_to_bounds(&monitor));
    }

    app_handle
        .available_monitors()
        .ok()?
        .first()
        .map(monitor_to_bounds)
}

fn monitor_to_bounds(monitor: &tauri::Monitor) -> (WindowBounds, f64) {
    let bounds = WindowBounds {
        left: monitor.position().x,
        top: monitor.position().y,
        right: monitor.position().x + monitor.size().width as i32,
        bottom: monitor.position().y + monitor.size().height as i32,
        z_order: 0,
    };
    (bounds, monitor.scale_factor())
}
