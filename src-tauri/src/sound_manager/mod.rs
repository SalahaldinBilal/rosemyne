use std::io::Cursor;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::SettingsHandler;

pub mod commands;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SoundKind {
    Capture,
    TaskSuccess,
}

impl SoundKind {
    pub fn file_stem(self) -> &'static str {
        match self {
            SoundKind::Capture => "capture",
            SoundKind::TaskSuccess => "task_success",
        }
    }

    fn default_bytes(self) -> &'static [u8] {
        match self {
            SoundKind::Capture => include_bytes!("../../assets/sounds/capture.flac"),
            SoundKind::TaskSuccess => include_bytes!("../../assets/sounds/task_success.flac"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SoundSetting {
    pub enabled: bool,
    /// File name under `sounds/` (next to settings.json); `None` = use the bundled default.
    pub custom_file: Option<String>,
    /// Playback volume as a percentage (0-100).
    pub volume: u8,
}

impl Default for SoundSetting {
    fn default() -> Self {
        Self {
            enabled: true,
            custom_file: None,
            volume: 100,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundSettings {
    #[serde(default = "default_capture_setting")]
    pub capture: SoundSetting,
    #[serde(default = "default_task_success_setting")]
    pub task_success: SoundSetting,
}

fn default_capture_setting() -> SoundSetting {
    SoundSetting {
        enabled: true,
        custom_file: None,
        volume: 100,
    }
}

fn default_task_success_setting() -> SoundSetting {
    SoundSetting {
        enabled: true,
        custom_file: None,
        volume: 80,
    }
}

impl Default for SoundSettings {
    fn default() -> Self {
        Self {
            capture: default_capture_setting(),
            task_success: default_task_success_setting(),
        }
    }
}

impl SoundSettings {
    pub fn get(&self, kind: SoundKind) -> &SoundSetting {
        match kind {
            SoundKind::Capture => &self.capture,
            SoundKind::TaskSuccess => &self.task_success,
        }
    }

    pub fn get_mut(&mut self, kind: SoundKind) -> &mut SoundSetting {
        match kind {
            SoundKind::Capture => &mut self.capture,
            SoundKind::TaskSuccess => &mut self.task_success,
        }
    }
}

pub fn sounds_dir() -> PathBuf {
    crate::default_app_path().join("sounds")
}

/// Plays `kind` if enabled in settings, using its custom file when set ,
/// falling back to the bundled default if that file is missing, unreadable,
/// or fails to decode.
pub async fn play_sound(app_handle: &AppHandle, kind: SoundKind) {
    let settings_handle = app_handle.state::<SettingsHandler>();
    let setting = settings_handle
        .read()
        .await
        .get_sound_settings()
        .get(kind)
        .clone();

    if setting.enabled {
        play_now(kind, setting.custom_file, setting.volume);
    }
}

/// Plays `kind` immediately regardless of its enabled setting , used by the
/// settings UI to audition a sound.
pub fn play_now(kind: SoundKind, custom_file: Option<String>, volume: u8) {
    std::thread::spawn(move || {
        let Ok(mut stream_handle) = rodio::OutputStreamBuilder::open_default_stream() else {
            return;
        };
        // The stream only drops after `sleep_until_end` returns, i.e. once
        // playback has already finished , rodio's default drop log implies
        // truncated audio, which isn't the case here.
        stream_handle.log_on_drop(false);
        let sink = rodio::Sink::connect_new(stream_handle.mixer());
        sink.set_volume(volume as f32 / 100.0);

        let custom_bytes = custom_file.and_then(|name| std::fs::read(sounds_dir().join(name)).ok());

        let source =
            match custom_bytes.and_then(|bytes| rodio::Decoder::new(Cursor::new(bytes)).ok()) {
                Some(source) => Some(source),
                None => rodio::Decoder::new(Cursor::new(kind.default_bytes().to_vec())).ok(),
            };

        let Some(source) = source else { return };
        sink.append(source);
        sink.sleep_until_end();
    });
}
