use std::{
    collections::HashMap,
    error::Error,
    fmt::Display,
    io::Cursor,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::{DateTime, Utc};
use image::{DynamicImage, ImageError, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize, Serializer};

use super::window::WindowInfo;

/// Holds the in-memory captures being edited in the overlay. Saved history now
/// lives in `HistoryStore` (SQLite); this only tracks transient temp images.
#[derive(Debug, Default)]
pub struct ScreenshotManager {
    images: HashMap<u16, TemporaryImage>,
}

impl ScreenshotManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_screenshot(
        &mut self,
        image: RgbaImage,
        windows: Option<Vec<WindowInfo>>,
    ) -> Result<u16, EncodeError> {
        let webp_review = encode_image_as(&image, ImageFormat::WebP)?;

        let id = loop {
            let id = rand::random::<u16>();

            if !self.images.contains_key(&id) {
                break id;
            }
        };

        self.images.insert(
            id,
            TemporaryImage {
                webp_review,
                rgba_data: image,
                image_windows: windows,
            },
        );

        Ok(id)
    }

    pub fn get_screenshot_windows(&self, id: &u16) -> Option<&Vec<WindowInfo>> {
        self.images
            .get(id)
            .and_then(|img| img.image_windows.as_ref())
    }

    /// Removes image and returns it if it exists
    pub fn remove_image(&mut self, id: &u16) -> Option<TemporaryImage> {
        self.images.remove(id)
    }

    pub fn clear_temp_images(&mut self) {
        self.images.clear();
    }

    pub fn encode_as(&self, id: &u16, format: ImageFormat) -> Result<Vec<u8>, EncodeError> {
        let image = self.images.get(id);

        match image {
            Some(image) => encode_image_as(&image.rgba_data, format),
            None => Err(EncodeError::NotExists),
        }
    }

    pub fn get_temp_image(&self, id: &u16) -> Option<&TemporaryImage> {
        self.images.get(id)
    }

    /// True while a temp capture with this id is still being edited , used by the
    /// save flow to confirm the capture wasn't cancelled before persisting it.
    pub fn contains(&self, id: &u16) -> bool {
        self.images.contains_key(id)
    }
}

pub fn encode_image_as(image: &RgbaImage, format: ImageFormat) -> Result<Vec<u8>, EncodeError> {
    let mut bytes: Cursor<Vec<u8>> = Cursor::new(Vec::new());

    // A few encoders reject Rgba8 outright (no alpha support, or a different
    // bit depth entirely), so convert to whatever color type they actually accept.
    match format {
        ImageFormat::Jpeg => DynamicImage::ImageRgba8(image.clone()).to_rgb8().write_to(&mut bytes, format)?,
        ImageFormat::Hdr => DynamicImage::ImageRgba8(image.clone()).to_rgb32f().write_to(&mut bytes, format)?,
        ImageFormat::OpenExr => DynamicImage::ImageRgba8(image.clone()).to_rgba32f().write_to(&mut bytes, format)?,
        ImageFormat::Farbfeld => DynamicImage::ImageRgba8(image.clone()).to_rgba16().write_to(&mut bytes, format)?,
        _ => image.write_to(&mut bytes, format)?,
    }

    Ok(bytes.into_inner())
}

/// Format a saved screenshot is encoded as, user-selectable in settings , every
/// format the `image` crate can actually encode under this project's enabled
/// features (`Dds` and the deprecated `Pcx` are decode-only/unimplemented and
/// excluded; see `image::io::free_functions::write_buffer_with_format`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ScreenshotImageFormat {
    Png,
    #[default]
    Webp,
    Jpeg,
    Gif,
    Bmp,
    Ico,
    Tiff,
    Tga,
    Pnm,
    Avif,
    Qoi,
    Hdr,
    OpenExr,
    Farbfeld,
}

