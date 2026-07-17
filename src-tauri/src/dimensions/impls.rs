use serde::{Deserialize, Serialize};

use crate::{impl_basic_dimension, impl_basic_position};

use super::traits::{DimensionsTrait, PositionTrait};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Dimensions {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DimensionsWithOrder {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub z_order: u32,
}

impl_basic_position!(Position);
impl_basic_dimension!(Dimensions);
impl_basic_dimension!(DimensionsWithOrder);
