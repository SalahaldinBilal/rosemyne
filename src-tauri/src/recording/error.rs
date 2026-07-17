use std::{error::Error, fmt::Display};

use serde::{Serialize, Serializer};

#[derive(Debug)]
pub enum RecordingError {
    Unsupported(&'static str),
    AlreadyRecording,
    NotRecording,
    Failed(String),
}

impl Display for RecordingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported(reason) => write!(f, "Recording is not supported: {}", reason),
            Self::AlreadyRecording => f.write_str("A recording is already in progress"),
            Self::NotRecording => f.write_str("No recording is in progress"),
            Self::Failed(reason) => f.write_str(reason),
        }
    }
}

impl Error for RecordingError {}

impl Serialize for RecordingError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<std::io::Error> for RecordingError {
    fn from(value: std::io::Error) -> Self {
        Self::Failed(value.to_string())
    }
}
