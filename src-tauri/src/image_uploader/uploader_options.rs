use std::{collections::HashMap, str::FromStr, sync::LazyLock};

use reqwest::{
    Client, Method, RequestBuilder,
    multipart::{Form, Part},
};
use serde::{Deserialize, Serialize};
use tauri::http::{HeaderMap, HeaderName, HeaderValue};
use url::Url;

use super::{RequestSnapshot, UploaderError};

static VAR_REGEX: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"\$\{([a-zA-Z0-9_]+)\}").expect("valid regex"));

/// `${…}` placeholders in the JSON response handler; unlike `VAR_REGEX` the
/// inside is a JSON path, so dots and indices are allowed.
static JSON_PLACEHOLDER_REGEX: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"\$\{([^}]+)\}").expect("valid regex"));

/// The file to upload plus the values available for `${var}` substitution.
#[derive(Debug, Clone)]
pub struct UploadFile {
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

impl UploadFile {
    pub fn from_file_name(name: String, bytes: Vec<u8>) -> Self {
        let mime = match name.rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            Some("webp") => "image/webp",
            Some("gif") => "image/gif",
            Some("bmp") => "image/bmp",
            _ => "application/octet-stream",
        };

        Self {
            name,
            mime: mime.to_owned(),
            bytes,
        }
    }

    fn vars(&self) -> HashMap<&'static str, String> {
        HashMap::from([
            ("filename", self.name.clone()),
            (
                "timestamp",
                chrono::Utc::now().timestamp_millis().to_string(),
            ),
        ])
    }
}

fn substitute(input: &str, vars: &HashMap<&'static str, String>) -> String {
    VAR_REGEX
        .replace_all(input, |caps: &regex::Captures| {
            vars.get(caps.get(1).expect("group 1 exists").as_str())
                .cloned()
                .unwrap_or_else(|| caps[0].to_owned())
        })
        .into_owned()
}

