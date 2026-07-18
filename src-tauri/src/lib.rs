use dimensions::impls::Dimensions;
use history_store::HistoryStore;
use history_store::commands::{get_drag_icon, get_tag_metadata, query_history, suggest_tag_values};
use image::RgbaImage;
use image_uploader::commands::{is_uploader_valid, maybe_auto_upload, test_uploader, upload_image};
use mouse_rs::Mouse;
use recording::commands::{
    RECORDING_BORDER_LABEL, RECORDING_HUD_LABEL, RecordingManagerHandler, cancel_recording,
    create_recording_windows, get_available_video_codecs, get_recording_status, start_recording,
    stop_recording,
};
use screen_manager::commands::{
    copy_file_to_clipboard, copy_screenshot_to_clipboard, copy_text_to_clipboard,
    delete_screenshot, finish_region_pick, full_screenshot, monitor_identity, open_file,
    persist_capture, record_screen, show_in_folder, start_region_pick,
};
use screen_manager::screenshot_manager::{ImageHistoryData, ScreenshotManager};
use screen_manager::window::WindowBounds;
use screenshot_window::{
    SCREENSHOT_WINDOW_LABEL, WindowManager, manager_trait::ScreenshotWindowManager,
};
use settings_manager::commands::{
    add_shortcut, delete_uploader, get_default_uploader, get_general_settings, get_shortcuts,
    get_uploaders, remove_shortcut, save_uploader, set_default_uploader, set_general_settings,
};
use settings_manager::settings::Settings;
use settings_manager::shortcuts::shortcut_handler;
use sharex_migration::commands::migrate_from_sharex;
use sound_manager::commands::{
    get_sound_settings, preview_sound, reset_custom_sound, set_custom_sound, set_sound_enabled,
    set_sound_volume,
};
use std::ops::Deref;
use std::sync::atomic::{AtomicBool, Ordering};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::http::Response;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Manager, RunEvent, Runtime, WebviewWindow, WebviewWindowBuilder, Wry,
    async_runtime::RwLock,
};
use tauri::{Emitter, State};
pub mod capture;
pub mod dimensions;
pub mod error_serializers;
pub mod file_clipboard;
pub mod history_store;
pub mod image_uploader;
pub mod locale;
pub mod recording;
pub mod screen_manager;
pub mod screenshot_window;
pub mod settings_manager;
pub mod sharex_migration;
pub mod sound_manager;

/// Emits a Tauri event from the main thread , emitting cross-thread can
/// deadlock with WebView2 on Windows (tauri-apps/tauri#9453, #11787).
#[macro_export]
macro_rules! emit_on_main_thread {
    ($emitter:expr, $event:expr, $payload:expr) => {{
        let __emitter_clone = $emitter.clone();
        let __payload = $payload;
        let _ = $emitter.run_on_main_thread(move || {
            let _ = __emitter_clone.emit($event, __payload);
        });
    }};
}

/// Shared tail for every path that adds a row to history (a rendered capture, a
/// finished recording, or a drag-dropped import): tells the main window about
/// it, then kicks off auto-upload if it applies , independent of whether the
/// window is even open.
pub fn notify_history_saved(app_handle: &AppHandle, entry: &ImageHistoryData) {
    emit_on_main_thread!(app_handle, "screenshot://new-saved-image", entry.clone());
    tauri::async_runtime::spawn(maybe_auto_upload(
        app_handle.clone(),
        entry.file_name.clone(),
    ));
}

static APP_EXITING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveScreenshotArgs {
    id: u16,
    position: Dimensions,
    width: u32,
    height: u32,
}

