use std::collections::HashMap;
use std::ops::Deref;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::{
    HistoryStoreHandler, ScreenshotManagerHandler, ScreenshotWindowHandler, SettingsHandler,
    capture::{CapManager, capture_trait::CaptureManager},
    dimensions::impls::Dimensions,
    emit_on_main_thread,
    screen_manager::{
        screenshot_manager::{TagValue, now_ms},
        window::{WindowBounds, window_coverage_tags},
    },
    screenshot_window::{WindowManager, manager_trait::ScreenshotWindowManager},
};

use super::Recorder;
use super::error::RecordingError;
use super::recorder_trait::{RecordingOptions, ScreenRecorder, VideoCodec};

pub const RECORDING_HUD_LABEL: &str = "recording-hud";
pub const RECORDING_BORDER_LABEL: &str = "recording-border";

pub struct ActiveRecording {
    session: Recorder,
    temp_path: PathBuf,
    started_at_ms: u64,
    fps: u32,
    window_tags: Vec<HashMap<String, TagValue>>,
}

pub type RecordingManagerHandler = Arc<Mutex<Option<ActiveRecording>>>;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub started_at_ms: u64,
    pub with_audio: bool,
}

/// Starts recording the given overlay-relative region. `id` is the temp
/// capture the overlay was editing; it's discarded like a cancelled
/// screenshot. `with_audio` overrides the `record_audio` setting.
#[tauri::command]
pub async fn start_recording(
    recording_manager: State<'_, RecordingManagerHandler>,
    window_handler: State<'_, ScreenshotWindowHandler>,
    screenshot_manager: State<'_, ScreenshotManagerHandler>,
    history_store: State<'_, HistoryStoreHandler>,
    settings_handle: State<'_, SettingsHandler>,
    app_handle: AppHandle,
    region: Dimensions,
    id: Option<u16>,
    with_audio: Option<bool>,
) -> Result<RecordingStatus, RecordingError> {
    let mut manager = recording_manager.lock().await;
    if manager.is_some() {
        return Err(RecordingError::AlreadyRecording);
    }

    // Hide the overlay before enumerating windows or capturing, so it's
    // neither tagged nor recorded.
    let (base, monitors) = {
        let window_handler = window_handler.read().await;
        let Some(webview) = window_handler.deref() else {
            return Err(RecordingError::Failed(
                "The screenshotter window is not available".into(),
            ));
        };
        WindowManager::hide(webview);
        (webview.position.clone(), webview.monitor_positions.clone())
    };

    if let Some(id) = id {
        screenshot_manager.write().await.remove_image(&id);
    }

    let (fps, capture_audio, codec) = {
        let settings = settings_handle.read().await;
        let general = settings.get_general();
        (
            general.record_fps.clamp(1, 240),
            with_audio.unwrap_or(general.record_audio),
            general.record_codec,
        )
    };

    let region_virtual = WindowBounds {
        left: base.left + region.x as i32,
        top: base.top + region.y as i32,
        right: base.left + (region.x + region.width) as i32,
        bottom: base.top + (region.y + region.height) as i32,
        z_order: 0,
    };

    let windows = CapManager::get_visible_windows(&base);
    let window_tags = window_coverage_tags(&windows, &region);

    let temp_path = history_store
        .base_path()
        .join(format!(".recording-{}.mp4", rand::random::<u32>()));

    let options = RecordingOptions {
        region: region_virtual.clone(),
        fps,
        capture_audio,
        codec,
        output_path: temp_path.clone(),
    };

    // The border and HUD go up before the engine spins up, so the user sees
    // the recorded area and a "starting" state immediately; the windows are
    // pre-created at startup, so this is just a reposition + show.
    show_recording_windows(&app_handle, region_virtual, monitors);

    let session = match tauri::async_runtime::spawn_blocking(move || Recorder::start(options))
        .await
        .map_err(|err| RecordingError::Failed(err.to_string()))
        .and_then(|result| result)
    {
        Ok(session) => session,
        Err(err) => {
            hide_recording_windows(&app_handle);
            return Err(err);
        }
    };

    let status = RecordingStatus {
        started_at_ms: now_ms(),
        with_audio: session.with_audio(),
    };

    *manager = Some(ActiveRecording {
        session,
        temp_path,
        started_at_ms: status.started_at_ms,
        fps,
        window_tags,
    });

    Ok(status)
}

