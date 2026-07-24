use std::collections::HashMap;
use std::ops::Deref;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use image::{ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::RwLock;
use tauri::{AppHandle, Emitter, State};
use wonfy_tools::tool::stitcher::{CheckDirection, ImageStitcherBuilder, MatchMode, Order};

use crate::{
    MouseHandler, ScreenshotManagerHandler, ScreenshotWindowHandler,
    capture::{CapManager, capture_trait::CaptureManager},
    capture_overlay,
    dimensions::impls::Dimensions,
    emit_on_main_thread,
    screen_manager::{
        screenshot_manager::{TagValue, encode_image_as},
        window::{WindowBounds, window_coverage_tags},
    },
    screenshot_window::{WindowManager, manager_trait::ScreenshotWindowManager},
};

use super::ScrollManager;
use super::ScrollDistance;
use super::error::ScrollCaptureError;
use super::result_window;
use super::scroll_trait::ScrollInputManager;

/// Per-instance tuning for one capture, set in the live-select overlay
/// (seeded from settings but not persisted back to them, see module docs).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollCaptureOverrides {
    pub max_frames: u32,
    pub frame_delay_ms: u32,
    pub scroll_distance: ScrollDistance,
}

#[derive(Clone)]
pub struct ScrollCaptureHandle {
    stop_requested: Arc<AtomicBool>,
    cancel_requested: Arc<AtomicBool>,
}

pub type ScrollCaptureManagerHandler = Arc<RwLock<Option<ScrollCaptureHandle>>>;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScrollCaptureProgress {
    frame: u32,
    max_frames: u32,
}

/// The raw frames behind a review session, kept so `restitch_scroll_capture`
/// can re-run the stitcher without recapturing; `current_image_id`/`width`/
/// `height` track whatever temp image the result window shows right now.
pub struct PendingScrollCapture {
    pub frames: Vec<Vec<u8>>,
    current_image_id: u16,
    width: u32,
    height: u32,
    frame_count: u32,
    default_params: StitchParams,
    /// Resolved once from the captured screen region, so a restitch keeps them.
    window_tags: Vec<HashMap<String, TagValue>>,
}

/// Single-slot, keyed by a random session id the frontend must present back
/// on every review command, so a stale reference can't touch the wrong session.
pub type PendingScrollCaptureHandler = Arc<RwLock<Option<(u16, PendingScrollCapture)>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum StitchMatchMode {
    #[default]
    Normal,
    Edges,
}