/// Receives the finished image rendered by the frontend canvas compositor:
/// raw RGBA in the request body, metadata in the `x-rosemyne-args` header.
/// Sync so the borrowed `Request` works; the heavy work is spawned.
#[tauri::command]
fn hide_and_save_screenshot(
    screenshot_manager: State<'_, ScreenshotManagerHandler>,
    history_store: State<'_, HistoryStoreHandler>,
    settings_handle: State<'_, SettingsHandler>,
    app_handle: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let args = request
        .headers()
        .get("x-rosemyne-args")
        .and_then(|value| value.to_str().ok())
        .ok_or("Missing the x-rosemyne-args header")?;
    let args: SaveScreenshotArgs = serde_json::from_str(args).map_err(|err| err.to_string())?;

    let tauri::ipc::InvokeBody::Raw(pixels) = request.body() else {
        return Err("Expected a raw RGBA request body".into());
    };

    let expected_len = args.width as usize * args.height as usize * 4;
    if pixels.len() != expected_len {
        return Err(format!(
            "Pixel buffer is {} bytes, expected {}",
            pixels.len(),
            expected_len
        ));
    }

    let image = RgbaImage::from_raw(args.width, args.height, pixels.clone())
        .ok_or("Pixel buffer did not match the given dimensions")?;

    let screenshot_manager = screenshot_manager.inner().clone();
    let history_store = history_store.inner().clone();
    let settings_handle = settings_handle.inner().clone();

    tauri::async_runtime::spawn(async move {
        save_rendered_screenshot(
            screenshot_manager,
            history_store,
            settings_handle,
            app_handle,
            args,
            image,
        )
        .await;
    });

    Ok(())
}

async fn save_rendered_screenshot(
    screenshot_manager: ScreenshotManagerHandler,
    history_store: HistoryStoreHandler,
    settings_handle: SettingsHandler,
    app_handle: AppHandle,
    args: SaveScreenshotArgs,
    image: RgbaImage,
) {
    let dims = args.position;
    let mut manager = screenshot_manager.write().await;

    // Clone the tagging windows out before consuming the temp capture, so the
    // shared persist tail can run after the manager lock is dropped.
    let windows = match manager.get_screenshot_windows(&args.id) {
        Some(windows) => windows.clone(),
        None => {
            eprintln!("Screenshot {} no longer exists, cannot save it", args.id);
            return;
        }
    };

    // Consume the temp capture; if it's already gone the save was cancelled.
    if manager.remove_image(&args.id).is_none() {
        eprintln!("Screenshot {} no longer exists, cannot save it", args.id);
        return;
    }
    drop(manager);

    persist_capture(
        &app_handle,
        &history_store,
        &settings_handle,
        &image,
        &windows,
        &dims,
    )
    .await;
}

/// Copies a user-provided file into storage (typed by extension) and records it.
/// The intended callers are future OS context-menu integrations; for now the
/// frontend invokes it on window drag-drop.
#[tauri::command]
async fn import_file(
    history_store: State<'_, HistoryStoreHandler>,
    settings_handle: State<'_, SettingsHandler>,
    app_handle: AppHandle,
    path: String,
) -> Result<Option<ImageHistoryData>, String> {
    let template = settings_handle
        .read()
        .await
        .get_general()
        .upload_path
        .clone();
    let store = history_store.inner().clone();

    let entry = tauri::async_runtime::spawn_blocking(move || {
        store.import_file(Path::new(&path), template.as_deref())
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(|err| err.to_string())?;

    if let Some(entry) = &entry {
        notify_history_saved(&app_handle, entry);
    }
    Ok(entry)
}

fn content_type_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg" | "jfif") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("apng") => "image/apng",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("tiff" | "tif") => "image/tiff",
        Some("heic") => "image/heic",
        Some("heif") => "image/heif",
        Some("jxl") => "image/jxl",
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("wmv") => "video/x-ms-wmv",
        Some("flv") => "video/x-flv",
        Some("mpeg" | "mpg") => "video/mpeg",
        Some("m2ts" | "ts") => "video/mp2t",
        Some("ogv") => "video/ogg",
        Some("3gp") => "video/3gpp",
        Some("3g2") => "video/3gpp2",
        _ => "application/octet-stream",
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveThumbnailArgs {
    file_name: String,
}

/// Stores a frontend-generated thumbnail for an existing history entry:
/// encoded WebP bytes in the raw body, the file name in the header.
#[tauri::command]
fn save_video_thumbnail(
    history_store: State<'_, HistoryStoreHandler>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let args = request
        .headers()
        .get("x-rosemyne-args")
        .and_then(|value| value.to_str().ok())
        .ok_or("Missing the x-rosemyne-args header")?;
    let args: SaveThumbnailArgs = serde_json::from_str(args).map_err(|err| err.to_string())?;

    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected a raw WebP request body".into());
    };

    history_store
        .save_thumbnail_bytes(&args.file_name, bytes)
        .map_err(|err| err.to_string())
}

/// Largest slice served for one Range request; the media stack just asks for
/// the next chunk, so this bounds memory instead of playback.
const STREAM_CHUNK_MAX: u64 = 8 * 1024 * 1024;

fn status_response(status: u16) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("Valid response")
}

