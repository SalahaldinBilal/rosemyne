use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex},
};

use ab_glyph::{Font, FontVec, GlyphId, PxScale, ScaleFont, point};
use image::{Rgba, RgbaImage};

static FONT_DB: LazyLock<fontdb::Database> = LazyLock::new(|| {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    db
});

static FONT_CACHE: LazyLock<Mutex<HashMap<String, Option<Arc<FontVec>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Scanning system fonts takes long enough to be felt, so do it at startup
/// instead of on the first text render.
pub fn warm_up() {
    std::thread::spawn(|| {
        for family in ["serif", "sans-serif", "monospace", "cursive"] {
            let _ = font_for_family(family);
        }
    });
}

/// Resolves a CSS-style family name (generic or concrete) to a loaded font,
/// falling back to sans-serif, and caches the result per family string.
pub fn font_for_family(family: &str) -> Option<Arc<FontVec>> {
    let mut cache = FONT_CACHE.lock().ok()?;

    if let Some(cached) = cache.get(family) {
        return cached.clone();
    }

    let queried_family = match family {
        "serif" => fontdb::Family::Serif,
        "sans-serif" => fontdb::Family::SansSerif,
        "monospace" => fontdb::Family::Monospace,
        "cursive" => fontdb::Family::Cursive,
        "fantasy" => fontdb::Family::Fantasy,
        name => fontdb::Family::Name(name),
    };

    let query = fontdb::Query {
        families: &[queried_family, fontdb::Family::SansSerif],
        weight: fontdb::Weight::NORMAL,
        stretch: fontdb::Stretch::Normal,
        style: fontdb::Style::Normal,
    };

    let loaded = FONT_DB
        .query(&query)
        .and_then(|id| {
            FONT_DB
                .with_face_data(id, |data, index| {
                    FontVec::try_from_vec_and_index(data.to_vec(), index).ok()
                })
                .flatten()
        })
        .map(Arc::new);

    if loaded.is_none() {
        eprintln!("Failed to resolve any font for family {:?}", family);
    }

    cache.insert(family.to_string(), loaded.clone());

    loaded
}

pub fn parse_hex_color(hex: &str) -> Option<Rgba<u8>> {
    let hex = hex.trim_start_matches('#');

    if !hex.is_ascii() {
        return None;
    }

    let nibble = |index: usize| u8::from_str_radix(&hex[index..index + 1], 16).map(|n| n * 17);
    let pair = |index: usize| u8::from_str_radix(&hex[index..index + 2], 16);

    match hex.len() {
        3 => Some(Rgba([
            nibble(0).ok()?,
            nibble(1).ok()?,
            nibble(2).ok()?,
            255,
        ])),
        4 => Some(Rgba([
            nibble(0).ok()?,
            nibble(1).ok()?,
            nibble(2).ok()?,
            nibble(3).ok()?,
        ])),
        6 => Some(Rgba([pair(0).ok()?, pair(2).ok()?, pair(4).ok()?, 255])),
        8 => Some(Rgba([
            pair(0).ok()?,
            pair(2).ok()?,
            pair(4).ok()?,
            pair(6).ok()?,
        ])),
        _ => None,
    }
}

/// Fill covers the whole rect, the border ring is composited on top of it ,
/// same painting order as a CSS background + border.
pub fn render_box(
    width: u32,
    height: u32,
    fill: Rgba<u8>,
    border: Rgba<u8>,
    thickness: u32,
) -> RgbaImage {
    let border_over_fill = blend_over(border, fill);

    RgbaImage::from_fn(width, height, |x, y| {
        let in_border = x < thickness
            || y < thickness
            || x >= width.saturating_sub(thickness)
            || y >= height.saturating_sub(thickness);

        if in_border { border_over_fill } else { fill }
    })
}

