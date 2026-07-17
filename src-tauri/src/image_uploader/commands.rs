use image::{ImageFormat, Rgba, RgbaImage};
use reqwest::Client;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::{SavedUploader, UploadFile, UploaderError, UploaderOptions, execute_and_capture};
use crate::{
    HistoryStoreHandler, HttpClientHandler, SettingsHandler,
    emit_on_main_thread,
    screen_manager::screenshot_manager::encode_image_as,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadStartedPayload {
    file_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadProgressPayload {
    file_name: String,
    sent: u64,
    total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadFinishedPayload {
    file_name: String,
    url: String,
    copied: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadFailedPayload {
    file_name: String,
    error: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploaderValidation {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<UploaderError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub url: String,
    /// Whether the URL landed on the clipboard, so the UI can word its toast honestly.
    pub copied: bool,
}

#[tauri::command]
pub fn is_uploader_valid(
    http_client: State<'_, HttpClientHandler>,
    uploader: UploaderOptions,
) -> UploaderValidation {
    let file = UploadFile::from_file_name("example.png".to_owned(), Vec::new());

    match uploader.build_request(&http_client, &file) {
        Ok(_) => UploaderValidation {
            valid: true,
            error: None,
        },
        Err(error) => UploaderValidation {
            valid: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub async fn upload_image(
    history_store: State<'_, HistoryStoreHandler>,
    settings_handle: State<'_, SettingsHandler>,
    http_client: State<'_, HttpClientHandler>,
    app_handle: AppHandle,
    file_name: String,
    uploader_id: Option<String>,
) -> Result<UploadResult, UploaderError> {
    let settings = settings_handle.read().await;
    let uploader = match &uploader_id {
        Some(id) => settings
            .get_uploader(id)
            .ok_or_else(|| UploaderError::UploaderNotFound(id.clone()))?,
        None => settings
            .get_default_uploader()
            .ok_or(UploaderError::NoDefaultUploader)?,
    }
    .clone();
    drop(settings);

    run_upload(&app_handle, history_store.inner(), http_client.inner(), &uploader, &file_name).await
}

/// Uploads with the given uploader if there's an image to upload, emitting
/// `upload://started`, `upload://progress`, and `upload://finished`/`failed`
/// events throughout , the UI reflects these whether it was open when the
/// upload was triggered or not. Persists the outcome (url or error) either way,
/// so a closed/reopened window still shows the right status.
pub async fn run_upload(
    app_handle: &AppHandle,
    history_store: &HistoryStoreHandler,
    http_client: &HttpClientHandler,
    uploader: &SavedUploader,
    file_name: &str,
) -> Result<UploadResult, UploaderError> {
    let result = try_upload(app_handle, history_store, http_client, uploader, file_name).await;

    match &result {
        Ok(upload) => {
            if let Err(err) = history_store.set_upload_result(file_name, &uploader.name, &upload.url) {
                eprintln!("Failed to persist upload result for {}: {}", file_name, err);
            }
            crate::sound_manager::play_sound(app_handle, crate::sound_manager::SoundKind::TaskSuccess).await;
            emit_on_main_thread!(
                app_handle,
                "upload://finished",
                UploadFinishedPayload {
                    file_name: file_name.to_string(),
                    url: upload.url.clone(),
                    copied: upload.copied,
                }
            );
        }
        Err(err) => {
            let error_json = serde_json::to_value(err).unwrap_or(serde_json::Value::Null);
            if let Err(err) = history_store.set_upload_error(file_name, &error_json.to_string()) {
                eprintln!("Failed to persist upload error for {}: {}", file_name, err);
            }
            emit_on_main_thread!(
                app_handle,
                "upload://failed",
                UploadFailedPayload { file_name: file_name.to_string(), error: error_json }
            );
        }
    }

    result
}

async fn try_upload(
    app_handle: &AppHandle,
    history_store: &HistoryStoreHandler,
    http_client: &HttpClientHandler,
    uploader: &SavedUploader,
    file_name: &str,
) -> Result<UploadResult, UploaderError> {
    let file_path = history_store
        .get_by_file_name(file_name)
        .map_err(|_| UploaderError::ImageNotFound(file_name.to_string()))?
        .ok_or_else(|| UploaderError::ImageNotFound(file_name.to_string()))?
        .file_path;

    let bytes = std::fs::read(&file_path).map_err(UploaderError::FileReadFailed)?;
    let file = UploadFile::from_file_name(file_name.to_string(), bytes);

    emit_on_main_thread!(
        app_handle,
        "upload://started",
        UploadStartedPayload { file_name: file_name.to_string() }
    );

    let progress_app_handle = app_handle.clone();
    let progress_file_name = file_name.to_string();
    let on_progress: super::ProgressCallback = Box::new(move |sent, total| {
        emit_on_main_thread!(
            progress_app_handle,
            "upload://progress",
            UploadProgressPayload { file_name: progress_file_name.clone(), sent, total }
        );
    });

    let (request, body_summary) = uploader.options.build_upload_request(http_client, &file, on_progress)?;
    let body = execute_and_capture(http_client, request, body_summary).await?;

    let url = uploader.options.response_handler.parse_response(&body)?;

    let copied = match crate::file_clipboard::copy_text(&url) {
        Ok(()) => true,
        Err(err) => {
            eprintln!("Failed to copy the upload URL to the clipboard: {}", err);
            false
        }
    };

    Ok(UploadResult { url, copied })
}

/// Uploads a freshly-saved file with the default uploader, if one is set and
/// has auto-upload enabled. Called right after a screenshot/recording/import
/// is persisted, regardless of whether any window is open.
pub async fn maybe_auto_upload(app_handle: AppHandle, file_name: String) {
    let settings_handle = app_handle.state::<SettingsHandler>();
    let uploader = {
        let settings = settings_handle.read().await;
        settings.get_default_uploader().filter(|u| u.auto_upload).cloned()
    };

    let Some(uploader) = uploader else {
        return;
    };

    let history_store = app_handle.state::<HistoryStoreHandler>().inner().clone();
    let http_client = app_handle.state::<HttpClientHandler>().inner().clone();

    let _ = run_upload(&app_handle, &history_store, &http_client, &uploader, &file_name).await;
}

#[tauri::command]
pub async fn test_uploader(
    http_client: State<'_, HttpClientHandler>,
    uploader: UploaderOptions,
) -> Result<UploadResult, UploaderError> {
    let image = RgbaImage::from_pixel(64, 64, Rgba([0, 126, 255, 255]));
    let bytes = encode_image_as(&image, ImageFormat::Png)
        .expect("in-memory PNG encoding of a valid image cannot fail");
    let file = UploadFile::from_file_name("rosemyne-test.png".to_owned(), bytes);

    let url = perform_upload(&http_client, &uploader, &file).await?;

    Ok(UploadResult { url, copied: false })
}

async fn perform_upload(
    client: &Client,
    options: &UploaderOptions,
    file: &UploadFile,
) -> Result<String, UploaderError> {
    let (request, body_summary) = options.build_request(client, file)?;
    let body = execute_and_capture(client, request, body_summary).await?;

    options.response_handler.parse_response(&body)
}
