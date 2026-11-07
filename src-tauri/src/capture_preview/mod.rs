use serde::{Deserialize, Serialize};

pub mod commands;
#[cfg(target_os = "windows")]
mod keep_on_top;

pub const CAPTURE_PREVIEW_LABEL: &str = "capture-preview";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PreviewCorner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PreviewClickAction {
    Nothing,
    Close,
    OpenFile,
    OpenFolder,
    CopyFile,
    CopyLink,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CapturePreviewSettings {
    pub enabled: bool,
    /// `None` = primary monitor, otherwise a `monitors` id, re-resolved on every show.
    pub monitor_id: Option<String>,
    pub corner: PreviewCorner,
    pub margin_x: u32,
    pub margin_y: u32,
    pub max_width: u32,
    pub max_height: u32,
    /// 0, stays open until clicked instead of auto-dismissing.
    pub auto_dismiss_ms: u32,
    /// Hides only the shrinking bar. The auto-dismiss timer still runs.
    pub show_countdown: bool,
    pub left_click_action: PreviewClickAction,
    pub right_click_action: PreviewClickAction,
}

impl Default for CapturePreviewSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            monitor_id: None,
            corner: PreviewCorner::BottomRight,
            margin_x: 25,
            margin_y: 25,
            max_width: 320,
            max_height: 240,
            auto_dismiss_ms: 5000,
            show_countdown: true,
            left_click_action: PreviewClickAction::Close,
            right_click_action: PreviewClickAction::Nothing,
        }
    }
}
