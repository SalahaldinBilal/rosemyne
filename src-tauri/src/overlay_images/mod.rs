pub mod commands;

use serde::{Deserialize, Serialize};

/// `name` is what a placed overlay stores, so it's kept unique case-insensitively.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayImage {
    pub name: String,
    pub file_name: String,
}

/// Reserved for the built-in cursor entry, so a user image can't take its place.
pub const CURSOR_IMAGE_NAME: &str = "Cursor";
