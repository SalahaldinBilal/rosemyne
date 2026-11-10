use std::{error::Error, fmt::Display};

use serde::Serialize;

#[derive(Debug, Serialize)]
pub enum ImageProcessingError {
    InvalidDimensions,
}

impl Display for ImageProcessingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidDimensions => {
                f.write_str("The selected area is outside the image")
            }
        }
    }
}

impl Error for ImageProcessingError {}