/// Serves a saved file, honoring single `bytes=start[-end]` Range requests
/// with 206 chunks so `<video>` can stream and seek without the whole file
/// ever being read into memory. CORS is open so `crossorigin` videos stay
/// canvas-extractable (thumbnail generation), like the preview route.
fn serve_file(path: &Path, range: Option<&str>) -> Response<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};

    let Ok(mut file) = std::fs::File::open(path) else {
        return status_response(404);
    };
    let Ok(meta) = file.metadata() else {
        return status_response(404);
    };
    let total = meta.len();

    let Some((start, requested_end)) = range.and_then(parse_range_header) else {
        let mut data = Vec::new();
        return match file.read_to_end(&mut data) {
            Ok(_) => Response::builder()
                .status(200)
                .header("Content-Type", content_type_for(path))
                .header("Accept-Ranges", "bytes")
                .header("Access-Control-Allow-Origin", "*")
                .body(data)
                .expect("Valid response"),
            Err(_) => status_response(500),
        };
    };

    if start >= total {
        return Response::builder()
            .status(416)
            .header("Content-Range", format!("bytes */{total}"))
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .expect("Valid response");
    }

    let end = requested_end
        .unwrap_or(total - 1)
        .min(total - 1)
        .min(start + STREAM_CHUNK_MAX - 1);

    let mut data = vec![0u8; (end - start + 1) as usize];
    if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut data).is_err() {
        return status_response(500);
    }

    Response::builder()
        .status(206)
        .header("Content-Type", content_type_for(path))
        .header("Accept-Ranges", "bytes")
        .header("Content-Range", format!("bytes {start}-{end}/{total}"))
        .header("Access-Control-Allow-Origin", "*")
        .body(data)
        .expect("Valid response")
}

/// Parses `bytes=start[-end]`. Multi-range and suffix (`bytes=-N`) requests
/// fall back to a full-body 200 by returning `None`.
fn parse_range_header(header: &str) -> Option<(u64, Option<u64>)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    let (start, end) = spec.split_once('-')?;
    let start = start.trim().parse().ok()?;
    let end = end.trim();
    let end = if end.is_empty() {
        None
    } else {
        Some(end.parse().ok()?)
    };
    Some((start, end))
}

#[tauri::command]
async fn hide_screenshot_window(
    window_handler: State<'_, ScreenshotWindowHandler>,
    screenshot_manager: State<'_, ScreenshotManagerHandler>,
    id: Option<u16>,
) -> Result<(), ()> {
    let window_handler = window_handler.read().await;

    if let Some(window_handler) = window_handler.deref() {
        WindowManager::hide(window_handler);
    }

    if let Some(id) = id {
        let mut screenshot_manager = screenshot_manager.write().await;

        screenshot_manager.remove_image(&id);
    }

    Ok(())
}

#[tauri::command]
fn move_mouse_by(mouse_handler: State<'_, MouseHandler>, x: Option<i32>, y: Option<i32>) -> () {
    let mut pos = match mouse_handler.get_position() {
        Ok(pos) => pos,
        Err(err) => return println!("Failed to get mouse position: {:#?}", err),
    };

    if let Some(x) = x {
        pos.x += x;
    }

    if let Some(y) = y {
        pos.y += y;
    }

    mouse_handler.move_to(pos.x, pos.y).ok();
}

