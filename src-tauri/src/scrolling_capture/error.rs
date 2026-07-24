use std::{error::Error, fmt::Display};

use serde::{Serialize, Serializer};

#[derive(Debug)]
pub enum ScrollCaptureError {
    Unsupported(&'static str),
    AlreadyCapturing,
    NotCapturing,
    Failed(String),
}

impl Display for ScrollCaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported(reason) => write!(f, "Scrolling capture is not supported: {}", reason),
            Self::AlreadyCapturing => f.write_str("A scrolling capture is already in progress"),
            Self::NotCapturing => f.write_str("No scrolling capture is in progress"),
            Self::Failed(reason) => f.write_str(reason),
        }
    }
}

impl Error for ScrollCaptureError {}

impl Serialize for ScrollCaptureError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
