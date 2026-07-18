use crate::capture_preview::CapturePreviewSettings;
use crate::image_uploader::SavedUploader;
use crate::settings_manager::SettingsError;
use crate::settings_manager::settings::{GeneralSettings, OverlayDefaultOverrides};
use crate::settings_manager::shortcuts::ShortcutBinding;
use crate::{HistoryStoreHandler, SettingsHandler};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub async fn add_shortcut(
    settings_handle: State<'_, SettingsHandler>,
    new_shortcut: ShortcutBinding,
) -> Result<(), SettingsError> {
    let mut settings = settings_handle.write().await;
    settings.add_shortcut(new_shortcut)
}

#[tauri::command]
pub async fn remove_shortcut(
    settings_handle: State<'_, SettingsHandler>,
    id: String,
) -> Result<(), SettingsError> {
    let mut settings = settings_handle.write().await;
    settings.remove_shortcut(&id)
}

#[tauri::command]
pub async fn get_shortcuts(
    settings_handle: State<'_, SettingsHandler>,
) -> Result<Vec<ShortcutBinding>, ()> {
    let settings = settings_handle.read().await;
    Ok(settings.get_shortcuts().clone())
}

#[tauri::command]
pub async fn get_uploaders(
    settings_handle: State<'_, SettingsHandler>,
) -> Result<Vec<SavedUploader>, ()> {
    let settings = settings_handle.read().await;
    Ok(settings.get_uploaders().clone())
}

#[tauri::command]
pub async fn save_uploader(
    settings_handle: State<'_, SettingsHandler>,
    uploader: SavedUploader,
) -> Result<(), SettingsError> {
    let mut settings = settings_handle.write().await;
    settings.save_uploader(uploader)
}

#[tauri::command]
pub async fn delete_uploader(
    settings_handle: State<'_, SettingsHandler>,
    id: String,
) -> Result<(), SettingsError> {
    let mut settings = settings_handle.write().await;
    settings.delete_uploader(&id)
}

#[tauri::command]
pub async fn set_default_uploader(
    settings_handle: State<'_, SettingsHandler>,
    id: Option<String>,
) -> Result<(), SettingsError> {
    let mut settings = settings_handle.write().await;
    settings.set_default_uploader(id)
}

#[tauri::command]
pub async fn get_default_uploader(
    settings_handle: State<'_, SettingsHandler>,
) -> Result<Option<String>, ()> {
    let settings = settings_handle.read().await;
    Ok(settings.get_default_uploader_id().cloned())
}

#[tauri::command]
pub async fn get_general_settings(
    settings_handle: State<'_, SettingsHandler>,
) -> Result<GeneralSettings, ()> {
    let settings = settings_handle.read().await;
    Ok(settings.get_general().clone())
}

#[tauri::command]
pub async fn set_general_settings(
    settings_handle: State<'_, SettingsHandler>,
    history_store: State<'_, HistoryStoreHandler>,
    app_handle: AppHandle,
    general: GeneralSettings,
) -> Result<(), SettingsError> {
    let mut settings = settings_handle.write().await;
    let old = settings.get_general().clone();
    settings.set_general(general.clone())?;
    drop(settings);

    if old.autostart != general.autostart {
        let autolaunch = app_handle.autolaunch();
        let result = if general.autostart {
            autolaunch.enable()
        } else {
            autolaunch.disable()
        };

        result.map_err(|err| SettingsError::AutostartError(err.to_string()))?;
    }

    let default_dir = crate::default_app_path();
    let old_dir = old.effective_save_directory(&default_dir);
    let new_dir = general.effective_save_directory(&default_dir);

    if old_dir != new_dir {
        std::fs::create_dir_all(&new_dir)?;
        history_store
            .set_base_path(new_dir)
            .map_err(|err| std::io::Error::other(err.to_string()))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_overlay_defaults(
    settings_handle: State<'_, SettingsHandler>,
) -> Result<OverlayDefaultOverrides, ()> {
    let settings = settings_handle.read().await;
    Ok(settings.get_overlay_defaults().clone())
}

#[tauri::command]
pub async fn set_overlay_defaults(
    settings_handle: State<'_, SettingsHandler>,
    overlay_defaults: OverlayDefaultOverrides,
) -> Result<(), SettingsError> {
    let mut settings = settings_handle.write().await;
    settings.set_overlay_defaults(overlay_defaults)
}

#[tauri::command]
pub async fn get_capture_preview_settings(
    settings_handle: State<'_, SettingsHandler>,
) -> Result<CapturePreviewSettings, ()> {
    let settings = settings_handle.read().await;
    Ok(settings.get_capture_preview().clone())
}

#[tauri::command]
pub async fn set_capture_preview_settings(
    settings_handle: State<'_, SettingsHandler>,
    capture_preview: CapturePreviewSettings,
) -> Result<(), SettingsError> {
    let mut settings = settings_handle.write().await;
    settings.set_capture_preview(capture_preview)
}
