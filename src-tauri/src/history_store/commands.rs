use tauri::State;

use super::filter::FilterNode;
use super::metadata::TagMetadata;
use super::store::{HistoryCursor, HistoryError, HistoryPage, HistorySort, TagValueSuggestion};
use crate::HistoryStoreHandler;

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