fn substitute_json(
    value: &serde_json::Value,
    vars: &HashMap<&'static str, String>,
) -> serde_json::Value {
    match value {
        serde_json::Value::String(text) => serde_json::Value::String(substitute(text, vars)),
        serde_json::Value::Array(items) => serde_json::Value::Array(
            items.iter().map(|item| substitute_json(item, vars)).collect(),
        ),
        serde_json::Value::Object(map) => serde_json::Value::Object(
            map.iter()
                .map(|(key, item)| (substitute(key, vars), substitute_json(item, vars)))
                .collect(),
        ),
        other => other.clone(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum UploaderResponseHandler {
    /// Treats response as text, optional `start` and `end` fields to offset text.
    ///
    /// They can go into the negatives to go through a string backwards.
    Text {
        start: Option<isize>,
        end: Option<isize>,
    },
    /// Treats the response as JSON. `path` is either a dot-separated path
    /// whose value becomes the URL (`data.url`, `files.0.link`), or , when it
    /// contains `${…}` placeholders , a template mixing literal text with
    /// extracted values (`https://files.example.com/${data.id}`).
    ///
    /// A path that doesn't exist in the response JSON fails the upload.
    Json { path: String },
}

impl UploaderResponseHandler {
    pub fn parse_response(&self, body: &str) -> Result<String, UploaderError> {
        match self {
            Self::Text { start, end } => {
                let chars: Vec<char> = body.chars().collect();
                let length = chars.len() as isize;
                let resolve = |index: Option<isize>, default: isize| -> usize {
                    let index = index.unwrap_or(default);
                    let from_start = if index < 0 { length + index } else { index };
                    from_start.clamp(0, length) as usize
                };

                let start = resolve(*start, 0);
                let end = resolve(*end, length);

                Ok(if start < end {
                    chars[start..end].iter().collect()
                } else {
                    String::new()
                })
            }
            Self::Json { path } => {
                let json: serde_json::Value = serde_json::from_str(body)
                    .map_err(|_| UploaderError::ResponseNotJson(truncate_body(body)))?;

                if !JSON_PLACEHOLDER_REGEX.is_match(path) {
                    return json_value_at(&json, path);
                }

                let mut result = String::new();
                let mut last = 0;
                for caps in JSON_PLACEHOLDER_REGEX.captures_iter(path) {
                    let placeholder = caps.get(0).expect("group 0 exists");
                    result.push_str(&path[last..placeholder.start()]);
                    result.push_str(&json_value_at(&json, &caps[1])?);
                    last = placeholder.end();
                }
                result.push_str(&path[last..]);

                Ok(result)
            }
        }
    }
}

/// Walks a dot-separated path , object keys by name, array items by index ,
/// and returns the value at it as a string.
fn json_value_at(json: &serde_json::Value, path: &str) -> Result<String, UploaderError> {
    let mut current = json;

    for segment in path.split('.').filter(|segment| !segment.is_empty()) {
        current = match current {
            serde_json::Value::Object(map) => map.get(segment),
            serde_json::Value::Array(items) => segment
                .parse::<usize>()
                .ok()
                .and_then(|index| items.get(index)),
            _ => None,
        }
        .ok_or_else(|| UploaderError::JsonPathNotFound {
            path: path.to_owned(),
        })?;
    }

    Ok(match current {
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    })
}

pub fn truncate_body(body: &str) -> String {
    body.chars().take(500).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum UploaderBodyHandler {
    // Uploads file
    /// Sends the file as a multipart form part named `file_name`,
    /// alongside any extra plain-text fields.
    #[serde(rename_all = "camelCase")]
    FormData {
        file_name: String,
        extra_fields: Option<Vec<KeyValue>>,
    },
    /// Sends the image as binary data in the body
    Binary,
    // Doesn't upload file
    /// Sends no body
    None,
    /// Sends the specified JSON body
    Json(serde_json::Value),
    /// Sends the given fields as a url encoded form
    FormUrlEncoded(Vec<KeyValue>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum UploaderMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    #[serde(untagged)]
    Unknown(String),
}

impl TryInto<Method> for UploaderMethod {
    type Error = UploaderError;

    fn try_into(self) -> Result<Method, Self::Error> {
        match self {
            UploaderMethod::Get => Ok(Method::GET),
            UploaderMethod::Post => Ok(Method::POST),
            UploaderMethod::Put => Ok(Method::PUT),
            UploaderMethod::Patch => Ok(Method::PATCH),
            UploaderMethod::Delete => Ok(Method::DELETE),
            UploaderMethod::Unknown(method) => Method::from_bytes(method.as_bytes())
                .map_err(|_| UploaderError::InvalidMethod(method)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedUploader {
    pub id: String,
    pub name: String,
    #[serde(default = "default_auto_upload")]
    pub auto_upload: bool,
    pub options: UploaderOptions,
}

fn default_auto_upload() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploaderOptions {
    pub url: String,
    pub method: UploaderMethod,
    pub params: Option<Vec<KeyValue>>,
    pub headers: Option<Vec<KeyValue>>,
    pub body_handler: UploaderBodyHandler,
    pub response_handler: UploaderResponseHandler,
}

/// Reports `(bytes_sent, total_bytes)` as an upload body is streamed out.
pub type ProgressCallback = Box<dyn FnMut(u64, u64) + Send + Sync>;

/// Wraps `bytes` in a chunked stream so reqwest reports progress as it's sent,
/// instead of handing over the whole buffer as one opaque body. Only used for
/// the real upload path , validation/test requests have nothing to track.
fn chunked_progress_body(bytes: Vec<u8>, mut on_progress: ProgressCallback) -> reqwest::Body {
    const CHUNK_SIZE: usize = 64 * 1024;
    let total = bytes.len() as u64;
    let mut sent: u64 = 0;
    let mut last_percent: u64 = u64::MAX;

    let chunks: Vec<Vec<u8>> = bytes.chunks(CHUNK_SIZE).map(<[u8]>::to_vec).collect();
    let stream = futures_util::stream::iter(chunks.into_iter().map(move |chunk| {
        sent += chunk.len() as u64;
        let percent = if total == 0 { 100 } else { sent * 100 / total };
        if percent != last_percent {
            last_percent = percent;
            on_progress(sent, total);
        }
        Ok::<Vec<u8>, std::io::Error>(chunk)
    }));

    reqwest::Body::wrap_stream(stream)
}

impl UploaderOptions {
    /// Returns the builder alongside a human-readable summary of the body ,
    /// the real text for JSON/form bodies, a byte-count/mime description for
    /// binary and multipart file parts (which aren't meaningfully "text") ,
    /// for `RequestSnapshot` if the request goes on to fail.
    pub fn build_request(
        &self,
        client: &Client,
        file: &UploadFile,
    ) -> Result<(RequestBuilder, String), UploaderError> {
        self.build_request_inner(client, file, None)
    }

    /// Same as `build_request`, but the file bytes are streamed through
    /// `on_progress` as they're handed to the HTTP client.
    pub fn build_upload_request(
        &self,
        client: &Client,
        file: &UploadFile,
        on_progress: ProgressCallback,
    ) -> Result<(RequestBuilder, String), UploaderError> {
        self.build_request_inner(client, file, Some(on_progress))
    }

    fn build_request_inner(
        &self,
        client: &Client,
        file: &UploadFile,
        on_progress: Option<ProgressCallback>,
    ) -> Result<(RequestBuilder, String), UploaderError> {
        let vars = file.vars();

        let url_string = substitute(&self.url, &vars);
        let url = match &self.params {
            Some(params) if !params.is_empty() => Url::parse_with_params(
                &url_string,
                params
                    .iter()
                    .map(|kv| (substitute(&kv.key, &vars), substitute(&kv.value, &vars))),
            ),
            _ => Url::from_str(&url_string),
        }
        .map_err(|err| UploaderError::InvalidUrl {
            url: url_string,
            error: err,
        })?;

        let method: Method = self.method.clone().try_into()?;

        let mut headers = HeaderMap::new();
        if let Some(header_list) = &self.headers {
            for KeyValue { key, value } in header_list {
                let name = HeaderName::from_bytes(substitute(key, &vars).as_bytes())
                    .map_err(|_| UploaderError::InvalidHeaderName(key.clone()))?;
                let header_value = HeaderValue::from_bytes(substitute(value, &vars).as_bytes())
                    .map_err(|_| UploaderError::InvalidHeaderValue(value.clone()))?;
                headers.append(name, header_value);
            }
        }

        let body_summary = match &self.body_handler {
            UploaderBodyHandler::None => "(no body)".to_string(),
            UploaderBodyHandler::Binary => {
                format!("(binary image data, {} bytes, {})", file.bytes.len(), file.mime)
            }
            UploaderBodyHandler::FormData { file_name, extra_fields } => {
                let mut parts = vec![format!(
                    "{}: <{} bytes, {}>",
                    substitute(file_name, &vars),
                    file.bytes.len(),
                    file.mime
                )];
                for kv in extra_fields.iter().flatten() {
                    parts.push(format!("{}: {}", substitute(&kv.key, &vars), substitute(&kv.value, &vars)));
                }
                format!("multipart/form-data:\n{}", parts.join("\n"))
            }
            UploaderBodyHandler::Json(value) => {
                serde_json::to_string_pretty(&substitute_json(value, &vars)).unwrap_or_default()
            }
            UploaderBodyHandler::FormUrlEncoded(fields) => fields
                .iter()
                .map(|kv| format!("{}={}", substitute(&kv.key, &vars), substitute(&kv.value, &vars)))
                .collect::<Vec<_>>()
                .join("&"),
        };

        let mut request = client.request(method, url);

        request = match &self.body_handler {
            UploaderBodyHandler::None => request,
            UploaderBodyHandler::Binary => {
                let body = match on_progress {
                    Some(on_progress) => chunked_progress_body(file.bytes.clone(), on_progress),
                    None => reqwest::Body::from(file.bytes.clone()),
                };
                request.header("Content-Type", &file.mime).body(body)
            }
            UploaderBodyHandler::FormData {
                file_name,
                extra_fields,
            } => {
                let mut form = Form::new();

                if let Some(extra_fields) = extra_fields {
                    for kv in extra_fields {
                        form = form.text(substitute(&kv.key, &vars), substitute(&kv.value, &vars));
                    }
                }

                let part = match on_progress {
                    Some(on_progress) => Part::stream_with_length(
                        chunked_progress_body(file.bytes.clone(), on_progress),
                        file.bytes.len() as u64,
                    ),
                    None => Part::bytes(file.bytes.clone()),
                }
                .file_name(file.name.clone())
                .mime_str(&file.mime)
                .map_err(|_| UploaderError::InvalidMime(file.mime.clone()))?;

                form = form.part(substitute(file_name, &vars), part);

                request.multipart(form)
            }
            UploaderBodyHandler::Json(value) => request.json(&substitute_json(value, &vars)),
            UploaderBodyHandler::FormUrlEncoded(fields) => {
                let pairs: Vec<(String, String)> = fields
                    .iter()
                    .map(|kv| (substitute(&kv.key, &vars), substitute(&kv.value, &vars)))
                    .collect();

                request.form(&pairs)
            }
        };

        // User-provided headers go last so they can override generated ones
        // (e.g. Content-Type from the body handler).
        Ok((request.headers(headers), body_summary))
    }
}

/// Builds, snapshots, and sends a request, returning the response body text
/// on a successful status , or an `UploaderError` (`RequestFailed`/`HttpError`)
/// carrying the exact request that was sent (and, for `HttpError`, the
/// response headers) so a failure can actually be diagnosed. The single place
/// both the real upload and "Test upload" execute a request from.
pub async fn execute_and_capture(
    client: &Client,
    request_builder: RequestBuilder,
    body_summary: String,
) -> Result<String, UploaderError> {
    let fallback_snapshot = || RequestSnapshot {
        method: "?".to_string(),
        url: "?".to_string(),
        headers: Vec::new(),
        body: body_summary.clone(),
    };

    let request = request_builder
        .build()
        .map_err(|error| UploaderError::RequestFailed { request: fallback_snapshot(), error })?;

    let snapshot = RequestSnapshot {
        method: request.method().to_string(),
        url: request.url().to_string(),
        headers: request
            .headers()
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_str().unwrap_or("<binary>").to_string()))
            .collect(),
        body: body_summary,
    };

    let response = client
        .execute(request)
        .await
        .map_err(|error| UploaderError::RequestFailed { request: snapshot.clone(), error })?;

    let status = response.status();
    let response_headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_str().unwrap_or("<binary>").to_string()))
        .collect();

    let body = response
        .text()
        .await
        .map_err(|error| UploaderError::RequestFailed { request: snapshot.clone(), error })?;

    if !status.is_success() {
        return Err(UploaderError::HttpError {
            status: status.as_u16(),
            body,
            request: snapshot,
            response_headers,
        });
    }

    Ok(body)
}
