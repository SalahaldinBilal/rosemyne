use image::{
    imageops::{crop_imm, replace},
    Rgba, RgbaImage,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectKind {
    Blur,
    Pixelate,
}

pub fn apply_effect(image: &RgbaImage, kind: EffectKind, intensity: u32) -> RgbaImage {
    match kind {
        EffectKind::Blur if intensity == 0 => image.clone(),
        EffectKind::Blur => image::imageops::fast_blur(image, intensity as f32),
        EffectKind::Pixelate => pixelate(image, intensity),
    }
}

/// Applies the effect to a region of `image` in place, as if the effect ran
/// over the full capture. All coordinates are absolute capture coordinates;
/// `origin` is where `image`'s top-left sits in that space, so the pixelate
/// grid and blur sampling stay identical between the save path (whole
/// capture, origin 0) and preview patches (cropped work area).
pub fn apply_effect_region(
    image: &mut RgbaImage,
    kind: EffectKind,
    intensity: u32,
    region_x: i64,
    region_y: i64,
    region_width: u32,
    region_height: u32,
    origin_x: i64,
    origin_y: i64,
) {
    let image_right = origin_x + image.width() as i64;
    let image_bottom = origin_y + image.height() as i64;

    let left = region_x.max(origin_x);
    let top = region_y.max(origin_y);
    let right = (region_x + region_width as i64).min(image_right);
    let bottom = (region_y + region_height as i64).min(image_bottom);

    if left >= right || top >= bottom {
        return;
    }

    let (expanded_left, expanded_top, expanded_right, expanded_bottom) = match kind {
        // fast_blur is three box passes with a combined support just under
        // 3 * sigma, so this margin makes the patch match a full-image blur.
        EffectKind::Blur => {
            let margin = intensity.saturating_mul(3).saturating_add(2) as i64;
            (left - margin, top - margin, right + margin, bottom + margin)
        }
        // Expand to block boundaries of the absolute grid so the pattern
        // doesn't shift with the sampled window. Coordinates are non-negative
        // here, so plain division floors and this ceils.
        EffectKind::Pixelate => {
            let block = intensity.max(1) as i64;
            (
                (left / block) * block,
                (top / block) * block,
                ((right + block - 1) / block) * block,
                ((bottom + block - 1) / block) * block,
            )
        }
    };

    let expanded_left = expanded_left.max(origin_x);
    let expanded_top = expanded_top.max(origin_y);
    let expanded_right = expanded_right.min(image_right);
    let expanded_bottom = expanded_bottom.min(image_bottom);

    let sampled = crop_imm(
        image,
        (expanded_left - origin_x) as u32,
        (expanded_top - origin_y) as u32,
        (expanded_right - expanded_left) as u32,
        (expanded_bottom - expanded_top) as u32,
    )
    .to_image();

    let processed = apply_effect(&sampled, kind, intensity);

    let patch = crop_imm(
        &processed,
        (left - expanded_left) as u32,
        (top - expanded_top) as u32,
        (right - left) as u32,
        (bottom - top) as u32,
    )
    .to_image();

    replace(image, &patch, left - origin_x, top - origin_y);
}

fn pixelate(image: &RgbaImage, block_size: u32) -> RgbaImage {
    if block_size <= 1 {
        return image.clone();
    }

    let (width, height) = image.dimensions();
    let mut output = RgbaImage::new(width, height);

    for block_y in (0..height).step_by(block_size as usize) {
        let block_height = block_size.min(height - block_y);

        for block_x in (0..width).step_by(block_size as usize) {
            let block_width = block_size.min(width - block_x);
            let mut sums = [0u64; 4];

            for y in block_y..block_y + block_height {
                for x in block_x..block_x + block_width {
                    let pixel = image.get_pixel(x, y);

                    for channel in 0..4 {
                        sums[channel] += pixel.0[channel] as u64;
                    }
                }
            }

            let count = (block_width * block_height) as u64;
            let average = Rgba(sums.map(|sum| (sum / count) as u8));

            for y in block_y..block_y + block_height {
                for x in block_x..block_x + block_width {
                    output.put_pixel(x, y, average);
                }
            }
        }
    }

    output
}
