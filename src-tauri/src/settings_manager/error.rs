use std::{error::Error, fmt::Display, io::Error as IoError};

use serde_json::Error as SerdeError;

use super::ShortcutError;

#[derive(Debug)]
pub enum SettingsError {
    IoError(IoError),
    SerdeError(SerdeError),
    ShortcutError(ShortcutError),
    AutostartError(String),
}

impl Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::IoError(error) => write!(f, "Couldn't access the settings file: {error}"),
            Self::SerdeError(error) => write!(f, "The settings file is invalid: {error}"),
            Self::ShortcutError(error) => write!(f, "{error}"),
            Self::AutostartError(error) => write!(f, "Couldn't change start with system: {error}"),
        }
    }
}

impl Error for SettingsError {}

crate::serialize_as_message!(SettingsError);

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