impl ScreenshotImageFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Webp => "webp",
            Self::Jpeg => "jpg",
            Self::Gif => "gif",
            Self::Bmp => "bmp",
            Self::Ico => "ico",
            Self::Tiff => "tiff",
            Self::Tga => "tga",
            Self::Pnm => "ppm",
            Self::Avif => "avif",
            Self::Qoi => "qoi",
            Self::Hdr => "hdr",
            Self::OpenExr => "exr",
            Self::Farbfeld => "ff",
        }
    }

    pub fn as_image_format(self) -> ImageFormat {
        match self {
            Self::Png => ImageFormat::Png,
            Self::Webp => ImageFormat::WebP,
            Self::Jpeg => ImageFormat::Jpeg,
            Self::Gif => ImageFormat::Gif,
            Self::Bmp => ImageFormat::Bmp,
            Self::Ico => ImageFormat::Ico,
            Self::Tiff => ImageFormat::Tiff,
            Self::Tga => ImageFormat::Tga,
            Self::Pnm => ImageFormat::Pnm,
            Self::Avif => ImageFormat::Avif,
            Self::Qoi => ImageFormat::Qoi,
            Self::Hdr => ImageFormat::Hdr,
            Self::OpenExr => ImageFormat::OpenExr,
            Self::Farbfeld => ImageFormat::Farbfeld,
        }
    }
}

#[derive(Debug)]
pub struct TemporaryImage {
    pub rgba_data: RgbaImage,
    pub webp_review: Vec<u8>,
    pub image_windows: Option<Vec<WindowInfo>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum HistoryItemType {
    #[default]
    Image,
    Video,
    File,
}

impl HistoryItemType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
            Self::File => "file",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "video" => Self::Video,
            "file" => Self::File,
            _ => Self::Image,
        }
    }

    /// Classifies a file extension into a supported media type. `None` = neither
    /// image nor video (a generic `file` when imported, skipped when migrating).
    pub fn from_extension(ext: &str) -> Option<Self> {
        const IMAGE: &[&str] = &[
            "png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "apng", "avif", "svg", "ico",
            "tiff", "tif", "heic", "heif", "jxl", "tga", "ff", "exr", "hdr", "qoi", "pnm", "ppm",
            "pgm", "pbm",
        ];
        const VIDEO: &[&str] = &[
            "mp4", "m4v", "webm", "mov", "mkv", "avi", "wmv", "flv", "mpeg", "mpg", "m2ts", "ts",
            "ogv", "3gp", "3g2",
        ];
        let ext = ext.to_ascii_lowercase();
        if IMAGE.contains(&ext.as_str()) {
            Some(Self::Image)
        } else if VIDEO.contains(&ext.as_str()) {
            Some(Self::Video)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageHistoryData {
    pub file_name: String,
    pub file_path: PathBuf,
    #[serde(rename = "type")]
    pub item_type: HistoryItemType,
    pub date_time: DateTime<Utc>,
    pub tags: Option<HashMap<String, TagValue>>,
    /// Size on disk, stat'ed at query time (not stored) , the frontend uses it
    /// to decide whether a video may load without a thumbnail.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deletion_url: Option<String>,
    /// Set when the most recent upload attempt failed; cleared on success.
    /// Holds the serialized `UploaderError` so the frontend can format it with
    /// the same `describeUploaderError` used for interactive upload errors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload_error: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub enum EncodeError {
    NotExists,
    #[serde(serialize_with = "deserialize_image_error_string")]
    EncodeError(ImageError),
    #[serde(serialize_with = "serialize_io_error_string")]
    IoError(std::io::Error),
}

impl From<ImageError> for EncodeError {
    fn from(value: ImageError) -> Self {
        Self::EncodeError(value)
    }
}

impl Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotExists => f.write_str("EncodeError::NotExists Image did not exist in map"),
            Self::EncodeError(err) => err.fmt(f),
            Self::IoError(err) => err.fmt(f),
        }
    }
}

impl Error for EncodeError {}

fn deserialize_image_error_string<S>(v: &ImageError, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(&v.to_string())
}

