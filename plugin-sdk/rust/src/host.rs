//! What a plugin can ask Rosemyne to do. A call the plugin has no permission for,
//! or one made outside the hook it belongs to, ends the hook with an error.

use extism_pdk::Memory;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

use crate::{HookResult, ToastKind};

mod raw {
    #[link(wasm_import_module = "extism:host/user")]
    extern "C" {
        pub fn log(args: u64) -> u64;
        pub fn kv_get(key: u64) -> u64;
        pub fn kv_set(key: u64, value: u64) -> u64;
        pub fn kv_delete(key: u64) -> u64;
        pub fn kv_keys(prefix: u64) -> u64;
        pub fn settings_get(id: u64) -> u64;
        pub fn capture_file() -> u64;
        pub fn capture_pixels(args: u64) -> u64;
        pub fn image_set_pixels(size: u64, pixels: u64) -> u64;
        pub fn tags_get() -> u64;
        pub fn tags_set(value: u64) -> u64;
        pub fn clipboard_write_text(text: u64) -> u64;
        pub fn toast(args: u64) -> u64;
        pub fn http_request(request: u64, bytes: u64) -> u64;
        pub fn http_response_body() -> u64;
        pub fn asset_put(args: u64, bytes: u64) -> u64;
    }
}

// Offset 0 stands for an empty block in both directions.
struct Block(Option<Memory>);

impl Block {
    fn new(bytes: &[u8]) -> HookResult<Self> {
        if bytes.is_empty() {
            return Ok(Self(None));
        }
        Memory::from_bytes(bytes).map(|memory| Self(Some(memory))).map_err(|err| err.to_string())
    }

    fn json(value: &impl Serialize) -> HookResult<Self> {
        Self::new(&serde_json::to_vec(value).map_err(|err| err.to_string())?)
    }

    fn offset(&self) -> u64 {
        self.0.as_ref().map_or(0, Memory::offset)
    }

    fn free(self) {
        if let Some(memory) = self.0 {
            memory.free();
        }
    }
}

fn take(offset: u64) -> Vec<u8> {
    if offset == 0 {
        return Vec::new();
    }
    match Memory::find(offset) {
        Some(memory) => {
            let bytes = memory.to_vec();
            memory.free();
            bytes
        }
        None => Vec::new(),
    }
}

fn parse<T: DeserializeOwned>(bytes: &[u8]) -> HookResult<T> {
    serde_json::from_slice(bytes).map_err(|err| format!("Unexpected reply from Rosemyne: {err}"))
}

fn call1(function: unsafe extern "C" fn(u64) -> u64, argument: Block) -> Vec<u8> {
    let output = take(unsafe { function(argument.offset()) });
    argument.free();
    output
}