/// Word-wrapped text on a transparent patch, mirroring the old canvas
/// behavior: greedy wrap on whitespace, 1.2em line height, top-aligned.
pub fn render_text(
    width: u32,
    height: u32,
    text: &str,
    color: Rgba<u8>,
    size: f32,
    family: &str,
) -> Option<RgbaImage> {
    if width == 0 || height == 0 {
        return None;
    }

    let mut image = RgbaImage::new(width, height);

    if size <= 0.0 || !size.is_finite() {
        return Some(image);
    }

    let font = font_for_family(family)?;
    let scale = PxScale::from(size);
    let scaled = font.as_scaled(scale);

    let measure = |line: &str| -> f32 {
        let mut line_width = 0.0;
        let mut previous: Option<GlyphId> = None;

        for character in line.chars() {
            let glyph_id = scaled.glyph_id(character);

            if let Some(previous) = previous {
                line_width += scaled.kern(previous, glyph_id);
            }

            line_width += scaled.h_advance(glyph_id);
            previous = Some(glyph_id);
        }

        line_width
    };

    let mut lines: Vec<String> = vec![];

    for paragraph in text.split('\n') {
        let mut current = String::new();

        for word in paragraph.split_whitespace() {
            let candidate = if current.is_empty() {
                word.to_string()
            } else {
                format!("{current} {word}")
            };

            if !current.is_empty() && measure(&candidate) > width as f32 {
                lines.push(current);
                current = word.to_string();
            } else {
                current = candidate;
            }
        }

        lines.push(current);
    }

    let line_height = size * 1.2;
    let Rgba([red, green, blue, alpha]) = color;

    for (line_index, line) in lines.iter().enumerate() {
        let line_top = line_index as f32 * line_height;

        if line_top >= height as f32 {
            break;
        }

        let baseline = line_top + scaled.ascent();
        let mut caret = 0.0f32;
        let mut previous: Option<GlyphId> = None;

        for character in line.chars() {
            let glyph_id = scaled.glyph_id(character);

            if let Some(previous) = previous {
                caret += scaled.kern(previous, glyph_id);
            }

            let glyph = glyph_id.with_scale_and_position(scale, point(caret, baseline));
            caret += scaled.h_advance(glyph_id);
            previous = Some(glyph_id);

            if let Some(outlined) = font.outline_glyph(glyph) {
                let bounds = outlined.px_bounds();

                outlined.draw(|x, y, coverage| {
                    let pixel_x = bounds.min.x as i32 + x as i32;
                    let pixel_y = bounds.min.y as i32 + y as i32;

                    if pixel_x < 0
                        || pixel_y < 0
                        || pixel_x >= width as i32
                        || pixel_y >= height as i32
                    {
                        return;
                    }

                    let coverage_alpha = (coverage.clamp(0.0, 1.0) * alpha as f32).round() as u8;
                    let pixel = image.get_pixel_mut(pixel_x as u32, pixel_y as u32);

                    if coverage_alpha > pixel.0[3] {
                        *pixel = Rgba([red, green, blue, coverage_alpha]);
                    }
                });
            }
        }
    }

    Some(image)
}

fn blend_over(top: Rgba<u8>, bottom: Rgba<u8>) -> Rgba<u8> {
    let top_alpha = top.0[3] as f32 / 255.0;
    let bottom_alpha = bottom.0[3] as f32 / 255.0;
    let out_alpha = top_alpha + bottom_alpha * (1.0 - top_alpha);

    if out_alpha == 0.0 {
        return Rgba([0, 0, 0, 0]);
    }

    let channel = |top_channel: u8, bottom_channel: u8| {
        ((top_channel as f32 * top_alpha + bottom_channel as f32 * bottom_alpha * (1.0 - top_alpha))
            / out_alpha)
            .round() as u8
    };

    Rgba([
        channel(top.0[0], bottom.0[0]),
        channel(top.0[1], bottom.0[1]),
        channel(top.0[2], bottom.0[2]),
        (out_alpha * 255.0).round() as u8,
    ])
}
