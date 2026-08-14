use std::path::PathBuf;

use tauri::State;

use super::{CURSOR_IMAGE_NAME, OverlayImage};
use crate::cursor_image::SystemCursorsHandler;
use crate::{HistoryStoreHandler, SettingsHandler};

/// The system cursors are library entries too, so a user image can't take one of their names.
async fn reserved_names(system_cursors: &SystemCursorsHandler) -> Vec<String> {
    system_cursors.read().await.iter().map(|cursor| cursor.info.name.clone()).collect()
}

#[tauri::command]
pub async fn get_overlay_images(
    settings_handle: State<'_, SettingsHandler>,
) -> Result<Vec<OverlayImage>, ()> {
    Ok(settings_handle.read().await.get_overlay_images().clone())
}

#[tauri::command]
pub async fn add_overlay_image(
    settings_handle: State<'_, SettingsHandler>,
    history_store: State<'_, HistoryStoreHandler>,
    system_cursors: State<'_, SystemCursorsHandler>,
    path: String,
) -> Result<OverlayImage, String> {
    let source = PathBuf::from(path);
    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Image")
        .to_string();

    let store = history_store.inner().clone();
    let file_name = tauri::async_runtime::spawn_blocking(move || store.store_overlay_image(&source))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())?;

    let reserved = reserved_names(&system_cursors).await;
    let mut settings = settings_handle.write().await;
    let mut images = settings.get_overlay_images().clone();

    let image = OverlayImage {
        name: unique_name(&images, &reserved, &stem),
        file_name,
    };

    images.push(image.clone());
    settings.set_overlay_images(images).map_err(|err| err.to_string())?;

    Ok(image)
}

#[tauri::command]
pub async fn remove_overlay_image(
    settings_handle: State<'_, SettingsHandler>,
    history_store: State<'_, HistoryStoreHandler>,
    name: String,
) -> Result<(), String> {
    let mut settings = settings_handle.write().await;
    let mut images = settings.get_overlay_images().clone();

    let Some(index) = images.iter().position(|image| image.name == name) else {
        return Ok(());
    };

    let removed = images.remove(index);
    settings.set_overlay_images(images).map_err(|err| err.to_string())?;
    drop(settings);

    if let Err(err) = history_store.delete_overlay_image(&removed.file_name) {
        eprintln!("Failed to delete the overlay image file {}: {err}", removed.file_name);
    }

    Ok(())
}

#[tauri::command]
pub async fn rename_overlay_image(
    settings_handle: State<'_, SettingsHandler>,
    system_cursors: State<'_, SystemCursorsHandler>,
    name: String,
    new_name: String,
) -> Result<OverlayImage, String> {
    let reserved = reserved_names(&system_cursors).await;
    let mut settings = settings_handle.write().await;
    let mut images = settings.get_overlay_images().clone();

    let Some(index) = images.iter().position(|image| image.name == name) else {
        return Err(format!("{name} is not in the overlay image library"));
    };

    let others: Vec<OverlayImage> = images
        .iter()
        .enumerate()
        .filter(|(other, _)| *other != index)
        .map(|(_, image)| image.clone())
        .collect();

    images[index].name = unique_name(&others, &reserved, &new_name);
    let renamed = images[index].clone();
    settings.set_overlay_images(images).map_err(|err| err.to_string())?;

    Ok(renamed)
}

/// Names are the identifier a placed overlay stores, so collisions get a counter.
fn unique_name(existing: &[OverlayImage], reserved: &[String], desired: &str) -> String {
    let taken = |candidate: &str| {
        candidate.eq_ignore_ascii_case(CURSOR_IMAGE_NAME)
            || reserved.iter().any(|name| name.eq_ignore_ascii_case(candidate))
            || existing.iter().any(|image| image.name.eq_ignore_ascii_case(candidate))
    };

    let desired = desired.trim();
    let base = if desired.is_empty() { "Image" } else { desired };

    if !taken(base) {
        return base.to_string();
    }

    let mut suffix = 2;
    loop {
        let candidate = format!("{base} {suffix}");
        if !taken(&candidate) {
            return candidate;
        }
        suffix += 1;
    }
}
