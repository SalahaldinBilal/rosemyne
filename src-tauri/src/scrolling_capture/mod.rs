use serde::{Deserialize, Serialize};

pub mod commands;
pub mod error;
pub mod result_window;
pub mod scroll_trait;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "windows")]
pub type ScrollManager = windows::WindowsScrollInputManager;
#[cfg(target_os = "linux")]
pub type ScrollManager = linux::LinuxScrollInputManager;

/// How far one scroll step tries to move the target, converted to a notch
/// count via `commands::notches_for_distance`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum ScrollDistance {
    /// Percent of the captured region's height, the default, scales with
    /// whatever the user selected instead of needing to be re-tuned per capture.
    Percent(u32),
    Pixels(u32),
}

impl Default for ScrollDistance {
    fn default() -> Self {
        Self::Percent(80)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScrollingCaptureSettings {
    pub max_frames: u32,
    pub frame_delay_ms: u32,
    pub scroll_distance: ScrollDistance,
}

impl Default for ScrollingCaptureSettings {
    fn default() -> Self {
        Self {
            max_frames: 9,
            frame_delay_ms: 400,
            scroll_distance: ScrollDistance::default(),
        }
    }
}
