#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
use linux::{render_cursor, snapshot_cursor};
#[cfg(target_os = "windows")]
use windows::{render_cursor, snapshot_cursor};

use std::sync::Arc;

use image::{ImageFormat, RgbaImage};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::emit_on_main_thread;
use crate::screen_manager::screenshot_manager::encode_image_as;

pub type CursorImageHandler = Arc<tauri::async_runtime::RwLock<Option<CursorImage>>>;

#[derive(Debug, Clone)]
pub struct CursorImage {
    pub info: CursorImageInfo,
    pub png: Vec<u8>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorImageInfo {
    /// Bumped per re-grab; also the image URL's cache buster.
    pub version: u32,
    pub width: u32,
    pub height: u32,
    pub hotspot_x: i32,
    pub hotspot_y: i32,
}

/// Which cursor was showing and where, cheap enough to take inline; `handle` is an `HICON` on Windows.
pub struct CursorSnapshot {
    pub handle: usize,
    pub width: i32,
    pub height: i32,
    pub hotspot_x: i32,
    pub hotspot_y: i32,
    pub screen_x: i32,
    pub screen_y: i32,
}

/// Hotspot moves with the image: transparent padding is cropped off before this is returned.
pub struct RenderedCursor {
    pub image: RgbaImage,
    pub hotspot_x: i32,
    pub hotspot_y: i32,
}

/// Shape taken inline (an overlay would replace it moments later), rendering deferred off the critical path.
pub fn refresh(app_handle: &AppHandle) {
    let Some(snapshot) = snapshot_cursor() else {
        return;
    };

    render_in_background(app_handle, snapshot);
}

/// Pointer position and cursor shape read in the same call, so neither can drift
/// before the other. Returns screen coordinates; the render still runs in the background.
pub fn capture_moment(app_handle: &AppHandle) -> Option<(i32, i32)> {
    let snapshot = snapshot_cursor()?;
    let position = (snapshot.screen_x, snapshot.screen_y);

    render_in_background(app_handle, snapshot);
    Some(position)
}

fn render_in_background(app_handle: &AppHandle, snapshot: CursorSnapshot) {
    let app_handle = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        let Ok(Some(rendered)) = tauri::async_runtime::spawn_blocking(move || render_cursor(snapshot)).await
        else {
            return;
        };

        let png = match encode_image_as(&rendered.image, ImageFormat::Png) {
            Ok(png) => png,
            Err(err) => {
                eprintln!("Failed to encode the cursor image: {err}");
                return;
            }
        };

        let handler = app_handle.state::<CursorImageHandler>();
        let mut cached = handler.write().await;

        let info = CursorImageInfo {
            version: cached.as_ref().map_or(1, |current| current.info.version + 1),
            width: rendered.image.width(),
            height: rendered.image.height(),
            hotspot_x: rendered.hotspot_x,
            hotspot_y: rendered.hotspot_y,
        };
        *cached = Some(CursorImage { info, png });
        drop(cached);

        emit_on_main_thread!(app_handle, "cursor://updated", info);
    });
}

#[tauri::command]
pub async fn get_cursor_image(
    cursor_image: State<'_, CursorImageHandler>,
) -> Result<Option<CursorImageInfo>, ()> {
    Ok(cursor_image.read().await.as_ref().map(|cursor| cursor.info))
}
