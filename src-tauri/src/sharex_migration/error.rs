use std::{error::Error, fmt::Display};

use crate::serialize_as_message;

#[derive(Debug)]
pub enum MigrationError {
    InvalidPath(String),
    DatabaseNotFound(String),
    DatabaseLocked(String),
    IoError(std::io::Error),
    SqliteError(rusqlite::Error),
    InsufficientSpace { required: u64, available: u64 },
    TaskError(String),
}

impl Display for MigrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPath(path) => write!(f, "Folder not found: {path}"),
            Self::DatabaseNotFound(path) => write!(f, "No ShareX history found, {path} doesn't exist"),
            Self::DatabaseLocked(err) => write!(
                f,
                "Couldn't open the ShareX history ({err}). Close ShareX and try again"
            ),
            Self::IoError(err) => write!(f, "{err}"),
            Self::SqliteError(err) => write!(f, "Couldn't read the ShareX history: {err}"),
            Self::InsufficientSpace {
                required,
                available,
            } => write!(
                f,
                "Not enough disk space, the import needs {} and only {} is free",
                format_bytes(*required),
                format_bytes(*available)
            ),
            Self::TaskError(err) => write!(f, "{err}"),
        }
    }
}

impl Error for MigrationError {}

serialize_as_message!(MigrationError);

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

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
