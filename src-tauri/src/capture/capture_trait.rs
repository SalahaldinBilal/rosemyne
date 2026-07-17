use image::RgbaImage;

use crate::screen_manager::window::{WindowBounds, WindowInfo};

pub trait CaptureManager {
    fn capture(dims: &WindowBounds) -> Result<RgbaImage, Box<dyn std::error::Error>>;
    fn get_visible_windows(normalization_base: &WindowBounds) -> Vec<WindowInfo>;
}
