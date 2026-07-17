use std::path::Path;

use tauri::State;

use crate::SettingsHandler;

use super::{SoundKind, SoundSetting, SoundSettings, play_now, sounds_dir};

#[tauri::command]
pub async fn get_sound_settings(settings_handle: State<'_, SettingsHandler>) -> Result<SoundSettings, ()> {
    Ok(settings_handle.read().await.get_sound_settings().clone())
}

#[tauri::command]
pub async fn set_sound_enabled(
    settings_handle: State<'_, SettingsHandler>,
    kind: SoundKind,
    enabled: bool,
) -> Result<(), String> {
    settings_handle
        .write()
        .await
        .set_sound_enabled(kind, enabled)
        .map_err(|err| err.to_string())
}

/// Copies the user-picked file (already resolved by the frontend's native file
/// dialog) into `sounds/<kind>.<ext>`, replacing any previous custom file for
/// that kind so extension changes don't leave orphans behind.
#[tauri::command]
pub async fn set_custom_sound(
    settings_handle: State<'_, SettingsHandler>,
    kind: SoundKind,
    path: String,
) -> Result<SoundSetting, String> {
    let source = Path::new(&path);
    let dest_dir = sounds_dir();
    std::fs::create_dir_all(&dest_dir).map_err(|err| err.to_string())?;

    let mut settings = settings_handle.write().await;

    if let Some(existing) = &settings.get_sound_settings().get(kind).custom_file {
        let _ = std::fs::remove_file(dest_dir.join(existing));
    }

    let ext = source.extension().and_then(|ext| ext.to_str()).unwrap_or("bin");
    let file_name = format!("{}.{}", kind.file_stem(), ext);
    std::fs::copy(source, dest_dir.join(&file_name)).map_err(|err| err.to_string())?;

    settings
        .set_sound_custom_file(kind, Some(file_name))
        .map_err(|err| err.to_string())?;

    Ok(settings.get_sound_settings().get(kind).clone())
}

#[tauri::command]
pub async fn reset_custom_sound(settings_handle: State<'_, SettingsHandler>, kind: SoundKind) -> Result<SoundSetting, String> {
    let mut settings = settings_handle.write().await;

    if let Some(existing) = &settings.get_sound_settings().get(kind).custom_file {
        let _ = std::fs::remove_file(sounds_dir().join(existing));
    }

    settings
        .set_sound_custom_file(kind, None)
        .map_err(|err| err.to_string())?;

    Ok(settings.get_sound_settings().get(kind).clone())
}

#[tauri::command]
pub async fn set_sound_volume(
    settings_handle: State<'_, SettingsHandler>,
    kind: SoundKind,
    volume: u8,
) -> Result<(), String> {
    settings_handle
        .write()
        .await
        .set_sound_volume(kind, volume)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn preview_sound(settings_handle: State<'_, SettingsHandler>, kind: SoundKind) -> Result<(), ()> {
    let setting = settings_handle.read().await.get_sound_settings().get(kind).clone();
    play_now(kind, setting.custom_file, setting.volume);
    Ok(())
}
