use crate::{MouseHandler, screen_manager::window::WindowBounds};

use super::error::ScrollCaptureError;

pub trait ScrollInputManager {
    /// Called once, before the capture loop starts: gives the target real OS
    /// input focus, since wheel input routes by focus, not cursor position.
    /// Returns `Unsupported` on platforms that can't do scrolling capture at all.
    fn focus_target(region: &WindowBounds) -> Result<(), ScrollCaptureError>;

    /// Scrolls the already-focused target by one step. `amount` is in wheel
    /// notches (negative scrolls down, positive scrolls up), matching
    /// `mouse_rs::Mouse::wheel`'s own convention.
    fn scroll_step(amount: i32, mouse: &MouseHandler) -> Result<(), ScrollCaptureError>;
}
