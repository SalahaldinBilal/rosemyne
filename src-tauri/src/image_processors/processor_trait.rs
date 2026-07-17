use image::RgbaImage;

use super::error::ImageProcessingError;

pub trait ImageProcessor {
    fn process(&self, image: RgbaImage) -> Result<RgbaImage, ImageProcessingError>;
}
