use tauri::{AppHandle, State};

use super::error::MigrationError;
use super::migration::{ExistingHistory, MigrationSummary, run_migration};
use crate::{HistoryStoreHandler, SettingsHandler};

#[tauri::command]
pub async fn migrate_from_sharex(
    history_store: State<'_, HistoryStoreHandler>,
    settings_handle: State<'_, SettingsHandler>,
    app_handle: AppHandle,
    sharex_path: String,
    dry_run: bool,
) -> Result<MigrationSummary, MigrationError> {
    let store = history_store.inner().clone();
    let app = app_handle.clone();
    let upload_template = settings_handle.read().await.get_general().upload_path.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<MigrationSummary, MigrationError> {
        let base_path = store.base_path();
        let existing = ExistingHistory {
            names: store
                .existing_file_names()
                .map_err(|err| MigrationError::TaskError(err.to_string()))?,
        };

        let outcome = run_migration(&app, base_path, existing, &sharex_path, upload_template.as_deref(), dry_run)?;

        if !dry_run && !outcome.entries.is_empty() {
            store
                .insert_batch(outcome.entries)
                .map_err(|err| MigrationError::TaskError(err.to_string()))?;
        }

        Ok(outcome.summary)
    })
    .await
    .map_err(|err| MigrationError::TaskError(err.to_string()))?
}