fn serialize_io_error_string<S>(v: &std::io::Error, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(&v.to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(untagged)]
pub enum TagValue {
    Int(i128),
    Uint(u128),
    Float(f64),
    String(String),
    Bool(bool),
    Map(HashMap<String, TagValue>),
    IntArray(Vec<i128>),
    UintArray(Vec<u128>),
    FloatArray(Vec<f64>),
    StringArray(Vec<String>),
    BoolArray(Vec<bool>),
    MapArray(Vec<HashMap<String, TagValue>>),
    #[default]
    Null,
}

/// Marker keys for the `Time`/`DateTime` filter field types (`history_store::filter`):
/// a tag value wrapped as a single-key map under one of these is filterable in the UI
/// with a duration/date-time picker instead of a raw millisecond number.
pub const TIME_TAG_KEY: &str = "$time";
pub const DATE_TIME_TAG_KEY: &str = "$dateTime";

/// Current time in milliseconds since the Unix epoch (0 if the clock is set
/// before it, which can't happen on a real machine).
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

impl TagValue {
    /// A duration, stored in milliseconds; filterable in the UI as `Time`.
    pub fn time_millis(ms: u64) -> Self {
        TagValue::Map(HashMap::from([(TIME_TAG_KEY.to_string(), TagValue::Uint(ms as u128))]))
    }

    /// A point in time, stored as milliseconds since the Unix epoch; filterable in the UI as `DateTime`.
    pub fn date_time_millis(ms: u64) -> Self {
        TagValue::Map(HashMap::from([(DATE_TIME_TAG_KEY.to_string(), TagValue::Uint(ms as u128))]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screenshot_image_format_serializes_camel_case() {
        let cases = [
            (ScreenshotImageFormat::Png, "png"),
            (ScreenshotImageFormat::Webp, "webp"),
            (ScreenshotImageFormat::Jpeg, "jpeg"),
            (ScreenshotImageFormat::Gif, "gif"),
            (ScreenshotImageFormat::Bmp, "bmp"),
            (ScreenshotImageFormat::Ico, "ico"),
            (ScreenshotImageFormat::Tiff, "tiff"),
            (ScreenshotImageFormat::Tga, "tga"),
            (ScreenshotImageFormat::Pnm, "pnm"),
            (ScreenshotImageFormat::Avif, "avif"),
            (ScreenshotImageFormat::Qoi, "qoi"),
            (ScreenshotImageFormat::Hdr, "hdr"),
            (ScreenshotImageFormat::OpenExr, "openExr"),
            (ScreenshotImageFormat::Farbfeld, "farbfeld"),
        ];
        for (format, expected) in cases {
            assert_eq!(serde_json::to_string(&format).unwrap(), format!("\"{expected}\""));
        }
        assert_eq!(ScreenshotImageFormat::default(), ScreenshotImageFormat::Webp);
    }

    #[test]
    fn every_screenshot_format_actually_encodes() {
        let image = RgbaImage::new(4, 4);
        let failures: Vec<String> = [
            ScreenshotImageFormat::Png,
            ScreenshotImageFormat::Webp,
            ScreenshotImageFormat::Jpeg,
            ScreenshotImageFormat::Gif,
            ScreenshotImageFormat::Bmp,
            ScreenshotImageFormat::Ico,
            ScreenshotImageFormat::Tiff,
            ScreenshotImageFormat::Tga,
            ScreenshotImageFormat::Pnm,
            ScreenshotImageFormat::Avif,
            ScreenshotImageFormat::Qoi,
            ScreenshotImageFormat::Hdr,
            ScreenshotImageFormat::OpenExr,
            ScreenshotImageFormat::Farbfeld,
        ]
        .into_iter()
        .filter_map(|format| encode_image_as(&image, format.as_image_format()).err().map(|err| format!("{format:?}: {err}")))
        .collect();

        assert!(failures.is_empty(), "formats failed to encode:\n{}", failures.join("\n"));
    }
}
