use crate::dimensions::impls::Dimensions;

use super::{error::ImageProcessingError, processor_trait::ImageProcessor};
use image::{imageops::crop_imm, RgbaImage};

pub struct Crop {
    dims: Dimensions,
}

impl Crop {
    pub fn new(x: u32, y: u32, width: u32, height: u32) -> Self {
        Self {
            dims: Dimensions {
                x,
                y,
                width,
                height,
            },
        }
    }
}

impl ImageProcessor for Crop {
    fn process(&self, image: RgbaImage) -> Result<RgbaImage, ImageProcessingError> {
        if (image.width() < self.dims.x + self.dims.width)
            || (image.height() < self.dims.y + self.dims.height)
        {
            return Err(ImageProcessingError::InvalidDimensions);
        }

        Ok(crop_imm(
            &image,
            self.dims.x,
            self.dims.y,
            self.dims.width,
            self.dims.height,
        )
        .to_image())
    }
}

impl<S: Into<Dimensions>> From<S> for Crop {
    fn from(dims: S) -> Self {
        let dims = dims.into();

        Self { dims }
    }
}