#[tauri::command]
fn get_system_datetime_patterns() -> Option<locale::DateTimePatterns> {
    locale::system_datetime_patterns()
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MonitorInfo {
    id: String,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// The connected monitors, for picking an instant-capture target. `id` is the
/// stable identity stored on the shortcut; `name` is a friendly label , the
/// monitor's product name when the OS exposes it, else a positional fallback.
#[tauri::command]
fn list_monitors(app_handle: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app_handle
        .available_monitors()
        .map_err(|err| err.to_string())?;

    let friendly_names = screen_manager::monitor_names::friendly_monitor_names();

    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            let os_name = monitor.name();

            // Prefer a platform-resolved product name (Windows DisplayConfig),
            // then the OS-provided name when it's already human-friendly , many
            // platforms expose one directly and need no extra lookup , and only
            // then a positional label. A Windows GDI device path (\\.\DISPLAY1)
            // is not user-friendly, so it's skipped in favour of "Display N".
            let name = os_name
                .and_then(|gdi_name| {
                    friendly_names
                        .iter()
                        .find(|(gdi, _)| gdi == gdi_name)
                        .map(|(_, name)| name.clone())
                })
                .or_else(|| {
                    os_name
                        .filter(|name| !name.trim().is_empty() && !name.starts_with(r"\\.\"))
                        .cloned()
                })
                .unwrap_or_else(|| format!("Display {}", index + 1));

            MonitorInfo {
                id: monitor_identity(os_name, index),
                name,
                x: monitor.position().x,
                y: monitor.position().y,
                width: monitor.size().width,
                height: monitor.size().height,
            }
        })
        .collect())
}

type ScreenshotWindowHandler = Arc<RwLock<Option<ScreenshotWebview<Wry>>>>;
type ScreenshotManagerHandler = Arc<RwLock<ScreenshotManager>>;
pub type HistoryStoreHandler = Arc<HistoryStore>;
type SettingsHandler = Arc<RwLock<Settings>>;
type MouseHandler = Arc<Mouse>;
pub type HttpClientHandler = Arc<reqwest::Client>;

pub fn default_app_path() -> PathBuf {
    dirs::document_dir()
        .expect("documents directory exists")
        .join("Rosemyne")
}

/// Baked into the autostart entry's command line (see `tauri_plugin_autostart::init`
/// below), so only OS-triggered startup launches carry it , a manual double-click
/// or Start Menu launch never does, even if autostart is also enabled.
const AUTOSTART_ARG: &str = "--autostart";

#[tauri::command]
fn was_launched_via_autostart() -> bool {
    std::env::args().any(|arg| arg == AUTOSTART_ARG)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_path = default_app_path();

    let history_store: HistoryStoreHandler =
        Arc::new(HistoryStore::new(app_path.clone()).expect("failed to open the history database"));

    let screenshot_window: ScreenshotWindowHandler = Arc::new(RwLock::new(None));
    let screenshot_manager: ScreenshotManagerHandler =
        Arc::new(RwLock::new(ScreenshotManager::new()));

    let scheme_manager_ref = screenshot_manager.clone();
    let scheme_store_ref = history_store.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_or_open_config_window(app, "main");
        }))
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(shortcut_handler)
                .build(),
        )
        .register_asynchronous_uri_scheme_protocol(
            "rosemyne-photo",
            move |_app, request, responder| {
                let screenshot_manager = scheme_manager_ref.clone();
                let history_store = scheme_store_ref.clone();

                tauri::async_runtime::spawn(async move {
                    let split_uri: Vec<_> = request
                        .uri()
                        .path()
                        .split("/")
                        .filter(|part| part.len() > 0)
                        .collect();

                    match split_uri.as_slice() {
                        ["saved", file_name] => {
                            let path = match history_store.get_by_file_name(file_name) {
                                Ok(entry) => entry.map(|data| data.file_path),
                                Err(err) => {
                                    eprintln!("Failed to look up saved image {file_name}: {err}");
                                    None
                                }
                            };

                            let range = request
                                .headers()
                                .get("range")
                                .and_then(|value| value.to_str().ok())
                                .map(|value| value.to_string());

                            let response = match path {
                                Some(file_path) => serve_file(&file_path, range.as_deref()),
                                None => status_response(404),
                            };
                            responder.respond(response);
                        }
                        ["thumb", file_name] => {
                            let data = history_store
                                .thumbnail_path(file_name)
                                .and_then(|path| std::fs::read(path).ok());

                            let response = match data {
                                Some(data) => Response::builder()
                                    .status(200)
                                    .header("Content-Type", "image/webp")
                                    .body(data)
                                    .expect("Valid response"),
                                None => status_response(404),
                            };
                            responder.respond(response);
                        }
                        ["preview", id] => {
                            let id: u16 = match id.parse() {
                                Ok(n) => n,
                                Err(_) => {
                                    responder.respond(
                                        Response::builder()
                                            .status(400)
                                            .body(b"Path id is not a valid u16 number".to_vec())
                                            .expect("Valid response"),
                                    );

                                    return;
                                }
                            };

                            let manager = screenshot_manager.read().await;
                            let preview_image = manager
                                .get_temp_image(&id)
                                .map(|data| data.webp_review.clone());
                            drop(manager);

                            match preview_image {
                                Some(preview_image) => responder.respond(
                                    Response::builder()
                                        .status(200)
                                        .header("Access-Control-Allow-Origin", "*")
                                        .body(preview_image)
                                        .expect("Valid response"),
                                ),
                                None => responder.respond(
                                    Response::builder()
                                        .status(404)
                                        .body(Vec::new())
                                        .expect("Valid response"),
                                ),
                            };
                        }
                        _ => {
                            println!("Unknown request: {:#?}", request);

                            responder.respond(
                                Response::builder()
                                    .status(404)
                                    .body(Vec::new())
                                    .expect("Valid response"),
                            );
                        }
                    };
                });
            },
        )
        .setup(|app| {
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip(
                    app.config()
                        .product_name
                        .as_ref()
                        .expect("name set")
                        .clone(),
                )
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        println!("left click pressed and released");
                        let app = tray.app_handle();
                        focus_or_open_config_window(app, "main");
                    }
                    _ => {}
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        println!("quit menu item was clicked");
                        app.exit(0);
                    }
                    _ => {
                        println!("menu item {:?} not handled", event.id);
                    }
                })
                .build(app)?;

            if let Some(main_window) = app.get_webview_window("main") {
                disable_alt_menu(&main_window);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_shortcuts,
            add_shortcut,
            remove_shortcut,
            full_screenshot,
            hide_screenshot_window,
            hide_and_save_screenshot,
            list_monitors,
            start_region_pick,
            finish_region_pick,
            record_screen,
            start_recording,
            stop_recording,
            cancel_recording,
            get_recording_status,
            get_available_video_codecs,
            save_video_thumbnail,
            import_file,
            query_history,
            get_tag_metadata,
            get_drag_icon,
            suggest_tag_values,
            delete_screenshot,
            copy_screenshot_to_clipboard,
            copy_file_to_clipboard,
            copy_text_to_clipboard,
            show_in_folder,
            open_file,
            move_mouse_by,
            get_system_datetime_patterns,
            was_launched_via_autostart,
            is_uploader_valid,
            upload_image,
            test_uploader,
            get_uploaders,
            save_uploader,
            delete_uploader,
            get_default_uploader,
            set_default_uploader,
            get_general_settings,
            set_general_settings,
            migrate_from_sharex,
            get_sound_settings,
            set_sound_enabled,
            set_sound_volume,
            set_custom_sound,
            reset_custom_sound,
            preview_sound
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    let mut settings = Settings::new(app.handle().clone(), app_path.clone());
    if let Err(err) = settings.read_settings() {
        eprintln!("Failed to read settings: {}", err);
    }

    let save_directory = settings.get_general().effective_save_directory(&app_path);
    if save_directory != app_path {
        if let Err(err) = history_store.set_base_path(save_directory) {
            eprintln!(
                "Failed to point the history store at the save directory: {}",
                err
            );
        }
    }

    let settings: SettingsHandler = Arc::new(RwLock::new(settings));
    let recording_manager: RecordingManagerHandler =
        Arc::new(tauri::async_runtime::Mutex::new(None));
    app.manage(settings);
    app.manage(screenshot_window.clone());
    app.manage(screenshot_manager);
    app.manage(history_store);
    app.manage(recording_manager);
    app.manage(Arc::new(reqwest::Client::new()));
    app.manage(Arc::new(Mouse::new()));

    app.run(move |app_handle, event| {
        // Exit bookkeeping must happen synchronously , the spawned handler below
        // races against the Destroyed events fired during shutdown.
        if let RunEvent::ExitRequested {
            code: None, api, ..
        } = &event
        {
            // All windows closed; keep running in the tray.
            api.prevent_exit();
        } else if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            APP_EXITING.store(true, Ordering::SeqCst);
        }

        let screenshot_windows = screenshot_window.clone();
        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            run_callback(&app_handle, event, screenshot_windows).await;
        });
    });
}

