use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::{HistoryStoreHandler, SettingsHandler};

use super::runtime::LogLine;
use super::{PluginInfo, PluginInspection, PluginManagerHandler, PluginUploaderInfo, UPLOADER_ID_PREFIX};

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn list_plugins(plugins: State<'_, PluginManagerHandler>) -> Vec<PluginInfo> {
    plugins.list()
}

#[tauri::command]
pub async fn inspect_plugin_package(
    plugins: State<'_, PluginManagerHandler>,
    path: String,
) -> Result<PluginInspection, String> {
    let plugins = plugins.inner().clone();
    blocking(move || plugins.inspect(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn install_plugin(
    plugins: State<'_, PluginManagerHandler>,
    path: String,
    wasm_sha256: String,
) -> Result<(), String> {
    let plugins = plugins.inner().clone();
    blocking(move || plugins.install(&PathBuf::from(path), &wasm_sha256)).await
}

#[tauri::command]
pub async fn load_unpacked_plugin(plugins: State<'_, PluginManagerHandler>, path: String) -> Result<(), String> {
    let plugins = plugins.inner().clone();
    blocking(move || plugins.load_unpacked(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn reload_plugins(plugins: State<'_, PluginManagerHandler>) -> Result<(), String> {
    let plugins = plugins.inner().clone();
    blocking(move || plugins.reload_all()).await
}

#[tauri::command]
pub async fn set_plugin_enabled(
    plugins: State<'_, PluginManagerHandler>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let plugins = plugins.inner().clone();
    blocking(move || plugins.set_enabled(&id, enabled)).await
}

#[tauri::command]
pub async fn set_plugin_order(plugins: State<'_, PluginManagerHandler>, ids: Vec<String>) -> Result<(), String> {
    let plugins = plugins.inner().clone();
    blocking(move || plugins.set_order(&ids)).await
}

#[tauri::command]
pub async fn count_plugin_tagged(plugins: State<'_, PluginManagerHandler>, id: String) -> Result<u64, String> {
    let plugins = plugins.inner().clone();
    blocking(move || plugins.tagged_count(&id)).await
}

#[tauri::command]
pub async fn uninstall_plugin(
    plugins: State<'_, PluginManagerHandler>,
    settings_handle: State<'_, SettingsHandler>,
    id: String,
    delete_data: bool,
    remove_tags: bool,
) -> Result<(), String> {
    let manager = plugins.inner().clone();
    let plugin_id = id.clone();
    blocking(move || manager.uninstall(&plugin_id, delete_data, remove_tags)).await?;

    let mut settings = settings_handle.write().await;
    let default_is_gone = settings
        .get_default_uploader_id()
        .is_some_and(|default| default.starts_with(&format!("{UPLOADER_ID_PREFIX}{id}:")));
    if default_is_gone {
        settings.set_default_uploader(None).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_plugin_settings(
    plugins: State<'_, PluginManagerHandler>,
    id: String,
) -> Result<HashMap<String, Value>, String> {
    plugins.stored_settings(&id)
}

#[tauri::command]
pub fn set_plugin_setting(
    plugins: State<'_, PluginManagerHandler>,
    id: String,
    setting_id: String,
    value: Value,
) -> Result<(), String> {
    plugins.set_setting(&id, &setting_id, &value)
}

#[tauri::command]
pub async fn plugin_ui_render(
    plugins: State<'_, PluginManagerHandler>,
    id: String,
    view: String,
) -> Result<Value, String> {
    plugins.ui_render(&id, &view).await
}

#[tauri::command]
pub async fn plugin_ui_event(
    plugins: State<'_, PluginManagerHandler>,
    id: String,
    view: String,
    event: Value,
) -> Result<Value, String> {
    plugins.ui_event(&id, &view, event).await
}

#[tauri::command]
pub async fn plugin_card_action(
    plugins: State<'_, PluginManagerHandler>,
    history_store: State<'_, HistoryStoreHandler>,
    id: String,
    action_id: String,
    file_name: String,
) -> Result<Value, String> {
    let entry = history_store
        .get_by_file_name(&file_name)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("{file_name} is not in the history"))?;
    plugins.card_action(&id, &action_id, &entry).await
}

#[tauri::command]
pub fn get_plugin_log(plugins: State<'_, PluginManagerHandler>, id: String) -> Result<Vec<LogLine>, String> {
    plugins.log_lines(&id)
}

/// Opens a link from a plugin's view. The frontend has already shown the user where it goes.
#[tauri::command]
pub fn open_plugin_link(app_handle: AppHandle, url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "That link is not valid".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err("Only https links can be opened".into());
    }
    app_handle
        .opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_plugin_uploaders(plugins: State<'_, PluginManagerHandler>) -> Vec<PluginUploaderInfo> {
    plugins.uploaders()
}

#[tauri::command]
pub fn set_plugin_uploader_auto_upload(
    plugins: State<'_, PluginManagerHandler>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    plugins.set_uploader_auto_upload(&id, enabled)
}
