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
                f.write_str("ImageProcessingError::InvalidDimensions Given dimensions are invalid")
            }
        }
    }
}

impl Error for ImageProcessingError {}