/// Codecs the running hardware/drivers can actually initialize (probed, not
/// just OS/crate support) , the settings UI only offers what's real.
#[tauri::command]
pub fn get_available_video_codecs() -> Vec<VideoCodec> {
    Recorder::available_codecs()
}

#[tauri::command]
pub async fn stop_recording(app_handle: AppHandle) -> Result<(), RecordingError> {
    finish_recording(&app_handle).await
}

/// Stops the active recording and saves it to history. Shared by the command
/// and the global-shortcut toggle.
pub async fn finish_recording(app_handle: &AppHandle) -> Result<(), RecordingError> {
    let recording_manager = app_handle.state::<RecordingManagerHandler>();
    let active = recording_manager
        .lock()
        .await
        .take()
        .ok_or(RecordingError::NotRecording)?;

    hide_recording_windows(app_handle);

    let (copy_to_clipboard, upload_template, file_name_template) = {
        let settings_handle = app_handle.state::<SettingsHandler>();
        let settings = settings_handle.read().await;
        let general = settings.get_general();
        (
            general.copy_to_clipboard_on_capture,
            general.upload_path.clone(),
            general.file_name_template.clone(),
        )
    };

    let history_store = app_handle.state::<HistoryStoreHandler>().inner().clone();

    let entry = tauri::async_runtime::spawn_blocking(move || {
        let ActiveRecording { session, temp_path, started_at_ms, fps, window_tags } = active;

        let with_audio = session.with_audio();
        let (width, height) = session.dimensions();
        let result = session.stop()?;
        let duration_ms = now_ms().saturating_sub(started_at_ms);

        let tags = HashMap::from([
            ("Windows".to_owned(), TagValue::MapArray(window_tags)),
            ("Timestamp".to_owned(), TagValue::date_time_millis(started_at_ms)),
            ("Duration".to_owned(), TagValue::time_millis(duration_ms)),
            ("Fps".to_owned(), TagValue::Uint(fps as u128)),
            ("Audio".to_owned(), TagValue::Bool(with_audio)),
        ]);

        let entry = history_store
            .save_recording(
                &temp_path,
                result.thumbnail.as_ref(),
                Some(tags),
                upload_template.as_deref(),
                file_name_template.as_deref(),
                width,
                height,
            )
            .map_err(|err| {
                RecordingError::Failed(format!("Failed to save the recording: {}", err))
            })?;

        if copy_to_clipboard {
            if let Err(err) = crate::file_clipboard::copy_file(&entry.file_path) {
                eprintln!("Failed to copy the recording to the clipboard: {}", err);
            }
        }

        Ok::<_, RecordingError>(entry)
    })
    .await
    .map_err(|err| RecordingError::Failed(err.to_string()))??;

    crate::notify_history_saved(app_handle, &entry);

    Ok(())
}

#[tauri::command]
pub async fn cancel_recording(
    recording_manager: State<'_, RecordingManagerHandler>,
    app_handle: AppHandle,
) -> Result<(), RecordingError> {
    let active = recording_manager
        .lock()
        .await
        .take()
        .ok_or(RecordingError::NotRecording)?;

    hide_recording_windows(&app_handle);

    tauri::async_runtime::spawn_blocking(move || active.session.cancel())
        .await
        .map_err(|err| RecordingError::Failed(err.to_string()))??;

    Ok(())
}

#[tauri::command]
pub async fn get_recording_status(
    recording_manager: State<'_, RecordingManagerHandler>,
) -> Result<Option<RecordingStatus>, ()> {
    let manager = recording_manager.lock().await;
    Ok(manager.as_ref().map(|active| RecordingStatus {
        started_at_ms: active.started_at_ms,
        with_audio: active.session.with_audio(),
    }))
}

pub async fn is_recording(app_handle: &AppHandle) -> bool {
    app_handle
        .state::<RecordingManagerHandler>()
        .lock()
        .await
        .is_some()
}

