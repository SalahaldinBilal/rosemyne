use image::RgbaImage;

use super::capture_trait::CaptureManager;
use crate::screen_manager::window::{WindowBounds, WindowInfo};

pub struct LinuxCaptureManager;

impl CaptureManager for LinuxCaptureManager {
    fn capture(_dims: &WindowBounds) -> Result<RgbaImage, Box<dyn std::error::Error>> {
        Err("Linux screen capture is not implemented yet".into())
    }

    fn get_visible_windows(_normalization_base: &WindowBounds) -> Vec<WindowInfo> {
        Vec::new()
    }
}
