use std::{error::Error, fmt::Display, io::Error as IoError};

use serde::Serialize;
use url::ParseError as UrlParseError;

use crate::error_serializers::error_serialize;

/// Exactly what was sent for a failed upload request, shown in a details
/// modal so a broken uploader config can actually be diagnosed instead of
/// just reporting "it failed". `body` is a human-readable summary (the real
/// text for JSON/form bodies; a byte-count/mime description for binary and
/// multipart file parts, which aren't meaningfully "text").
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestSnapshot {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum UploaderError {
    InvalidUrl {
        url: String,
        #[serde(serialize_with = "error_serialize")]
        error: UrlParseError,
    },
    InvalidMethod(String),
    InvalidHeaderName(String),
    InvalidHeaderValue(String),
    InvalidMime(String),
    RequestFailed {
        request: RequestSnapshot,
        #[serde(serialize_with = "error_serialize")]
        error: reqwest::Error,
    },
    HttpError {
        status: u16,
        body: String,
        request: RequestSnapshot,
        #[serde(rename = "responseHeaders")]
        response_headers: Vec<(String, String)>,
    },
    ResponseNotJson(String),
    JsonPathNotFound {
        path: String,
    },
    ImageNotFound(String),
    UploaderNotFound(String),
    NoDefaultUploader,
    #[serde(serialize_with = "error_serialize")]
    FileReadFailed(IoError),
}

impl Display for UploaderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidUrl { url, error } => write!(f, "Invalid URL \"{url}\": {error}"),
            Self::InvalidMethod(method) => write!(f, "Invalid method \"{method}\""),
            Self::InvalidHeaderName(name) => write!(f, "Invalid header name \"{name}\""),
            Self::InvalidHeaderValue(value) => write!(f, "Invalid header value \"{value}\""),
            Self::InvalidMime(mime) => write!(f, "Invalid mime type \"{mime}\""),
            Self::RequestFailed { error, .. } => write!(f, "Request failed: {error}"),
            Self::HttpError { status, body, .. } => {
                write!(f, "Server responded with status {status}: {body}")
            }
            Self::ResponseNotJson(body) => write!(f, "Response was not valid JSON: {body}"),
            Self::JsonPathNotFound { path } => {
                write!(f, "Path \"{path}\" was not found in the JSON response")
            }
            Self::ImageNotFound(file_name) => write!(f, "Image \"{file_name}\" was not found in history"),
            Self::UploaderNotFound(id) => write!(f, "Uploader \"{id}\" no longer exists"),
            Self::NoDefaultUploader => f.write_str("No default uploader is configured"),
            Self::FileReadFailed(error) => write!(f, "Could not read the image file: {error}"),
        }
    }
}

impl Error for UploaderError {}