fn call2(function: unsafe extern "C" fn(u64, u64) -> u64, first: Block, second: Block) -> Vec<u8> {
    let output = take(unsafe { function(first.offset(), second.offset()) });
    first.free();
    second.free();
    output
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

pub fn log(level: LogLevel, text: &str) {
    if let Ok(args) = Block::json(&serde_json::json!({ "level": level, "text": text })) {
        call1(raw::log, args);
    }
}

pub fn kv_get(key: &str) -> HookResult<Option<Vec<u8>>> {
    let mut output = call1(raw::kv_get, Block::new(key.as_bytes())?);
    if output.first() != Some(&1) {
        return Ok(None);
    }
    output.remove(0);
    Ok(Some(output))
}

pub fn kv_set(key: &str, value: &[u8]) -> HookResult<()> {
    call2(raw::kv_set, Block::new(key.as_bytes())?, Block::new(value)?);
    Ok(())
}

pub fn kv_delete(key: &str) -> HookResult<()> {
    call1(raw::kv_delete, Block::new(key.as_bytes())?);
    Ok(())
}

pub fn kv_keys(prefix: &str) -> HookResult<Vec<String>> {
    parse(&call1(raw::kv_keys, Block::new(prefix.as_bytes())?))
}

/// The value of a static setting from `plugin.json`, or its declared default. `None` when it has neither.
pub fn setting<T: DeserializeOwned>(id: &str) -> HookResult<Option<T>> {
    parse(&call1(raw::settings_get, Block::new(id.as_bytes())?))
}

/// The saved file of the capture this hook runs for, as stored on disk.
pub fn capture_file() -> Vec<u8> {
    take(unsafe { raw::capture_file() })
}

#[derive(Debug, Clone)]
pub struct Pixels {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// RGBA pixels of the current capture, scaled down so no side is longer than `max_side`.
/// Inside `edit_image` this is the image being edited.
pub fn capture_pixels(max_side: Option<u32>) -> HookResult<Pixels> {
    let mut output = call1(raw::capture_pixels, Block::json(&serde_json::json!({ "maxSide": max_side }))?);
    if output.len() < 8 {
        return Err("Rosemyne returned no pixels".into());
    }
    let rgba = output.split_off(8);
    let width = u32::from_le_bytes([output[0], output[1], output[2], output[3]]);
    let height = u32::from_le_bytes([output[4], output[5], output[6], output[7]]);
    Ok(Pixels { width, height, rgba })
}

/// Replaces the image being saved. Only inside `edit_image`.
pub fn set_image_pixels(width: u32, height: u32, rgba: &[u8]) -> HookResult<()> {
    call2(
        raw::image_set_pixels,
        Block::json(&serde_json::json!({ "width": width, "height": height }))?,
        Block::new(rgba)?,
    );
    Ok(())
}

/// Every tag of the current capture.
pub fn tags() -> HookResult<Value> {
    parse(&take(unsafe { raw::tags_get() }))
}

/// Replaces what sits under the plugin's `tagKey` on the current capture. `None` removes it.
pub fn set_tags(value: Option<&Value>) -> HookResult<()> {
    call1(raw::tags_set, Block::json(&value)?);
    Ok(())
}

pub fn clipboard_write_text(text: &str) -> HookResult<()> {
    call1(raw::clipboard_write_text, Block::new(text.as_bytes())?);
    Ok(())
}

/// Shows a notification in Rosemyne's main window. At most one per 2 seconds gets through.
pub fn toast(kind: ToastKind, text: &str) -> HookResult<()> {
    call1(raw::toast, Block::json(&serde_json::json!({ "kind": kind, "text": text }))?);
    Ok(())
}

/// Stores an image for an `image` node. PNG, JPEG, WebP or GIF, 8 MB per plugin in total.
pub fn asset_put(id: &str, mime: &str, bytes: &[u8]) -> HookResult<()> {
    call2(
        raw::asset_put,
        Block::json(&serde_json::json!({ "id": id, "mime": mime }))?,
        Block::new(bytes)?,
    );
    Ok(())
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub capture_file: bool,
    pub bytes: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
}

impl Part {
    pub fn text(name: impl Into<String>, text: impl Into<String>) -> Self {
        Self { name: name.into(), text: Some(text.into()), ..Self::default() }
    }

    /// The current capture's file, sent by Rosemyne without passing through the plugin.
    pub fn capture_file(name: impl Into<String>) -> Self {
        Self { name: name.into(), capture_file: true, ..Self::default() }
    }

    /// The request's own bytes (`HttpRequest::bytes`). One part per request can use them.
    pub fn bytes(name: impl Into<String>) -> Self {
        Self { name: name.into(), bytes: true, ..Self::default() }
    }

    pub fn file_name(mut self, file_name: impl Into<String>) -> Self {
        self.file_name = Some(file_name.into());
        self
    }

    pub fn mime(mut self, mime: impl Into<String>) -> Self {
        self.mime = Some(mime.into());
        self
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Body {
    #[default]
    None,
    Text { text: String },
    Json { json: Value },
    Bytes,
    CaptureFile,
    Multipart { parts: Vec<Part> },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Body,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(skip)]
    pub bytes: Vec<u8>,
}

impl HttpRequest {
    pub fn new(method: impl Into<String>, url: impl Into<String>) -> Self {
        Self {
            method: method.into(),
            url: url.into(),
            headers: Vec::new(),
            body: Body::None,
            timeout_ms: None,
            bytes: Vec::new(),
        }
    }

    pub fn get(url: impl Into<String>) -> Self {
        Self::new("GET", url)
    }

    pub fn post(url: impl Into<String>) -> Self {
        Self::new("POST", url)
    }

    pub fn header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    pub fn text(mut self, text: impl Into<String>) -> Self {
        self.body = Body::Text { text: text.into() };
        self
    }

    pub fn json(mut self, json: Value) -> Self {
        self.body = Body::Json { json };
        self
    }

    pub fn bytes(mut self, bytes: Vec<u8>) -> Self {
        self.body = Body::Bytes;
        self.bytes = bytes;
        self
    }

    /// Sends the current capture's file as the body. Needs `capturesRead`.
    pub fn capture_file(mut self) -> Self {
        self.body = Body::CaptureFile;
        self
    }

    pub fn multipart(mut self, parts: Vec<Part>) -> Self {
        self.body = Body::Multipart { parts };
        self
    }

    /// Bytes for the one multipart part made with `Part::bytes`.
    pub fn part_bytes(mut self, bytes: Vec<u8>) -> Self {
        self.bytes = bytes;
        self
    }

    pub fn timeout_ms(mut self, ms: u64) -> Self {
        self.timeout_ms = Some(ms);
        self
    }

    /// `Err` is a network failure or a refused host. An HTTP error status is still `Ok`.
    pub fn send(self) -> HookResult<HttpResponse> {
        let output = call2(raw::http_request, Block::json(&self)?, Block::new(&self.bytes)?);
        let reply: Reply = parse(&output)?;
        if let Some(error) = reply.error {
            return Err(error);
        }
        Ok(HttpResponse {
            status: reply.status,
            headers: reply.headers,
            body: take(unsafe { raw::http_response_body() }),
        })
    }
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    status: u16,
    #[serde(default)]
    headers: Vec<(String, String)>,
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl HttpResponse {
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    pub fn json<T: DeserializeOwned>(&self) -> HookResult<T> {
        serde_json::from_slice(&self.body).map_err(|err| format!("The response is not the expected JSON: {err}"))
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}
