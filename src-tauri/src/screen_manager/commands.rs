use std::collections::HashMap;
use std::ops::Deref;

use image::RgbaImage;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State, image::Image};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

use crate::{
    HistoryStoreHandler, ScreenshotManagerHandler, ScreenshotWebview, ScreenshotWindowHandler,
    SettingsHandler,
    capture::{CapManager, capture_trait::CaptureManager},
    dimensions::impls::{Dimensions, Position},
    emit_on_main_thread,
    screen_manager::{
        screenshot_manager::{EncodeError, TagValue, now_ms},
        window::{WindowBounds, WindowInfo, calculate_visible_bounds, window_coverage_tags},
    },
    screenshot_window::{WindowManager, manager_trait::ScreenshotWindowManager},
    settings_manager::shortcuts::CaptureTarget,
};

#[tauri::command]
pub async fn full_screenshot(
    window_handler: State<'_, ScreenshotWindowHandler>,
    screenshot_manager: State<'_, ScreenshotManagerHandler>,
    history_store: State<'_, HistoryStoreHandler>,
    settings_handle: State<'_, SettingsHandler>,
    app_handle: AppHandle,
) -> Result<(), EncodeError> {
    take_screenshot(
        window_handler.inner(),
        screenshot_manager.inner(),
        history_store.inner(),
        settings_handle.inner(),
        &app_handle,
        None,
    )
    .await
}

/// Shows the overlay in region-pick mode: no capture is taken, the transparent
/// window is shown with a CSS dim layer, and the user drags a rectangle whose
/// absolute coords are reported back via `finish_region_pick`. Used by the
/// settings UI to define an instant-capture region.
#[tauri::command]
pub async fn start_region_pick(
    window_handler: State<'_, ScreenshotWindowHandler>,
    app_handle: AppHandle,
) -> Result<(), ()> {
    show_live_overlay(window_handler.inner(), &app_handle, OverlayMode::PickRegion).await
}

/// Shows the overlay in record mode: the same live region selection as a
/// region pick, but completing it starts a screen recording of the rectangle.
#[tauri::command]
pub async fn record_screen(
    window_handler: State<'_, ScreenshotWindowHandler>,
    app_handle: AppHandle,
) -> Result<(), ()> {
    open_record_overlay(window_handler.inner(), &app_handle).await
}

pub async fn open_record_overlay(
    window_handler: &ScreenshotWindowHandler,
    app_handle: &AppHandle,
) -> Result<(), ()> {
    show_live_overlay(window_handler, app_handle, OverlayMode::Record).await
}

/// Shows the overlay in scroll-capture mode: the same live region selection as
/// a region pick, but completing it starts a scrolling capture of the rectangle.
#[tauri::command]
pub async fn scrolling_capture_screen(
    window_handler: State<'_, ScreenshotWindowHandler>,
    app_handle: AppHandle,
) -> Result<(), ()> {
    open_scroll_capture_overlay(window_handler.inner(), &app_handle).await
}

pub async fn open_scroll_capture_overlay(
    window_handler: &ScreenshotWindowHandler,
    app_handle: &AppHandle,
) -> Result<(), ()> {
    show_live_overlay(window_handler, app_handle, OverlayMode::ScrollCapture).await
}

enum OverlayMode {
    PickRegion,
    Record,
    ScrollCapture,
}

/// Shows the transparent overlay over the live desktop (no pixel capture) for
/// the modes that only need a rectangle: region picking and recording.
async fn show_live_overlay(
    window_handler: &ScreenshotWindowHandler,
    app_handle: &AppHandle,
    mode: OverlayMode,
) -> Result<(), ()> {
    let window_handler = window_handler.read().await;
    let Some(webview) = window_handler.deref() else {
        return Ok(());
    };

    // Enumerating windows (no pixel capture) keeps right-click snap-to-window
    // working while picking a region.
    let windows = CapManager::get_visible_windows(&webview.position);

    WindowManager::show(webview);

    let mouse_position = match app_handle.cursor_position() {
        Ok(pos) => Position {
            x: (pos.x as i32 - webview.position.left).max(0) as u32,
            y: (pos.y as i32 - webview.position.top).max(0) as u32,
        },
        Err(_) => Position { x: 0, y: 0 },
    };

    let data = Data {
        mouse_position,
        windows,
        image_id: 0,
        pick_region: matches!(mode, OverlayMode::PickRegion),
        record: matches!(mode, OverlayMode::Record),
        scroll_capture: matches!(mode, OverlayMode::ScrollCapture),
        monitor_positions: webview
            .monitor_positions
            .iter()
            .filter_map(|a| a.to_normalized_dimensions(&webview.position))
            .collect(),
    };

    emit_on_main_thread!(webview.window, "screenshot://data", data);

    Ok(())
}

