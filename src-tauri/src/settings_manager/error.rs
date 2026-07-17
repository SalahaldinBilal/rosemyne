use std::{error::Error, fmt::Display, io::Error as IoError};

use serde::Serialize;
use serde_json::Error as SerdeError;

use crate::error_serializers::error_serialize;

use super::ShortcutError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingsError {
    #[serde(serialize_with = "error_serialize")]
    IoError(IoError),
    #[serde(serialize_with = "error_serialize")]
    SerdeError(SerdeError),
    ShortcutError(ShortcutError),
    AutostartError(String),
}

impl Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::IoError(error) => f.write_str(&format!("SettingsError::IoError: {}", error)),
            Self::SerdeError(error) => {
                f.write_str(&format!("SettingsError::SerdeError: {}", error))
            }
            Self::ShortcutError(error) => {
                f.write_str(&format!("SettingsError::ShortcutError: {}", error))
            }
            Self::AutostartError(error) => {
                f.write_str(&format!("SettingsError::AutostartError: {}", error))
            }
        }
    }
}

impl Error for SettingsError {}

impl From<IoError> for SettingsError {
    fn from(value: IoError) -> Self {
        Self::IoError(value)
    }
}

impl From<SerdeError> for SettingsError {
    fn from(value: SerdeError) -> Self {
        Self::SerdeError(value)
    }
}

impl From<ShortcutError> for SettingsError {
    fn from(value: ShortcutError) -> Self {
        Self::ShortcutError(value)
    }
}
