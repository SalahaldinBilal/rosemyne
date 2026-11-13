use std::sync::Arc;
use std::time::{Duration, Instant};

use extism::{CurrentPlugin, Function, PTR, UserData, Val};
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{Emitter, Manager};

use crate::screen_manager::screenshot_manager::{HistoryItemType, TagValue};
use crate::{HistoryStoreHandler, emit_on_main_thread};

use super::manifest::{HOOK_EDIT_IMAGE, HOOK_UPLOAD};
use super::net::{self, CaptureBytes, HttpInputs, HttpRequest};
use super::runtime::HostShared;
use super::store::SETTING_PREFIX;

const MAX_CAPTURE_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_IMAGE_SIDE: u32 = 32_768;
const MAX_TAG_BYTES: usize = 64 * 1024;
const MAX_TOAST_CHARS: usize = 300;
const TOAST_INTERVAL: Duration = Duration::from_secs(2);
const ASSET_MIMES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];

type Shared = Arc<HostShared>;
type HostResult = Result<Option<Vec<u8>>, String>;
type HostFn = fn(&Shared, Vec<Vec<u8>>) -> HostResult;

/// Every host function takes its arguments as memory blocks (JSON, text or raw bytes)
/// and returns one, which is 0 when there is nothing to return, so all of them have the
/// same shape for every PDK. A returned error fails the hook call it happened in.
const FUNCTIONS: &[(&str, usize, HostFn)] = &[
    ("log", 1, log),
    ("kv_get", 1, kv_get),
    ("kv_set", 2, kv_set),
    ("kv_delete", 1, kv_delete),
    ("kv_keys", 1, kv_keys),
    ("settings_get", 1, settings_get),
    ("capture_file", 0, capture_file),
    ("capture_pixels", 1, capture_pixels),
    ("image_set_pixels", 2, image_set_pixels),
    ("tags_get", 0, tags_get),
    ("tags_set", 1, tags_set),
    ("clipboard_write_text", 1, clipboard_write_text),
    ("toast", 1, toast),
    ("http_request", 2, http_request),
    ("http_response_body", 0, http_response_body),
    ("asset_put", 2, asset_put),
];

pub fn functions(shared: &Shared) -> Vec<Function> {
    FUNCTIONS
        .iter()
        .map(|&(name, params, body)| {
            Function::new(
                name,
                vec![PTR; params],
                vec![PTR],
                UserData::new(shared.clone()),
                move |plugin: &mut CurrentPlugin, inputs: &[Val], outputs: &mut [Val], data: UserData<Shared>| {
                    let shared = data
                        .get()?
                        .lock()
                        .map_err(|_| extism::Error::msg("Plugin host state is unavailable"))?
                        .clone();

                    let mut args = Vec::with_capacity(inputs.len());
                    // Offset 0 stands for an empty block in both directions, since Extism has no empty allocation.
                    for input in inputs {
                        args.push(match input {
                            Val::I64(0) => Vec::new(),
                            _ => plugin.memory_get_val::<Vec<u8>>(input)?,
                        });
                    }

                    match body(&shared, args) {
                        Ok(Some(bytes)) if !bytes.is_empty() => plugin.memory_set_val(&mut outputs[0], bytes),
                        Ok(_) => {
                            outputs[0] = Val::I64(0);
                            Ok(())
                        }
                        Err(message) => Err(extism::Error::msg(format!("{name}: {message}"))),
                    }
                },
            )
        })
        .collect()
}

fn text(bytes: Vec<u8>) -> Result<String, String> {
    String::from_utf8(bytes).map_err(|_| "Expected UTF-8 text".to_string())
}

fn parse<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, String> {
    serde_json::from_slice(bytes).map_err(|err| format!("Invalid JSON argument: {err}"))
}

fn to_json(value: &impl Serialize) -> HostResult {
    serde_json::to_vec(value).map(Some).map_err(|err| err.to_string())
}

fn require(granted: bool, permission: &str) -> Result<(), String> {
    if granted { Ok(()) } else { Err(format!("This plugin doesn't have the {permission} permission")) }
}

