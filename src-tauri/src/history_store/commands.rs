use std::collections::HashMap;

use tauri::State;

use super::filter::FilterNode;
use super::metadata::TagMetadata;
use super::store::{HistoryCursor, HistoryError, HistoryPage, HistorySort, TagValueSuggestion};
use crate::HistoryStoreHandler;
use crate::screen_manager::screenshot_manager::{ImageHistoryData, TagValue};

#[tauri::command]
pub async fn query_history(
    store: State<'_, HistoryStoreHandler>,
    filter: FilterNode,
    sort: Option<HistorySort>,
    cursor: Option<HistoryCursor>,
    limit: u32,
) -> Result<HistoryPage, HistoryError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.query(filter, sort, cursor, limit))
        .await
        .map_err(|err| HistoryError::Task(err.to_string()))?
}

#[tauri::command]
pub async fn suggest_tag_values(
    store: State<'_, HistoryStoreHandler>,
    path: Vec<String>,
    query: String,
) -> Result<Vec<TagValueSuggestion>, HistoryError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.suggest_tag_values(&path, &query))
        .await
        .map_err(|err| HistoryError::Task(err.to_string()))?
}

#[tauri::command]
pub async fn get_tag_metadata(
    store: State<'_, HistoryStoreHandler>,
) -> Result<TagMetadata, HistoryError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.tag_metadata())
        .await
        .map_err(|err| HistoryError::Task(err.to_string()))?
}

#[tauri::command]
pub async fn get_drag_icon(
    store: State<'_, HistoryStoreHandler>,
    file_name: String,
) -> Result<Option<String>, HistoryError> {
    let store = store.inner().clone();
    let icon_path = tauri::async_runtime::spawn_blocking(move || store.drag_icon_path(&file_name))
        .await
        .map_err(|err| HistoryError::Task(err.to_string()))??;

    Ok(icon_path.map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn update_history_tags(
    store: State<'_, HistoryStoreHandler>,
    file_name: String,
    tags: Option<HashMap<String, TagValue>>,
) -> Result<ImageHistoryData, HistoryError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.update_tags(&file_name, tags))
        .await
        .map_err(|err| HistoryError::Task(err.to_string()))?
}

#[tauri::command]
pub async fn list_videos_missing_thumbnail(
    store: State<'_, HistoryStoreHandler>,
    min_size_bytes: u64,
) -> Result<Vec<String>, HistoryError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.videos_missing_thumbnail(min_size_bytes))
        .await
        .map_err(|err| HistoryError::Task(err.to_string()))?
}
