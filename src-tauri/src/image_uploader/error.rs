use std::{error::Error, fmt::Display, io::Error as IoError};

use serde::Serialize;
use url::ParseError as UrlParseError;

use crate::error_serializers::error_serialize;

/// Exactly what was sent for a failed upload request , shown in a details
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
            Self::InvalidUrl { url, error } => f.write_str(&format!(
                "UploaderError::InvalidUrl: {{ url: {:?}, error: {:?} }}",
                url, error
            )),
            Self::InvalidMethod(method) => {
                f.write_str(&format!("UploaderError::InvalidMethod: {:?}", method))
            }
            Self::InvalidHeaderName(name) => {
                f.write_str(&format!("UploaderError::InvalidHeaderName: {:?}", name))
            }
            Self::InvalidHeaderValue(value) => {
                f.write_str(&format!("UploaderError::InvalidHeaderValue: {:?}", value))
            }
            Self::InvalidMime(mime) => {
                f.write_str(&format!("UploaderError::InvalidMime: {:?}", mime))
            }
            Self::RequestFailed { request, error } => f.write_str(&format!(
                "UploaderError::RequestFailed: {{ request: {:?}, error: {} }}",
                request, error
            )),
            Self::HttpError { status, body, .. } => f.write_str(&format!(
                "UploaderError::HttpError: {{ status: {}, body: {:?} }}",
                status, body
            )),
            Self::ResponseNotJson(body) => {
                f.write_str(&format!("UploaderError::ResponseNotJson: {:?}", body))
            }
            Self::JsonPathNotFound { path } => {
                f.write_str(&format!("UploaderError::JsonPathNotFound: {:?}", path))
            }
            Self::ImageNotFound(file_name) => {
                f.write_str(&format!("UploaderError::ImageNotFound: {:?}", file_name))
            }
            Self::UploaderNotFound(id) => {
                f.write_str(&format!("UploaderError::UploaderNotFound: {:?}", id))
            }
            Self::NoDefaultUploader => {
                f.write_str("UploaderError::NoDefaultUploader: no default uploader is configured")
            }
            Self::FileReadFailed(error) => {
                f.write_str(&format!("UploaderError::FileReadFailed: {}", error))
            }
        }
    }
}

impl Error for UploaderError {}
