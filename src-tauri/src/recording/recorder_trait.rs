use std::path::PathBuf;

use image::RgbaImage;
use serde::{Deserialize, Serialize};

use crate::screen_manager::window::WindowBounds;

use super::error::RecordingError;

/// Video codec requested for a recording. Not every codec is necessarily
/// available on the running hardware/drivers , see `ScreenRecorder::available_codecs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum VideoCodec {
    #[default]
    H264,
    H265,
}

#[derive(Debug, Clone)]
pub struct RecordingOptions {
    /// Requested capture rect in virtual-desktop physical pixels. The platform
    /// implementation clamps it to the monitor under its center and
    /// even-aligns the dimensions (H.264 requirement).
    pub region: WindowBounds,
    pub fps: u32,
    pub capture_audio: bool,
    pub codec: VideoCodec,
    pub output_path: PathBuf,
}

pub struct RecordingResult {
    /// First captured frame, for the history thumbnail.
    pub thumbnail: Option<RgbaImage>,
}

pub trait ScreenRecorder: Sized + Send {
    fn start(options: RecordingOptions) -> Result<Self, RecordingError>;
    /// Finalizes the container so `output_path` is a playable file.
    fn stop(self) -> Result<RecordingResult, RecordingError>;
    /// Finalizes then deletes the output file.
    fn cancel(self) -> Result<(), RecordingError>;
    /// Whether an audio track is actually being recorded (system audio capture
    /// can be unavailable even when requested).
    fn with_audio(&self) -> bool;
    /// The encoded video dimensions after clamping/alignment.
    fn dimensions(&self) -> (u32, u32);
    /// Video codecs this platform's encoder can actually initialize, probed
    /// against the running hardware/drivers rather than just OS/crate support.
    fn available_codecs() -> Vec<VideoCodec>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_codec_serializes_camel_case() {
        assert_eq!(serde_json::to_string(&VideoCodec::H264).unwrap(), "\"h264\"");
        assert_eq!(serde_json::to_string(&VideoCodec::H265).unwrap(), "\"h265\"");
        assert_eq!(VideoCodec::default(), VideoCodec::H264);
    }
}
