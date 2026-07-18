use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::{SettingsError, shortcuts::ShortcutBinding};
use crate::image_uploader::SavedUploader;
use crate::recording::recorder_trait::VideoCodec;
use crate::screen_manager::screenshot_manager::ScreenshotImageFormat;
use crate::sound_manager::{SoundKind, SoundSettings};

/// Tolerant per-element parse: a binding whose shape no longer fits (e.g. a
/// legacy shortcut from before the method/id reshape) is dropped instead of
/// failing the whole settings file and taking uploaders/general down with it.
fn deserialize_lenient_shortcuts<'de, D>(
    deserializer: D,
) -> Result<Vec<ShortcutBinding>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Vec::<serde_json::Value>::deserialize(deserializer)?;
    Ok(raw
        .into_iter()
        .filter_map(|value| serde_json::from_value::<ShortcutBinding>(value).ok())
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GeneralSettings {
    pub save_directory: Option<PathBuf>,
    pub upload_path: Option<String>,
    pub file_name_template: Option<String>,
    pub copy_to_clipboard_on_capture: bool,
    pub autostart: bool,
    pub record_audio: bool,
    pub record_fps: u32,
    pub record_codec: VideoCodec,
    pub screenshot_format: ScreenshotImageFormat,
    pub has_completed_onboarding: bool,
    pub check_for_updates_on_startup: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            save_directory: None,
            upload_path: Some("${year}-${month}".to_string()),
            file_name_template: None,
            copy_to_clipboard_on_capture: true,
            autostart: false,
            record_audio: true,
            record_fps: 30,
            record_codec: VideoCodec::default(),
            screenshot_format: ScreenshotImageFormat::default(),
            has_completed_onboarding: false,
            check_for_updates_on_startup: true,
        }
    }
}

impl GeneralSettings {
    pub fn effective_save_directory(&self, default: &Path) -> PathBuf {
        self.save_directory
            .clone()
            .unwrap_or_else(|| default.to_path_buf())
    }
}

/// User overrides for a new overlay item's starting attribute values, keyed by
/// overlay type ("box"/"text"/"blur"/"pixelate") then attribute name. Only
/// customized values are stored; anything missing falls back to the
/// frontend's built-in defaults (`OVERLAY_DEFAULT_ATTRIBUTES`). The value
/// shape (string/number/bool) is opaque to Rust , the frontend owns and
/// validates it against its own attribute schema.
pub type OverlayDefaultOverrides = HashMap<String, HashMap<String, serde_json::Value>>;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserSettings {
    #[serde(default, deserialize_with = "deserialize_lenient_shortcuts")]
    shortcuts: Vec<ShortcutBinding>,
    uploaders: Vec<SavedUploader>,
    default_uploader_id: Option<String>,
    general: GeneralSettings,
    sound: SoundSettings,
    overlay_defaults: OverlayDefaultOverrides,
}

#[derive(Debug)]
pub struct Settings {
    app_handle: Arc<AppHandle>,
    user_settings: UserSettings,
    settings_path: PathBuf,
}

impl Settings {
    pub fn new(app_handle: AppHandle, base_path: PathBuf) -> Self {
        Self {
            app_handle: Arc::new(app_handle),
            user_settings: UserSettings::default(),
            settings_path: base_path.join("settings.json"),
        }
    }

    pub fn add_shortcut(&mut self, shortcut: ShortcutBinding) -> Result<(), SettingsError> {
        if let Some(index) = self
            .user_settings
            .shortcuts
            .iter()
            .position(|s| s.id == shortcut.id)
        {
            let old_shortcut = self.user_settings.shortcuts.swap_remove(index);

            old_shortcut.unregister(&self.app_handle)?;
        }

        shortcut.register(&self.app_handle)?;

        self.user_settings.shortcuts.push(shortcut);
        self.save_settings()?;

        Ok(())
    }

    pub fn remove_shortcut(&mut self, id: &str) -> Result<(), SettingsError> {
        if let Some(index) = self
            .user_settings
            .shortcuts
            .iter()
            .position(|s| s.id == id)
        {
            let old_shortcut = self.user_settings.shortcuts.remove(index);
            old_shortcut.unregister(&self.app_handle)?;
            self.save_settings()?;
        }

        Ok(())
    }