const HUD_LOGICAL_WIDTH: f64 = 300.0;
const HUD_LOGICAL_HEIGHT: f64 = 56.0;
const HUD_MARGIN: i32 = 12;
/// Stroke width (physical px) of the border ring drawn *outside* the recorded
/// region, so it never covers or appears in the recorded pixels.
const BORDER_PX: i32 = 3;

/// Pre-creates the recording chrome hidden, so showing it at record time is a
/// reposition + show instead of a multi-second webview spin-up.
pub fn create_recording_windows(app_handle: &AppHandle) {
    let handle = app_handle.clone();

    let result = app_handle.run_on_main_thread(move || {
        if handle.get_webview_window(RECORDING_BORDER_LABEL).is_none() {
            create_border_window(&handle);
        }
        if handle.get_webview_window(RECORDING_HUD_LABEL).is_none() {
            create_hud_window(&handle);
        }
    });

    if let Err(err) = result {
        eprintln!("Failed to schedule the recording windows creation: {}", err);
    }
}

/// Shows the recording chrome: a click-through border ring around the
/// recorded region and the always-on-top control bar near it , below when
/// there's room, above otherwise, tucked inside as a last resort. Both are
/// excluded from capture so they never show up in the video, which is also
/// why they can appear before the engine has finished starting. The shown
/// event resets the reused HUD page back to its "Starting…" state.
fn show_recording_windows(app_handle: &AppHandle, region: WindowBounds, monitors: Vec<WindowBounds>) {
    let handle = app_handle.clone();

    let result = app_handle.run_on_main_thread(move || {
        show_border_window(&handle, &region);
        show_hud_window(&handle, &region, &monitors);
    });

    if let Err(err) = result {
        eprintln!("Failed to schedule the recording windows show: {}", err);
    }

    emit_on_main_thread!(app_handle, "recording://overlay-shown", ());
}

fn create_border_window(app_handle: &AppHandle) -> Option<WebviewWindow> {
    let window = WebviewWindowBuilder::new(
        app_handle,
        RECORDING_BORDER_LABEL,
        WebviewUrl::App("/recording-border".into()),
    )
    .title("Rosemyne recording border")
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
            eprintln!("Failed to create the recording border: {}", err);
            return None;
        }
    };

    exclude_from_capture(&window);
    let _ = window.set_ignore_cursor_events(true);
    Some(window)
}

fn show_border_window(app_handle: &AppHandle, region: &WindowBounds) {
    let Some(window) = app_handle
        .get_webview_window(RECORDING_BORDER_LABEL)
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
        RECORDING_HUD_LABEL,
        WebviewUrl::App("/recording-hud".into()),
    )
    .title("Rosemyne recording")
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
            eprintln!("Failed to create the recording HUD: {}", err);
            return None;
        }
    };

    exclude_from_capture(&window);
    Some(window)
}

fn show_hud_window(app_handle: &AppHandle, region: &WindowBounds, monitors: &[WindowBounds]) {
    let Some(window) = app_handle
        .get_webview_window(RECORDING_HUD_LABEL)
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

/// Hides the recording chrome (the windows persist for the next recording)
/// and tells the reused HUD page to reset to idle.
fn hide_recording_windows(app_handle: &AppHandle) {
    for label in [RECORDING_HUD_LABEL, RECORDING_BORDER_LABEL] {
        if let Some(window) = app_handle.get_webview_window(label) {
            let _ = window.hide();
        }
    }

    emit_on_main_thread!(app_handle, "recording://overlay-hidden", ());
}

#[cfg(target_os = "windows")]
fn exclude_from_capture(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    };

    match window.hwnd() {
        Ok(hwnd) => unsafe {
            if let Err(err) = SetWindowDisplayAffinity(HWND(hwnd.0 as _), WDA_EXCLUDEFROMCAPTURE) {
                eprintln!("Failed to exclude the recording HUD from capture: {}", err);
            }
        },
        Err(err) => eprintln!("Failed to get the recording HUD handle: {}", err),
    }
}

#[cfg(not(target_os = "windows"))]
fn exclude_from_capture(_window: &tauri::WebviewWindow) {}