async fn run_callback(
    app_handle: &AppHandle<Wry>,
    event: RunEvent,
    screenshot_window: ScreenshotWindowHandler,
) {
    match event {
        tauri::RunEvent::Ready => {
            create_screenshot_window(app_handle, screenshot_window).await;
            create_recording_windows(app_handle);
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } if label == SCREENSHOT_WINDOW_LABEL => {
            if APP_EXITING.load(Ordering::SeqCst) {
                return;
            }

            // The user closed the overlay (Alt+F4 or similar): treat it as a
            // cancelled screenshot and re-create the window for future captures.
            *screenshot_window.write().await = None;

            let screenshot_manager = app_handle.state::<ScreenshotManagerHandler>();
            screenshot_manager.write().await.clear_temp_images();

            create_screenshot_window(app_handle, screenshot_window).await;
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } if label == RECORDING_HUD_LABEL || label == RECORDING_BORDER_LABEL => {
            if APP_EXITING.load(Ordering::SeqCst) {
                return;
            }

            // Keep the chrome pre-created so the next recording shows it instantly.
            create_recording_windows(app_handle);
        }
        _ => {}
    }
}

async fn create_screenshot_window(
    app_handle: &AppHandle<Wry>,
    screenshot_window: ScreenshotWindowHandler,
) {
    let monitors = match app_handle.available_monitors() {
        Ok(monitors) => monitors,
        Err(err) => {
            eprintln!("Failed to list monitors: {}", err);
            return;
        }
    };

    let monitor_positions: Vec<WindowBounds> = monitors
        .iter()
        .map(|monitor| WindowBounds {
            left: monitor.position().x,
            top: monitor.position().y,
            right: monitor.position().x + monitor.size().width as i32,
            bottom: monitor.position().y + monitor.size().height as i32,
            z_order: 0,
        })
        .collect();

    let final_dims = match monitor_positions.as_slice() {
        [start, rest @ ..] => {
            let mut start = start.clone();
            start.z_order = 1;

            for monitor in rest {
                start.left = start.left.min(monitor.left);
                start.top = start.top.min(monitor.top);
                start.right = start.right.max(monitor.right);
                start.bottom = start.bottom.max(monitor.bottom);
            }

            start
        }
        [] => {
            eprintln!("Cannot create the screenshotter window without any monitors");
            return;
        }
    };

    let creation_handle = app_handle.clone();
    let creation_result = app_handle.run_on_main_thread(move || {
        match WindowManager::create(&creation_handle, &final_dims) {
            Ok(window) => {
                disable_alt_menu(&window);
                let mut window_lock = screenshot_window.blocking_write();
                *window_lock = Some(ScreenshotWebview {
                    window,
                    position: final_dims,
                    monitor_positions,
                });
            }
            Err(err) => eprintln!("Failed to create screenshotter window: {}", err),
        }
    });

    if let Err(err) = creation_result {
        eprintln!("Failed to schedule screenshotter window creation: {}", err);
    }
}

