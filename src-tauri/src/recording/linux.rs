use super::error::RecordingError;
use super::recorder_trait::{RecordingOptions, RecordingResult, ScreenRecorder, VideoCodec};

pub struct LinuxRecorder;

impl ScreenRecorder for LinuxRecorder {
    fn start(_options: RecordingOptions) -> Result<Self, RecordingError> {
        Err(RecordingError::Unsupported(
            "Linux screen recording is not implemented yet",
        ))
    }

    fn stop(self) -> Result<RecordingResult, RecordingError> {
        Err(RecordingError::NotRecording)
    }

    fn cancel(self) -> Result<(), RecordingError> {
        Err(RecordingError::NotRecording)
    }

    fn with_audio(&self) -> bool {
        false
    }

    fn dimensions(&self) -> (u32, u32) {
        (0, 0)
    }

    fn available_codecs() -> Vec<VideoCodec> {
        Vec::new()
    }
}