fn current_capture(shared: &Shared) -> Result<super::runtime::CaptureRef, String> {
    shared
        .call
        .lock()
        .expect("call state not poisoned")
        .capture
        .clone()
        .ok_or_else(|| "This call isn't running for a capture".to_string())
}

fn current_hook(shared: &Shared) -> &'static str {
    shared.call.lock().expect("call state not poisoned").hook
}

fn mime_for(file_name: &str) -> String {
    let extension = file_name.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        _ => "application/octet-stream",
    }
    .to_owned()
}

fn read_capture_file(shared: &Shared) -> Result<(Vec<u8>, String), String> {
    let capture = current_capture(shared)?;
    let size = std::fs::metadata(&capture.file_path)
        .map_err(|err| format!("Couldn't read the capture: {err}"))?
        .len();
    if size > MAX_CAPTURE_FILE_BYTES {
        return Err(format!(
            "The capture is larger than {} MB",
            MAX_CAPTURE_FILE_BYTES / (1024 * 1024)
        ));
    }
    let bytes = std::fs::read(&capture.file_path).map_err(|err| format!("Couldn't read the capture: {err}"))?;
    Ok((bytes, capture.file_name))
}

#[derive(Deserialize)]
struct LogArgs {
    #[serde(default)]
    level: String,
    text: String,
}

fn log(shared: &Shared, args: Vec<Vec<u8>>) -> HostResult {
    let args: LogArgs = parse(&args[0])?;
    shared.log.push(&args.level, &args.text);
    Ok(None)
}

// A leading 0 byte means "no such key", 1 means the value follows.
fn kv_get(shared: &Shared, mut args: Vec<Vec<u8>>) -> HostResult {
    let key = text(args.remove(0))?;
    let output = match shared.store.kv_get(&shared.plugin_id, &key)? {
        Some(value) => {
            let mut output = Vec::with_capacity(value.len() + 1);
            output.push(1);
            output.extend_from_slice(&value);
            output
        }
        None => vec![0],
    };
    Ok(Some(output))
}

fn kv_set(shared: &Shared, mut args: Vec<Vec<u8>>) -> HostResult {
    let value = args.remove(1);
    let key = text(args.remove(0))?;
    shared.store.kv_set(&shared.plugin_id, &key, &value)?;
    Ok(None)
}

fn kv_delete(shared: &Shared, mut args: Vec<Vec<u8>>) -> HostResult {
    let key = text(args.remove(0))?;
    shared.store.kv_delete(&shared.plugin_id, &key)?;
    Ok(None)
}

fn kv_keys(shared: &Shared, mut args: Vec<Vec<u8>>) -> HostResult {
    let prefix = text(args.remove(0))?;
    to_json(&shared.store.kv_keys(&shared.plugin_id, &prefix)?)
}

fn settings_get(shared: &Shared, mut args: Vec<Vec<u8>>) -> HostResult {
    let id = text(args.remove(0))?;
    let stored = shared.store.kv_get(&shared.plugin_id, &format!("{SETTING_PREFIX}{id}"))?;
    match stored {
        Some(value) => Ok(Some(value)),
        None => to_json(&shared.manifest.setting_default(&id).unwrap_or(Value::Null)),
    }
}