fn focus_or_open_config_window(app: &AppHandle, name: &str) {
    match app.get_webview_window(name) {
        Some(window) => {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        None => {
            let config = match app.config().app.windows.iter().find(|w| w.label == name) {
                Some(config) => config,
                None => {
                    eprintln!("No window config found for label {:?}", name);
                    return;
                }
            };

            let builder = match WebviewWindowBuilder::from_config(app, config) {
                Ok(builder) => builder,
                Err(err) => {
                    eprintln!("Failed to build window config for {:?}: {}", name, err);
                    return;
                }
            };

            match builder.build() {
                Ok(window) => disable_alt_menu(&window),
                Err(err) => eprintln!("Failed to open window {:?}: {}", name, err),
            }
        }
    };
}

pub struct ScreenshotWebview<R: Runtime> {
    pub window: WebviewWindow<R>,
    pub position: WindowBounds,
    pub monitor_positions: Vec<WindowBounds>,
}

/// Stops the `Alt` in a global hotkey from dropping the focused window into the
/// Win32 menu modal loop. Firing an instant-capture shortcut (which, unlike the
/// normal screenshot, never brings a window to the foreground) otherwise leaves
/// whichever of our windows was focused frozen until the next click, because the
/// stray `Alt` press/release around the hotkey activates (empty) menu mode.
#[cfg(target_os = "windows")]
fn disable_alt_menu<R: Runtime>(window: &WebviewWindow<R>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::SetWindowSubclass;

    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let _ = SetWindowSubclass(HWND(hwnd.0 as _), Some(alt_menu_subclass_proc), 1, 0);
        }
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn alt_menu_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::{SC_KEYMENU, WM_SYSCOMMAND};

    if msg == WM_SYSCOMMAND && (wparam.0 & 0xFFF0) == SC_KEYMENU as usize {
        return LRESULT(0);
    }

    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

#[cfg(not(target_os = "windows"))]
fn disable_alt_menu<R: Runtime>(_window: &WebviewWindow<R>) {}