/// Ends a region pick: hides the overlay and emits `region-pick://result` to the
/// settings window with the absolute rectangle (or `null` when cancelled).
#[tauri::command]
pub async fn finish_region_pick(
    window_handler: State<'_, ScreenshotWindowHandler>,
    app_handle: AppHandle,
    region: Option<Dimensions>,
) -> Result<(), ()> {
    let base = {
        let window_handler = window_handler.read().await;
        match window_handler.deref() {
            Some(webview) => {
                WindowManager::hide(webview);
                Some((webview.position.left, webview.position.top))
            }
            None => None,
        }
    };

    let result = region.map(|region| {
        let (left, top) = base.unwrap_or((0, 0));
        RegionPickResult {
            x: left + region.x as i32,
            y: top + region.y as i32,
            width: region.width,
            height: region.height,
        }
    });

    emit_on_main_thread!(app_handle, "region-pick://result", result);

    Ok(())
}

#[tauri::command]
pub async fn delete_screenshot(
    history_store: State<'_, HistoryStoreHandler>,
    file_name: String,
) -> Result<(), String> {
    history_store
        .delete_with_file(&file_name)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn copy_screenshot_to_clipboard(
    history_store: State<'_, HistoryStoreHandler>,
    app_handle: AppHandle,
    file_name: String,
) -> Result<(), String> {
    let file_path = history_store
        .get_by_file_name(&file_name)
        .map_err(|err| err.to_string())?
        .ok_or("Image not found in history")?
        .file_path;

    let image = image::open(&file_path)
        .map_err(|err| err.to_string())?
        .into_rgba8();

    app_handle
        .clipboard()
        .write_image(&Image::new(image.as_raw(), image.width(), image.height()))
        .map_err(|err| err.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageEditSession {
    image_id: u16,
    width: u32,
    height: u32,
}

/// Loads a saved history image back into `ScreenshotManager` as an ordinary
/// temp capture, so the main window's viewer can annotate it through the exact
/// same `preview/<id>` + `hide_and_save_screenshot` path a fresh capture uses.
/// The save that follows writes a *new* history entry, it never overwrites the
/// original. Empty (not `None`) windows: no snap-to-window targets apply to an
/// already-saved image, and `None` would make the eventual save silently drop.
#[tauri::command]
pub async fn begin_image_edit(
    history_store: State<'_, HistoryStoreHandler>,
    screenshot_manager: State<'_, ScreenshotManagerHandler>,
    file_name: String,
) -> Result<ImageEditSession, String> {
    let entry = history_store
        .get_by_file_name(&file_name)
        .map_err(|err| err.to_string())?
        .ok_or("Image not found in history")?;

    // Inherited from the original: an edit is derived from that capture, and
    // there's no live window layout to re-derive them from now.
    let window_tags = match entry.tags.as_ref().and_then(|tags| tags.get("Windows")) {
        Some(TagValue::MapArray(windows)) => windows.clone(),
        _ => Vec::new(),
    };

    let image = image::open(&entry.file_path)
        .map_err(|err| err.to_string())?
        .into_rgba8();
    let (width, height) = (image.width(), image.height());

    let image_id = screenshot_manager
        .write()
        .await
        .add_screenshot_with_window_tags(image, window_tags)
        .map_err(|err| err.to_string())?;

    Ok(ImageEditSession { image_id, width, height })
}

/// Drops the temp image `begin_image_edit` staged, for an edit the user
/// abandoned instead of saving (a save consumes it itself).
#[tauri::command]
pub async fn cancel_image_edit(
    screenshot_manager: State<'_, ScreenshotManagerHandler>,
    image_id: u16,
) -> Result<(), String> {
    screenshot_manager.write().await.remove_image(&image_id);
    Ok(())
}

/// Copies plain text, used by the UI for already-uploaded entries' URLs.
#[tauri::command]
pub async fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::file_clipboard::copy_text(&text))
        .await
        .map_err(|err| err.to_string())?
}

/// Puts the file itself on the clipboard (paste-as-file), for entries whose
/// pixels can't be copied: videos and imported non-image files.
#[tauri::command]
pub async fn copy_file_to_clipboard(
    history_store: State<'_, HistoryStoreHandler>,
    file_name: String,
) -> Result<(), String> {
    let file_path = history_store
        .get_by_file_name(&file_name)
        .map_err(|err| err.to_string())?
        .ok_or("File not found in history")?
        .file_path;

    tauri::async_runtime::spawn_blocking(move || crate::file_clipboard::copy_file(&file_path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn show_in_folder(
    history_store: State<'_, HistoryStoreHandler>,
    app_handle: AppHandle,
    file_name: String,
) -> Result<(), String> {
    let file_path = history_store
        .get_by_file_name(&file_name)
        .map_err(|err| err.to_string())?
        .ok_or("Image not found in history")?
        .file_path;

    #[cfg(target_os = "windows")]
    {
        let _ = &app_handle;
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&file_path)
            .spawn()
            .map_err(|err| err.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let folder = file_path.parent().unwrap_or(&file_path);
        app_handle
            .shell()
            .open(folder.to_string_lossy(), None)
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

/// Opens the file itself with the OS-associated default application.
#[tauri::command]
pub async fn open_file(
    history_store: State<'_, HistoryStoreHandler>,
    app_handle: AppHandle,
    file_name: String,
) -> Result<(), String> {
    let file_path = history_store
        .get_by_file_name(&file_name)
        .map_err(|err| err.to_string())?
        .ok_or("File not found in history")?
        .file_path;

    app_handle
        .opener()
        .open_path(file_path.to_string_lossy(), None::<&str>)
        .map_err(|err| err.to_string())
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Data {
    pub image_id: u16,
    pub windows: Vec<WindowInfo>,
    pub monitor_positions: Vec<Dimensions>,
    pub mouse_position: Position,
    /// When true the overlay only picks a region (for an instant-capture
    /// shortcut) and reports it back instead of saving a screenshot.
    pub pick_region: bool,
    /// When true the overlay picks a region live (like `pick_region`) and
    /// starts a screen recording of it on selection.
    pub record: bool,
    /// When true the overlay picks a region live (like `pick_region`) and
    /// starts a scrolling capture of it on selection.
    pub scroll_capture: bool,
}

/// Absolute virtual-desktop rectangle chosen by the region picker, reported to
/// the settings window. `x`/`y` are `i32` because monitors left of/above the
/// primary have negative origins.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RegionPickResult {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

pub async fn take_screenshot(
    window_handler: &ScreenshotWindowHandler,
    screenshot_manager: &ScreenshotManagerHandler,
    history_store: &HistoryStoreHandler,
    settings_handle: &SettingsHandler,
    app_handle: &AppHandle,
    capture_target: Option<CaptureTarget>,
) -> Result<(), EncodeError> {
    if let Some(target) = capture_target {
        return instant_capture(target, history_store, settings_handle, app_handle).await;
    }

    let window_handler = window_handler.read().await;
    let mut screenshot_manager = screenshot_manager.write().await;

    if let Some(window_handler) = window_handler.deref() {
        let image = CapManager::capture(&window_handler.position);

        match image {
            Ok(image) => {
                let mut windows = CapManager::get_visible_windows(&window_handler.position);

                let desktop_bounds = window_handler
                    .position
                    .to_normalized_ordered_dimensions(&window_handler.position);

                if let Some(desktop_bounds) = desktop_bounds {
                    windows.push(WindowInfo::new(
                        "Desktop".into(),
                        "desktop".into(),
                        desktop_bounds.clone(),
                        desktop_bounds,
                        vec![],
                    ));
                }

                let windows = calculate_visible_bounds(windows);

                let id = screenshot_manager.add_screenshot(image, Some(windows.clone()))?;
                drop(screenshot_manager);

                emit_editor_data(window_handler, app_handle, id, windows);

                return Ok(());
            }
            Err(error) => {
                eprintln!("Failed to capture screenshot: {:#?}", error);
                return Err(EncodeError::NotExists);
            }
        }
    }

    Ok(())
}

/// Shows the screenshotter window and (re)opens its normal edit view on an
/// already in-memory temp image. Used by a fresh capture (`take_screenshot`,
/// which already holds the read lock this needs).
fn emit_editor_data<R: tauri::Runtime>(
    webview: &ScreenshotWebview<R>,
    app_handle: &AppHandle,
    image_id: u16,
    windows: Vec<WindowInfo>,
) {
    WindowManager::show(webview);

    // Normalized the same way monitor_positions is below: relative to the
    // screenshotter window's own top-left, not the raw (possibly negative,
    // if a monitor sits left of/above the primary) virtual-desktop origin.
    let mouse_position = match app_handle.cursor_position() {
        Ok(pos) => Position {
            x: (pos.x as i32 - webview.position.left).max(0) as u32,
            y: (pos.y as i32 - webview.position.top).max(0) as u32,
        },
        Err(_) => Position { x: 0, y: 0 },
    };

    let data = Data {
        mouse_position,
        windows,
        image_id,
        pick_region: false,
        record: false,
        scroll_capture: false,
        monitor_positions: webview
            .monitor_positions
            .iter()
            .filter_map(|a| a.to_normalized_dimensions(&webview.position))
            .collect(),
    };

    emit_on_main_thread!(webview.window, "screenshot://data", data);
}

/// Immediate capture with no overlay: grab the target's bounds, tag the windows
/// under them, and persist through the exact same path as a normal screenshot.
async fn instant_capture(
    target: CaptureTarget,
    history_store: &HistoryStoreHandler,
    settings_handle: &SettingsHandler,
    app_handle: &AppHandle,
) -> Result<(), EncodeError> {
    let Some(bounds) = resolve_capture_bounds(&target, app_handle) else {
        return Ok(());
    };

    let image = match CapManager::capture(&bounds) {
        Ok(image) => image,
        Err(error) => {
            eprintln!("Failed to capture instant screenshot: {:#?}", error);
            return Err(EncodeError::NotExists);
        }
    };

    let windows = CapManager::get_visible_windows(&bounds);
    let region = Dimensions {
        x: 0,
        y: 0,
        width: bounds.width() as u32,
        height: bounds.height() as u32,
    };

    persist_capture(
        app_handle,
        history_store,
        settings_handle,
        &image,
        window_coverage_tags(&windows, &region),
        true,
    )
    .await;

    Ok(())
}

/// Resolves an instant-capture target to a virtual-desktop rectangle. Returns
/// `None` (after logging) when a monitor is gone or a region has zero area.
fn resolve_capture_bounds(target: &CaptureTarget, app_handle: &AppHandle) -> Option<WindowBounds> {
    match target {
        CaptureTarget::Region {
            x,
            y,
            width,
            height,
        } => {
            if *width == 0 || *height == 0 {
                eprintln!("Instant capture region has zero area, skipping");
                return None;
            }

            Some(WindowBounds {
                left: *x,
                top: *y,
                right: *x + *width as i32,
                bottom: *y + *height as i32,
                z_order: 0,
            })
        }
        CaptureTarget::Monitor { id } => {
            let monitors = match app_handle.available_monitors() {
                Ok(monitors) => monitors,
                Err(error) => {
                    eprintln!("Failed to list monitors for instant capture: {}", error);
                    return None;
                }
            };

            let bounds = monitors.iter().enumerate().find_map(|(index, monitor)| {
                if &monitor_identity(monitor.name(), index) != id {
                    return None;
                }

                Some(WindowBounds {
                    left: monitor.position().x,
                    top: monitor.position().y,
                    right: monitor.position().x + monitor.size().width as i32,
                    bottom: monitor.position().y + monitor.size().height as i32,
                    z_order: 0,
                })
            });

            if bounds.is_none() {
                eprintln!("Instant capture monitor '{}' is no longer available", id);
            }

            bounds
        }
    }
}

/// Stable per-monitor identity shared by `list_monitors` and instant-capture
/// resolution: the OS monitor name, or a positional fallback.
pub(crate) fn monitor_identity(name: Option<&String>, index: usize) -> String {
    name.cloned().unwrap_or_else(|| format!("monitor-{index}"))
}

/// The shared "save exactly like a normal screenshot" tail: build the window +
/// timestamp tags, persist, copy to clipboard per settings, then notify the main
/// window. Used by both the overlay save (`save_rendered_screenshot`) and
/// instant captures.
pub(crate) async fn persist_capture(
    app_handle: &AppHandle,
    history_store: &HistoryStoreHandler,
    settings_handle: &SettingsHandler,
    image: &RgbaImage,
    window_tags: Vec<HashMap<String, TagValue>>,
    play_sound: bool,
) {
    let (copy_to_clipboard, upload_template, file_name_template, screenshot_format) = {
        let settings = settings_handle.read().await;
        let general = settings.get_general();
        (
            general.copy_to_clipboard_on_capture,
            general.upload_path.clone(),
            general.file_name_template.clone(),
            general.screenshot_format,
        )
    };

    let tags = HashMap::from([
        ("Windows".to_owned(), TagValue::MapArray(window_tags)),
        ("Timestamp".to_owned(), TagValue::date_time_millis(now_ms())),
    ]);

    let saved_image = match history_store.save_rendered(
        image,
        Some(tags),
        upload_template.as_deref(),
        file_name_template.as_deref(),
        screenshot_format,
    ) {
        Ok(saved_image) => saved_image,
        Err(err) => {
            eprintln!("Failed to save capture: {}", err);
            return;
        }
    };

    if copy_to_clipboard {
        if let Err(err) = crate::file_clipboard::copy_file(&saved_image.file_path) {
            eprintln!("Failed to copy screenshot to clipboard: {}", err);
        }
    }

    if play_sound {
        crate::sound_manager::play_sound(app_handle, crate::sound_manager::SoundKind::Capture).await;
    }
    crate::notify_history_saved(app_handle, &saved_image);
}