    pub fn get_shortcuts(&self) -> &Vec<ShortcutBinding> {
        &self.user_settings.shortcuts
    }

    pub fn get_uploaders(&self) -> &Vec<SavedUploader> {
        &self.user_settings.uploaders
    }

    pub fn get_uploader(&self, id: &str) -> Option<&SavedUploader> {
        self.user_settings.uploaders.iter().find(|u| u.id == id)
    }

    pub fn get_default_uploader_id(&self) -> Option<&String> {
        self.user_settings.default_uploader_id.as_ref()
    }

    pub fn get_default_uploader(&self) -> Option<&SavedUploader> {
        self.user_settings
            .default_uploader_id
            .as_ref()
            .and_then(|id| self.get_uploader(id))
    }

    /// Inserts or updates (by id) the given uploader.
    ///
    /// The first saved uploader automatically becomes the default.
    pub fn save_uploader(&mut self, uploader: SavedUploader) -> Result<(), SettingsError> {
        match self
            .user_settings
            .uploaders
            .iter_mut()
            .find(|existing| existing.id == uploader.id)
        {
            Some(existing) => *existing = uploader,
            None => {
                if self.user_settings.uploaders.is_empty() {
                    self.user_settings.default_uploader_id = Some(uploader.id.clone());
                }

                self.user_settings.uploaders.push(uploader);
            }
        }

        self.save_settings()
    }

    pub fn delete_uploader(&mut self, id: &str) -> Result<(), SettingsError> {
        self.user_settings.uploaders.retain(|u| u.id != id);

        if self.user_settings.default_uploader_id.as_deref() == Some(id) {
            self.user_settings.default_uploader_id = None;
        }

        self.save_settings()
    }

    pub fn set_default_uploader(&mut self, id: Option<String>) -> Result<(), SettingsError> {
        self.user_settings.default_uploader_id = id.filter(|id| self.get_uploader(id).is_some());
        self.save_settings()
    }

    pub fn get_general(&self) -> &GeneralSettings {
        &self.user_settings.general
    }

    pub fn set_general(&mut self, general: GeneralSettings) -> Result<(), SettingsError> {
        self.user_settings.general = general;
        self.save_settings()
    }

    pub fn get_sound_settings(&self) -> &SoundSettings {
        &self.user_settings.sound
    }

    pub fn get_overlay_defaults(&self) -> &OverlayDefaultOverrides {
        &self.user_settings.overlay_defaults
    }

    pub fn set_overlay_defaults(&mut self, overlay_defaults: OverlayDefaultOverrides) -> Result<(), SettingsError> {
        self.user_settings.overlay_defaults = overlay_defaults;
        self.save_settings()
    }

    pub fn set_sound_enabled(&mut self, kind: SoundKind, enabled: bool) -> Result<(), SettingsError> {
        self.user_settings.sound.get_mut(kind).enabled = enabled;
        self.save_settings()
    }

    pub fn set_sound_custom_file(&mut self, kind: SoundKind, file_name: Option<String>) -> Result<(), SettingsError> {
        self.user_settings.sound.get_mut(kind).custom_file = file_name;
        self.save_settings()
    }

    pub fn set_sound_volume(&mut self, kind: SoundKind, volume: u8) -> Result<(), SettingsError> {
        self.user_settings.sound.get_mut(kind).volume = volume.min(100);
        self.save_settings()
    }

    pub fn save_settings(&self) -> Result<(), SettingsError> {
        if !self.settings_path.exists() {
            std::fs::create_dir_all(self.settings_path.parent().expect("should have path"))?;
        }

        std::fs::write(
            &self.settings_path,
            serde_json::to_vec_pretty(&self.user_settings)?,
        )?;

        Ok(())
    }

    pub fn read_settings(&mut self) -> Result<(), SettingsError> {
        if !self.settings_path.exists() {
            return Ok(());
        }

        let saved_settings = std::fs::read_to_string(&self.settings_path)?;
        let saved_settings = serde_json::from_str::<UserSettings>(&saved_settings)?;
        self.user_settings = saved_settings;

        for shortcut in &self.user_settings.shortcuts {
            shortcut.register(&self.app_handle)?;
        }

        Ok(())
    }
}