fn capture_file(shared: &Shared, _args: Vec<Vec<u8>>) -> HostResult {
    require(shared.manifest.permissions.captures_read, "capturesRead")?;
    read_capture_file(shared).map(|(bytes, _)| Some(bytes))
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct PixelsArgs {
    max_side: Option<u32>,
}

// Output is width and height as little-endian u32s, then the RGBA bytes.
fn capture_pixels(shared: &Shared, args: Vec<Vec<u8>>) -> HostResult {
    let editing = current_hook(shared) == HOOK_EDIT_IMAGE;
    let permissions = &shared.manifest.permissions;
    require(
        permissions.captures_read || (editing && permissions.captures_edit),
        "capturesRead",
    )?;
    let args: PixelsArgs = if args[0].is_empty() { PixelsArgs::default() } else { parse(&args[0])? };

    let being_edited = shared.call.lock().expect("call state not poisoned").image.clone();
    let mut image = match being_edited {
        Some(image) => image,
        None => {
            let capture = current_capture(shared)?;
            if capture.item_type != HistoryItemType::Image {
                return Err("Only images have pixels to read".into());
            }
            image::open(&capture.file_path)
                .map_err(|err| format!("Couldn't decode the capture: {err}"))?
                .into_rgba8()
        }
    };

    if let Some(max_side) = args.max_side.filter(|side| *side > 0) {
        let largest = image.width().max(image.height());
        if largest > max_side {
            let scale = max_side as f64 / largest as f64;
            let width = ((image.width() as f64 * scale).round() as u32).max(1);
            let height = ((image.height() as f64 * scale).round() as u32).max(1);
            image = image::imageops::thumbnail(&image, width, height);
        }
    }

    let (width, height) = image.dimensions();
    let pixels = image.into_raw();
    let mut output = Vec::with_capacity(pixels.len() + 8);
    output.extend_from_slice(&width.to_le_bytes());
    output.extend_from_slice(&height.to_le_bytes());
    output.extend_from_slice(&pixels);
    Ok(Some(output))
}

#[derive(Deserialize)]
struct SizeArgs {
    width: u32,
    height: u32,
}

fn image_set_pixels(shared: &Shared, mut args: Vec<Vec<u8>>) -> HostResult {
    require(shared.manifest.permissions.captures_edit, "capturesEdit")?;
    if current_hook(shared) != HOOK_EDIT_IMAGE {
        return Err("The image can only be replaced inside edit_image".into());
    }

    let pixels = args.remove(1);
    let size: SizeArgs = parse(&args[0])?;
    if size.width == 0 || size.height == 0 || size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE {
        return Err(format!("Image sides must be 1 to {MAX_IMAGE_SIDE} pixels"));
    }
    let image = RgbaImage::from_raw(size.width, size.height, pixels)
        .ok_or("The pixel data doesn't match width * height * 4")?;

    let mut state = shared.call.lock().expect("call state not poisoned");
    state.image = Some(image);
    state.image_changed = true;
    Ok(None)
}

fn tags_get(shared: &Shared, _args: Vec<Vec<u8>>) -> HostResult {
    require(shared.manifest.permissions.tags_read, "tagsRead")?;
    let capture = current_capture(shared)?;
    let entry = shared
        .app
        .state::<HistoryStoreHandler>()
        .get_by_file_name(&capture.file_name)
        .map_err(|err| err.to_string())?;
    to_json(&entry.and_then(|entry| entry.tags).unwrap_or_default())
}

fn tags_set(shared: &Shared, args: Vec<Vec<u8>>) -> HostResult {
    require(shared.manifest.permissions.tags_write, "tagsWrite")?;
    let key = shared.manifest.tag_key.as_deref().ok_or("This plugin has no tagKey")?;
    let capture = current_capture(shared)?;

    if args[0].len() > MAX_TAG_BYTES {
        return Err(format!("Tags can't be larger than {} KB", MAX_TAG_BYTES / 1024));
    }
    let value: Option<TagValue> = match parse::<Value>(&args[0])? {
        Value::Null => None,
        value => Some(serde_json::from_value(value).map_err(|_| {
            "Tags must be text, numbers, booleans, objects, or lists of one of those".to_string()
        })?),
    };

    let entry = shared
        .app
        .state::<HistoryStoreHandler>()
        .set_tag_key(&capture.file_name, key, value)
        .map_err(|err| err.to_string())?;
    emit_on_main_thread!(shared.app, "history://tags-updated", entry);
    Ok(None)
}

fn clipboard_write_text(shared: &Shared, mut args: Vec<Vec<u8>>) -> HostResult {
    require(shared.manifest.permissions.clipboard_write, "clipboardWrite")?;
    let text = text(args.remove(0))?;
    crate::file_clipboard::copy_text(&text).map_err(|err| err.to_string())?;
    Ok(None)
}

#[derive(Deserialize)]
struct ToastArgs {
    #[serde(default)]
    kind: String,
    text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToastEvent {
    pub plugin_id: String,
    pub plugin_name: String,
    pub kind: String,
    pub text: String,
}

fn toast(shared: &Shared, args: Vec<Vec<u8>>) -> HostResult {
    require(shared.manifest.permissions.toast, "toast")?;
    let args: ToastArgs = parse(&args[0])?;

    let mut last = shared.last_toast.lock().expect("toast clock not poisoned");
    if last.is_some_and(|at| at.elapsed() < TOAST_INTERVAL) {
        shared.log.push("warn", &format!("Notification dropped (too many): {}", args.text));
        return Ok(None);
    }
    *last = Some(Instant::now());
    drop(last);

    let kind = match args.kind.as_str() {
        "success" | "error" => args.kind,
        _ => "info".to_owned(),
    };
    emit_on_main_thread!(
        shared.app,
        "plugins://toast",
        ToastEvent {
            plugin_id: shared.plugin_id.clone(),
            plugin_name: shared.manifest.name.clone(),
            kind,
            text: args.text.chars().take(MAX_TOAST_CHARS).collect(),
        }
    );
    Ok(None)
}

// Network failures come back as `{ "error": "..." }` so the plugin can handle them.
fn http_request(shared: &Shared, mut args: Vec<Vec<u8>>) -> HostResult {
    let allowed = &shared.manifest.permissions.network;
    require(!allowed.is_empty(), "network")?;
    let client = shared.client.as_ref().ok_or("This plugin has no network client")?;

    let bytes = args.remove(1);
    let request: HttpRequest = parse(&args[0])?;

    let capture = if net::wants_capture_file(&request) {
        require(shared.manifest.permissions.captures_read, "capturesRead")?;
        let (bytes, file_name) = read_capture_file(shared)?;
        let mime = mime_for(&file_name);
        Some(CaptureBytes { bytes, file_name, mime })
    } else {
        None
    };

    let on_progress: Option<crate::image_uploader::ProgressCallback> = match &capture {
        Some(capture) if current_hook(shared) == HOOK_UPLOAD => {
            let app = shared.app.clone();
            let file_name = capture.file_name.clone();
            Some(Box::new(move |sent, total| {
                emit_on_main_thread!(
                    app,
                    "upload://progress",
                    json!({ "fileName": file_name, "sent": sent, "total": total })
                );
            }))
        }
        _ => None,
    };

    let watch = shared.watch.lock().expect("watch slot not poisoned").clone();
    if let Some(watch) = &watch {
        watch.set_paused(true);
    }
    let outcome = tauri::async_runtime::block_on(net::execute(
        client,
        allowed,
        request,
        HttpInputs { bytes, capture, on_progress },
    ));
    if let Some(watch) = &watch {
        watch.set_paused(false);
    }

    match outcome {
        Ok((response, body)) => {
            shared.call.lock().expect("call state not poisoned").response_body = body;
            to_json(&response)
        }
        Err(error) => to_json(&json!({ "error": error })),
    }
}

fn http_response_body(shared: &Shared, _args: Vec<Vec<u8>>) -> HostResult {
    let body = std::mem::take(&mut shared.call.lock().expect("call state not poisoned").response_body);
    Ok(Some(body))
}

#[derive(Deserialize)]
struct AssetArgs {
    id: String,
    mime: String,
}

fn asset_put(shared: &Shared, mut args: Vec<Vec<u8>>) -> HostResult {
    let bytes = args.remove(1);
    let asset: AssetArgs = parse(&args[0])?;
    let valid_id = (1..=64).contains(&asset.id.len())
        && asset.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid_id {
        return Err("Image ids are 1 to 64 letters, digits, dashes and underscores".into());
    }
    if !ASSET_MIMES.contains(&asset.mime.as_str()) {
        return Err("Images must be PNG, JPEG, WebP or GIF".into());
    }
    shared.assets.put(&shared.plugin_id, &asset.id, asset.mime, bytes)?;
    Ok(None)
}
