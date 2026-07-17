use std::{error::Error, fmt::Display};

use serde::Serialize;

use crate::error_serializers::error_serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MigrationError {
    InvalidPath(String),
    DatabaseNotFound(String),
    DatabaseLocked(String),
    #[serde(serialize_with = "error_serialize")]
    IoError(std::io::Error),
    #[serde(serialize_with = "error_serialize")]
    SqliteError(rusqlite::Error),
    InsufficientSpace { required: u64, available: u64 },
    TaskError(String),
}

impl Display for MigrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPath(path) => write!(f, "MigrationError::InvalidPath: {}", path),
            Self::DatabaseNotFound(path) => write!(f, "MigrationError::DatabaseNotFound: {}", path),
            Self::DatabaseLocked(err) => write!(
                f,
                "MigrationError::DatabaseLocked (close ShareX and retry): {}",
                err
            ),
            Self::IoError(err) => write!(f, "MigrationError::IoError: {}", err),
            Self::SqliteError(err) => write!(f, "MigrationError::SqliteError: {}", err),
            Self::InsufficientSpace {
                required,
                available,
            } => write!(
                f,
                "MigrationError::InsufficientSpace: need {} bytes, {} available",
                required, available
            ),
            Self::TaskError(err) => write!(f, "MigrationError::TaskError: {}", err),
        }
    }
}

impl Error for MigrationError {}

impl From<std::io::Error> for MigrationError {
    fn from(value: std::io::Error) -> Self {
        Self::IoError(value)
    }
}

impl From<rusqlite::Error> for MigrationError {
    fn from(value: rusqlite::Error) -> Self {
        Self::SqliteError(value)
    }
}
