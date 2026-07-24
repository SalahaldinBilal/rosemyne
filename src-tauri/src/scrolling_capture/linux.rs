use crate::{MouseHandler, screen_manager::window::WindowBounds};

use super::error::ScrollCaptureError;
use super::scroll_trait::ScrollInputManager;

/// Stub, matching `capture::linux`/`recording::linux`, moot until
/// `LinuxCaptureManager` can actually grab frames.
pub struct LinuxScrollInputManager;

impl ScrollInputManager for LinuxScrollInputManager {
    fn focus_target(_region: &WindowBounds) -> Result<(), ScrollCaptureError> {
        Err(ScrollCaptureError::Unsupported(
            "Scrolling capture is not implemented on Linux yet",
        ))
    }

    fn scroll_step(_amount: i32, _mouse: &MouseHandler) -> Result<(), ScrollCaptureError> {
        Err(ScrollCaptureError::Unsupported(
            "Scrolling capture is not implemented on Linux yet",
        ))
    }
}
