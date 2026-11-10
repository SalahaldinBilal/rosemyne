use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    SettingsHandler,
    recording::recorder_trait::{BitrateMode, VideoCodec},
    screen_manager::screenshot_manager::ScreenshotImageFormat,
    scrolling_capture::{ScrollDistance, ScrollingCaptureSettings},
    settings_manager::settings::Settings,
    sound_manager::SoundKind,
};

/// Per-shortcut replacements for the global settings. `None` uses the setting.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptureOverrides {
    pub copy_to_clipboard: Option<bool>,
    pub show_capture_preview: Option<bool>,
    pub capture_sound: Option<bool>,
    pub upload_sound: Option<bool>,
    pub upload: Option<UploadOverride>,
    pub file_name_template: Option<String>,
    pub save_path_template: Option<String>,
    pub screenshot_format: Option<ScreenshotImageFormat>,
    pub include_cursor: Option<bool>,
    pub record_audio: Option<bool>,
    pub record_fps: Option<u32>,
    pub record_codec: Option<VideoCodec>,
    pub record_bitrate_mbps: Option<u32>,
    pub record_bitrate_mode: Option<BitrateMode>,
    pub scroll_max_frames: Option<u32>,
    pub scroll_frame_delay_ms: Option<u32>,
    pub scroll_distance: Option<ScrollDistance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum UploadOverride {
    Skip,
    Uploader(String),
}

/// The settings one capture runs with, resolved once when it starts and carried
/// with it to the end, so later settings changes don't affect it.
#[derive(Debug, Clone)]
pub struct CaptureProfile {
    pub copy_to_clipboard: bool,
    pub show_capture_preview: bool,
    pub capture_sound: bool,
    pub upload_sound: bool,
    pub uploader_id: Option<String>,
    pub file_name_template: Option<String>,
    pub save_path_template: Option<String>,
    pub screenshot_format: ScreenshotImageFormat,
    pub include_cursor: bool,
    pub record_audio: bool,
    pub record_fps: u32,
    pub record_codec: VideoCodec,
    pub record_bitrate_mbps: u32,
    pub record_bitrate_mode: BitrateMode,
    pub scrolling_capture: ScrollingCaptureSettings,
}

impl CaptureProfile {
    pub fn resolve(settings: &Settings, overrides: &CaptureOverrides, is_instant_capture: bool) -> Self {
        let general = settings.get_general();
        let sounds = settings.get_sound_settings();
        let scrolling = settings.get_scrolling_capture();

        let uploader_id = match &overrides.upload {
            Some(UploadOverride::Skip) => None,
            Some(UploadOverride::Uploader(id)) => Some(id.clone()),
            None => settings.get_default_uploader().filter(|uploader| uploader.auto_upload).map(|uploader| uploader.id.clone()),
        };

        Self {
            copy_to_clipboard: overrides.copy_to_clipboard.unwrap_or(general.copy_to_clipboard_on_capture),
            show_capture_preview: overrides.show_capture_preview.unwrap_or(settings.get_capture_preview().enabled),
            capture_sound: overrides
                .capture_sound
                .unwrap_or_else(|| sounds.get(SoundKind::Capture).plays_for(is_instant_capture)),
            upload_sound: overrides
                .upload_sound
                .unwrap_or_else(|| sounds.get(SoundKind::TaskSuccess).plays_for(is_instant_capture)),
            uploader_id,
            file_name_template: overrides
                .file_name_template
                .clone()
                .filter(|template| !template.trim().is_empty())
                .or_else(|| general.file_name_template.clone()),
            save_path_template: overrides.save_path_template.clone().or_else(|| general.upload_path.clone()),
            screenshot_format: overrides.screenshot_format.unwrap_or(general.screenshot_format),
            include_cursor: overrides.include_cursor.unwrap_or(general.include_cursor),
            record_audio: overrides.record_audio.unwrap_or(general.record_audio),
            record_fps: overrides.record_fps.unwrap_or(general.record_fps),
            record_codec: overrides.record_codec.unwrap_or(general.record_codec),
            record_bitrate_mbps: overrides.record_bitrate_mbps.unwrap_or(general.record_bitrate_mbps),
            record_bitrate_mode: overrides.record_bitrate_mode.unwrap_or(general.record_bitrate_mode),
            scrolling_capture: ScrollingCaptureSettings {
                max_frames: overrides.scroll_max_frames.unwrap_or(scrolling.max_frames),
                frame_delay_ms: overrides.scroll_frame_delay_ms.unwrap_or(scrolling.frame_delay_ms),
                scroll_distance: overrides.scroll_distance.unwrap_or(scrolling.scroll_distance),
            },
        }
    }

    pub async fn load(app_handle: &AppHandle, overrides: &CaptureOverrides, is_instant_capture: bool) -> Self {
        let settings_handle = app_handle.state::<SettingsHandler>();
        let settings = settings_handle.read().await;
        Self::resolve(&settings, overrides, is_instant_capture)
    }

    pub async fn defaults(app_handle: &AppHandle) -> Self {
        Self::load(app_handle, &CaptureOverrides::default(), false).await
    }
}

/// Region-select overlays (record, scrolling capture) hand their result back
/// through a separate command, so the profile waits here until that runs.
static LIVE_OVERLAY_PROFILE: Mutex<Option<CaptureProfile>> = Mutex::new(None);

pub fn set_live_overlay_profile(profile: CaptureProfile) {
    if let Ok(mut slot) = LIVE_OVERLAY_PROFILE.lock() {
        *slot = Some(profile);
    }
}

pub async fn live_overlay_profile(app_handle: &AppHandle) -> CaptureProfile {
    let current = LIVE_OVERLAY_PROFILE.lock().ok().and_then(|slot| slot.clone());
    match current {
        Some(profile) => profile,
        None => CaptureProfile::defaults(app_handle).await,
    }
}