impl From<StitchMatchMode> for MatchMode {
    fn from(value: StitchMatchMode) -> Self {
        match value {
            StitchMatchMode::Normal => MatchMode::Normal,
            StitchMatchMode::Edges => MatchMode::Edges,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StitchParams {
    pub window_size: u32,
    pub crop: u32,
    pub match_mode: StitchMatchMode,
}

/// Fetched by a pull query on mount (`get_scroll_capture_session`) rather
/// than pushed, a brand-new webview isn't guaranteed to be listening yet.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScrollCaptureSession {
    session_id: u16,
    image_id: u16,
    width: u32,
    height: u32,
    frame_count: u32,
    default_params: StitchParams,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RestitchResult {
    pub image_id: u16,
    pub width: u32,
    pub height: u32,
}

/// Starts a scrolling capture of the given overlay-relative region and hands
/// the frames to the result window for review. `id` is the temp capture the
/// overlay was editing; it's discarded like a cancelled screenshot.
#[tauri::command]
pub async fn start_scrolling_capture(
    scroll_manager: State<'_, ScrollCaptureManagerHandler>,
    pending: State<'_, PendingScrollCaptureHandler>,
    window_handler: State<'_, ScreenshotWindowHandler>,
    screenshot_manager: State<'_, ScreenshotManagerHandler>,
    mouse_handler: State<'_, MouseHandler>,
    app_handle: AppHandle,
    region: Dimensions,
    id: Option<u16>,
    overrides: ScrollCaptureOverrides,
) -> Result<(), ScrollCaptureError> {
    if pending.read().await.is_some() {
        return Err(ScrollCaptureError::Failed(
            "Finish or discard the current scrolling capture review first".into(),
        ));
    }

    let handle = {
        let mut manager = scroll_manager.write().await;
        if manager.is_some() {
            return Err(ScrollCaptureError::AlreadyCapturing);
        }

        let handle = ScrollCaptureHandle {
            stop_requested: Arc::new(AtomicBool::new(false)),
            cancel_requested: Arc::new(AtomicBool::new(false)),
        };
        *manager = Some(handle.clone());
        handle
    };

    let result = run_capture(
        window_handler.inner(),
        screenshot_manager.inner(),
        mouse_handler.inner(),
        pending.inner(),
        &app_handle,
        region,
        id,
        overrides,
        &handle,
    )
    .await;

    *scroll_manager.write().await = None;

    result
}

/// Ends the loop early and stitches/saves whatever frames were captured so far.
#[tauri::command]
pub async fn stop_scrolling_capture(
    scroll_manager: State<'_, ScrollCaptureManagerHandler>,
) -> Result<(), ScrollCaptureError> {
    match scroll_manager.read().await.as_ref() {
        Some(handle) => {
            handle.stop_requested.store(true, Ordering::SeqCst);
            Ok(())
        }
        None => Err(ScrollCaptureError::NotCapturing),
    }
}

/// Aborts the loop and discards everything captured so far.
#[tauri::command]
pub async fn cancel_scrolling_capture(
    scroll_manager: State<'_, ScrollCaptureManagerHandler>,
) -> Result<(), ScrollCaptureError> {
    match scroll_manager.read().await.as_ref() {
        Some(handle) => {
            handle.cancel_requested.store(true, Ordering::SeqCst);
            Ok(())
        }
        None => Err(ScrollCaptureError::NotCapturing),
    }
}

enum LoopOutcome {
    Frames(Vec<Vec<u8>>),
    Cancelled,
}

async fn run_capture(
    window_handler: &ScreenshotWindowHandler,
    screenshot_manager: &ScreenshotManagerHandler,
    mouse_handler: &MouseHandler,
    pending: &PendingScrollCaptureHandler,
    app_handle: &AppHandle,
    region: Dimensions,
    id: Option<u16>,
    overrides: ScrollCaptureOverrides,
    handle: &ScrollCaptureHandle,
) -> Result<(), ScrollCaptureError> {
    // Hide the overlay before capturing so it's neither tagged nor captured,
    // same as start_recording.
    let (base, monitors) = {
        let window_handler = window_handler.read().await;
        let Some(webview) = window_handler.deref() else {
            return Err(ScrollCaptureError::Failed(
                "The screenshotter window is not available".into(),
            ));
        };
        WindowManager::hide(webview);
        (webview.position.clone(), webview.monitor_positions.clone())
    };

    if let Some(id) = id {
        screenshot_manager.write().await.remove_image(&id);
    }

    let region_virtual = WindowBounds {
        left: base.left + region.x as i32,
        top: base.top + region.y as i32,
        right: base.left + (region.x + region.width) as i32,
        bottom: base.top + (region.y + region.height) as i32,
        z_order: 0,
    };

    // Resolved here, with the overlay already hidden and before any scrolling
    // moves content around: coverage is of the captured screen region, which is
    // the only space these windows and the region share. The stitched output has
    // its own taller coordinate space, so it can't be recomputed at save time.
    let window_tags = window_coverage_tags(&CapManager::get_visible_windows(&base), &region);

    capture_overlay::show_overlay_windows(app_handle, region_virtual.clone(), monitors);
    emit_on_main_thread!(app_handle, "scroll-capture://overlay-shown", ());

    let outcome = capture_frames(mouse_handler, app_handle, &region_virtual, &overrides, handle).await;

    capture_overlay::hide_overlay_windows(app_handle);
    emit_on_main_thread!(app_handle, "scroll-capture://overlay-hidden", ());

    let frames = match outcome? {
        LoopOutcome::Cancelled => return Ok(()),
        LoopOutcome::Frames(frames) if frames.is_empty() => return Ok(()),
        LoopOutcome::Frames(frames) => frames,
    };

    let frame_count = frames.len() as u32;
    let default_params = StitchParams {
        window_size: window_size_for(region_virtual.height().max(0) as u32) as u32,
        crop: 5,
        match_mode: StitchMatchMode::Normal,
    };
    let stored_frames = frames.clone();
    let decoded = decode_frames(&frames)?;

    let preview_image = if decoded.len() == 1 {
        decoded.into_iter().next().expect("checked len == 1")
    } else {
        stitch_frames(
            decoded,
            default_params.window_size as usize,
            default_params.crop,
            default_params.match_mode.into(),
        )
        .await?
    };
    let (width, height) = (preview_image.width(), preview_image.height());

    // No snap-to-window targets: the stitched image no longer corresponds to
    // any single on-screen window layout, so offering one would just mislead.
    let image_id = {
        let mut manager = screenshot_manager.write().await;
        manager
            .add_screenshot_with_window_tags(preview_image, window_tags.clone())
            .map_err(|err| ScrollCaptureError::Failed(err.to_string()))?
    };

    let session_id = rand::random::<u16>();
    *pending.write().await = Some((
        session_id,
        PendingScrollCapture {
            frames: stored_frames,
            current_image_id: image_id,
            width,
            height,
            frame_count,
            default_params,
            window_tags,
        },
    ));

    // Stored before the window exists, so its mount-time query always finds it.
    result_window::show_result_window(app_handle);

    Ok(())
}

/// Captures until the content stops visibly changing between two consecutive
/// frames (the scrollable content has reached its end, or nothing scrolled at
/// all), `max_frames` is hit, or the user stops/cancels from the HUD.
async fn capture_frames(
    mouse_handler: &MouseHandler,
    app_handle: &AppHandle,
    region: &WindowBounds,
    overrides: &ScrollCaptureOverrides,
    handle: &ScrollCaptureHandle,
) -> Result<LoopOutcome, ScrollCaptureError> {
    let max_frames = overrides.max_frames.clamp(1, 500);
    let frame_delay_ms = overrides.frame_delay_ms.clamp(50, 5000);
    let notches = notches_for_distance(region.height(), overrides.scroll_distance);

    // Wheel input routes by focus, not by whatever's under the region, give
    // the target real focus once, up front, rather than per scroll step.
    ScrollManager::focus_target(region)?;

    let mut frames: Vec<Vec<u8>> = Vec::new();
    // Only the most recent raw capture is ever kept alive, everything else is
    // held WebP-encoded, rather than a whole session's worth of raw RGBA.
    let mut last_raw: Option<RgbaImage> = None;

    loop {
        if handle.cancel_requested.load(Ordering::SeqCst) {
            return Ok(LoopOutcome::Cancelled);
        }

        let frame = CapManager::capture(region)
            .map_err(|err| ScrollCaptureError::Failed(format!("Failed to capture a frame: {err}")))?;

        // Byte-identical to the last frame, scrolling produced no visible
        // change, so the bottom (or a non-scrollable target) has been reached.
        if last_raw.as_ref().is_some_and(|last| last.as_raw() == frame.as_raw()) {
            break;
        }

        frames.push(encode_frame(&frame)?);
        last_raw = Some(frame);

        emit_on_main_thread!(
            app_handle,
            "scroll-capture://progress",
            ScrollCaptureProgress {
                frame: frames.len() as u32,
                max_frames,
            }
        );

        if handle.stop_requested.load(Ordering::SeqCst) || frames.len() as u32 >= max_frames {
            break;
        }

        if let Err(err) = ScrollManager::scroll_step(-notches, mouse_handler) {
            eprintln!("Scroll step failed, stopping the capture early: {err}");
            break;
        }

        tokio::time::sleep(Duration::from_millis(frame_delay_ms as u64)).await;
    }

    Ok(LoopOutcome::Frames(frames))
}

/// The SAD match window (rows) suggested to the stitcher, just a starting
/// point the user can freely override in the result window. Defaults to 32,
/// only reduced when the captured region itself isn't even that tall (the
/// stitcher rejects a window taller than the frame).
const DEFAULT_WINDOW_SIZE: u32 = 32;

fn window_size_for(frame_height: u32) -> usize {
    DEFAULT_WINDOW_SIZE.min(frame_height.max(1)) as usize
}

/// A wheel notch carries no defined pixel distance, this approximate
/// pixels-per-notch constant is a guess, but one that scales with the
/// selected region instead of being a fixed notch count.
const ASSUMED_PIXELS_PER_WHEEL_NOTCH: f32 = 100.0;

fn notches_for_distance(region_height: i32, distance: ScrollDistance) -> i32 {
    let target_px = match distance {
        ScrollDistance::Percent(percent) => region_height as f32 * (percent.min(100) as f32 / 100.0),
        ScrollDistance::Pixels(pixels) => pixels as f32,
    };

    ((target_px / ASSUMED_PIXELS_PER_WHEEL_NOTCH).round() as i32).max(1)
}

fn encode_frame(frame: &RgbaImage) -> Result<Vec<u8>, ScrollCaptureError> {
    encode_image_as(frame, ImageFormat::WebP)
        .map_err(|err| ScrollCaptureError::Failed(format!("Failed to encode a captured frame: {err}")))
}

fn decode_frame(bytes: &[u8]) -> Result<RgbaImage, ScrollCaptureError> {
    image::load_from_memory_with_format(bytes, ImageFormat::WebP)
        .map(|image| image.into_rgba8())
        .map_err(|err| ScrollCaptureError::Failed(format!("Failed to decode a captured frame: {err}")))
}

fn decode_frames(frames: &[Vec<u8>]) -> Result<Vec<RgbaImage>, ScrollCaptureError> {
    frames.iter().map(|bytes| decode_frame(bytes)).collect()
}

async fn stitch_frames(
    frames: Vec<RgbaImage>,
    window_size: usize,
    crop: u32,
    match_mode: MatchMode,
) -> Result<RgbaImage, ScrollCaptureError> {
    tauri::async_runtime::spawn_blocking(move || {
        let stitcher = ImageStitcherBuilder::new()
            .images(frames)
            .order(Order::Ordered)
            .direction(CheckDirection::Vertical)
            .window_size(window_size)
            .match_mode(match_mode)
            .crop(crop)
            .build()
            .map_err(|err| ScrollCaptureError::Failed(format!("Failed to prepare the stitch: {err}")))?;

        let (image, _positions) = stitcher
            .stitch_blocking()
            .map_err(|err| ScrollCaptureError::Failed(format!("Failed to stitch the captured frames: {err}")))?;

        Ok::<_, ScrollCaptureError>(image)
    })
    .await
    .map_err(|err| ScrollCaptureError::Failed(err.to_string()))?
}

/// What the result window's page fetches on mount, see `ScrollCaptureSession`'s
/// doc comment for why this is a pull the page initiates rather than a push
/// event it would have to already be listening for.
#[tauri::command]
pub async fn get_scroll_capture_session(
    pending: State<'_, PendingScrollCaptureHandler>,
) -> Result<Option<ScrollCaptureSession>, ()> {
    Ok(pending.read().await.as_ref().map(|(session_id, session)| ScrollCaptureSession {
        session_id: *session_id,
        image_id: session.current_image_id,
        width: session.width,
        height: session.height,
        frame_count: session.frame_count,
        default_params: session.default_params,
    }))
}

/// Re-stitches an in-review session's frames with new parameters, swaps the
/// result window's preview to the new image, and drops the old one.
#[tauri::command]
pub async fn restitch_scroll_capture(
    pending: State<'_, PendingScrollCaptureHandler>,
    screenshot_manager: State<'_, ScreenshotManagerHandler>,
    session_id: u16,
    params: StitchParams,
    excluded_frames: Vec<usize>,
) -> Result<RestitchResult, ScrollCaptureError> {
    let frames = match pending.read().await.as_ref() {
        Some((id, session)) if *id == session_id => session.frames.clone(),
        _ => return Err(ScrollCaptureError::NotCapturing),
    };

    let excluded: std::collections::HashSet<usize> = excluded_frames.into_iter().collect();
    let included: Vec<Vec<u8>> = frames
        .into_iter()
        .enumerate()
        .filter(|(index, _)| !excluded.contains(index))
        .map(|(_, frame)| frame)
        .collect();

    if included.is_empty() {
        return Err(ScrollCaptureError::Failed(
            "Select at least one frame to keep".into(),
        ));
    }

    let decoded = decode_frames(&included)?;
    let window_size = (params.window_size as usize).max(1);
    let new_image = if decoded.len() == 1 {
        decoded.into_iter().next().expect("checked len == 1")
    } else {
        stitch_frames(decoded, window_size, params.crop, params.match_mode.into()).await?
    };
    let (width, height) = (new_image.width(), new_image.height());

    let mut guard = pending.write().await;
    let Some((id, session)) = guard.as_mut() else {
        return Err(ScrollCaptureError::NotCapturing);
    };
    if *id != session_id {
        return Err(ScrollCaptureError::NotCapturing);
    }

    let old_image_id = session.current_image_id;
    let new_image_id = {
        let mut manager = screenshot_manager.write().await;
        let new_id = manager
            .add_screenshot_with_window_tags(new_image, session.window_tags.clone())
            .map_err(|err| ScrollCaptureError::Failed(err.to_string()))?;
        manager.remove_image(&old_image_id);
        new_id
    };
    session.current_image_id = new_image_id;
    session.width = width;
    session.height = height;

    Ok(RestitchResult { image_id: new_image_id, width, height })
}

/// Ends a review session: frees the held frames and drops whatever temp
/// image was last showing (a no-op if a save already consumed it).
async fn end_review(
    pending: &PendingScrollCaptureHandler,
    screenshot_manager: &ScreenshotManagerHandler,
    session_id: u16,
) -> Result<(), ScrollCaptureError> {
    let session = {
        let mut guard = pending.write().await;
        match guard.as_ref() {
            Some((id, _)) if *id == session_id => guard.take().map(|(_, session)| session),
            _ => return Err(ScrollCaptureError::NotCapturing),
        }
    };

    if let Some(session) = session {
        screenshot_manager.write().await.remove_image(&session.current_image_id);
    }

    Ok(())
}

/// Cleanup for the result window being destroyed directly (e.g. the OS close
/// button) instead of through one of the review-ending commands.
pub async fn discard_any_pending_review(
    pending: &PendingScrollCaptureHandler,
    screenshot_manager: &ScreenshotManagerHandler,
) {
    let Some((_, session)) = pending.write().await.take() else {
        return;
    };
    screenshot_manager.write().await.remove_image(&session.current_image_id);
}

/// Discards the review session (frames + temp image) and closes the result
/// window without saving.
#[tauri::command]
pub async fn cancel_scroll_capture_review(
    pending: State<'_, PendingScrollCaptureHandler>,
    screenshot_manager: State<'_, ScreenshotManagerHandler>,
    app_handle: AppHandle,
    session_id: u16,
) -> Result<(), ScrollCaptureError> {
    end_review(&pending, &screenshot_manager, session_id).await?;
    result_window::close_result_window(&app_handle);
    Ok(())
}

/// Cleans up after a successful save (the image itself was already consumed
/// by `hide_and_save_screenshot`) and closes the result window.
#[tauri::command]
pub async fn finish_scroll_capture_review(
    pending: State<'_, PendingScrollCaptureHandler>,
    screenshot_manager: State<'_, ScreenshotManagerHandler>,
    app_handle: AppHandle,
    session_id: u16,
) -> Result<(), ScrollCaptureError> {
    end_review(&pending, &screenshot_manager, session_id).await?;
    result_window::close_result_window(&app_handle);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_size_defaults_to_32_unless_the_frame_is_shorter() {
        assert_eq!(window_size_for(0), 1);
        assert_eq!(window_size_for(10), 10);
        assert_eq!(window_size_for(32), 32);
        assert_eq!(window_size_for(400), 32);
        assert_eq!(window_size_for(u32::MAX), 32);
    }

    #[test]
    fn notches_scale_with_region_height_and_percent() {
        assert_eq!(notches_for_distance(1000, ScrollDistance::Percent(80)), 8);
        assert_eq!(notches_for_distance(500, ScrollDistance::Percent(80)), 4);
        // Over 100% clamps to 100%, never scrolls past the full region per step.
        assert_eq!(
            notches_for_distance(1000, ScrollDistance::Percent(150)),
            notches_for_distance(1000, ScrollDistance::Percent(100)),
        );
        // Always at least one notch, even for a tiny region or distance.
        assert_eq!(notches_for_distance(10, ScrollDistance::Percent(80)), 1);
        assert_eq!(notches_for_distance(1000, ScrollDistance::Pixels(0)), 1);
    }

    #[test]
    fn notches_for_pixels_ignore_region_height() {
        assert_eq!(notches_for_distance(1, ScrollDistance::Pixels(300)), 3);
        assert_eq!(notches_for_distance(10_000, ScrollDistance::Pixels(300)), 3);
    }
}
