use image::{
    imageops::{crop_imm, overlay},
    RgbaImage,
};
use serde::Deserialize;

use super::{
    draw::{parse_hex_color, render_box, render_text},
    effects::{apply_effect_region, EffectKind},
    error::ImageProcessingError,
    processor_trait::ImageProcessor,
};

/// An overlay rect in absolute capture coordinates; can hang off any edge.
#[derive(Debug, Deserialize, Clone)]
pub struct PlacedRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// What the frontend sends per overlay , descriptors only, in stacking order.
/// Each is composited onto the current image state, so effects apply to the
/// overlays beneath them, and the crop to the selection happens afterwards.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum OverlayInstruction {
    #[serde(rename_all = "camelCase")]
    Box {
        dims: PlacedRect,
        color: String,
        border_color: String,
        border_thickness: u32,
    },
    Text {
        dims: PlacedRect,
        text: String,
        color: String,
        size: f32,
        font: String,
    },
    Blur { dims: PlacedRect, intensity: u32 },
    Pixelate { dims: PlacedRect, intensity: u32 },
}

impl OverlayInstruction {
    /// How far outside its own rect this instruction samples the image.
    pub fn sampling_margin(&self) -> i64 {
        match self {
            Self::Blur { intensity, .. } => {
                intensity.saturating_mul(3).saturating_add(2) as i64
            }
            Self::Pixelate { intensity, .. } => (*intensity).max(1) as i64,
            Self::Box { .. } | Self::Text { .. } => 0,
        }
    }
}

/// Composites one instruction onto `image`, whose top-left sits at
/// (`origin_x`, `origin_y`) in absolute capture coordinates.
pub fn apply_overlay(
    image: &mut RgbaImage,
    instruction: &OverlayInstruction,
    origin_x: i64,
    origin_y: i64,
) {
    match instruction {
        OverlayInstruction::Box {
            dims,
            color,
            border_color,
            border_thickness,
        } => {
            let (Some(fill), Some(border)) = (parse_hex_color(color), parse_hex_color(border_color))
            else {
                return;
            };

            let patch = render_box(dims.width, dims.height, fill, border, *border_thickness);
            overlay(
                image,
                &patch,
                dims.x as i64 - origin_x,
                dims.y as i64 - origin_y,
            );
        }
        OverlayInstruction::Text {
            dims,
            text,
            color,
            size,
            font,
        } => {
            let Some(color) = parse_hex_color(color) else {
                return;
            };

            let Some(patch) = render_text(dims.width, dims.height, text, color, *size, font)
            else {
                return;
            };

            overlay(
                image,
                &patch,
                dims.x as i64 - origin_x,
                dims.y as i64 - origin_y,
            );
        }
        OverlayInstruction::Blur { dims, intensity } => apply_effect_region(
            image,
            EffectKind::Blur,
            *intensity,
            dims.x as i64,
            dims.y as i64,
            dims.width,
            dims.height,
            origin_x,
            origin_y,
        ),
        OverlayInstruction::Pixelate { dims, intensity } => apply_effect_region(
            image,
            EffectKind::Pixelate,
            *intensity,
            dims.x as i64,
            dims.y as i64,
            dims.width,
            dims.height,
            origin_x,
            origin_y,
        ),
    }
}

impl ImageProcessor for OverlayInstruction {
    fn process(&self, image: RgbaImage) -> Result<RgbaImage, ImageProcessingError> {
        let mut image = image;
        apply_overlay(&mut image, self, 0, 0);
        Ok(image)
    }
}

/// Renders a rectangular window of `source` with `instructions` composited in
/// stacking order, exactly as the save path would. Samples an expanded
/// surrounding area so effect margins match a full-capture composite.
pub fn composite_region(
    source: &RgbaImage,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    instructions: &[OverlayInstruction],
) -> Option<RgbaImage> {
    let right = x.saturating_add(width).min(source.width());
    let bottom = y.saturating_add(height).min(source.height());

    if x >= right || y >= bottom {
        return None;
    }

    let margin: i64 = instructions
        .iter()
        .map(OverlayInstruction::sampling_margin)
        .sum();
    let expanded_left = (x as i64 - margin).max(0) as u32;
    let expanded_top = (y as i64 - margin).max(0) as u32;
    let expanded_right = (right as i64 + margin).min(source.width() as i64) as u32;
    let expanded_bottom = (bottom as i64 + margin).min(source.height() as i64) as u32;

    let mut work = crop_imm(
        source,
        expanded_left,
        expanded_top,
        expanded_right - expanded_left,
        expanded_bottom - expanded_top,
    )
    .to_image();

    for instruction in instructions {
        apply_overlay(&mut work, instruction, expanded_left as i64, expanded_top as i64);
    }

    Some(
        crop_imm(
            &work,
            x - expanded_left,
            y - expanded_top,
            right - x,
            bottom - y,
        )
        .to_image(),
    )
}
