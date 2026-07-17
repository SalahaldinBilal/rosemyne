use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use image::RgbaImage;
use windows::Win32::Foundation::POINT;
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromPoint,
};
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::encoder::{
    AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder,
    VideoSettingsSubType,
};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl};
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};

use crate::screen_manager::window::WindowBounds;

use super::audio::{LoopbackCapture, begin, probe_format};
use super::error::RecordingError;
use super::recorder_trait::{RecordingOptions, RecordingResult, ScreenRecorder, VideoCodec};

type SharedEncoder = Arc<Mutex<Option<VideoEncoder>>>;
type HandlerError = Box<dyn std::error::Error + Send + Sync>;

const TICKS_PER_SECOND: i64 = 10_000_000;

// Frame size used to probe codec availability: comfortably above the small-
// selection failure threshold observed for both H.264 and HEVC on this
// machine, so a probe failure reflects the codec itself, not the frame size.
const CODEC_PROBE_DIM: u32 = 512;

fn sub_type_for(codec: VideoCodec) -> VideoSettingsSubType {
    match codec {
        VideoCodec::H264 => VideoSettingsSubType::H264,
        VideoCodec::H265 => VideoSettingsSubType::HEVC,
    }
}

pub struct WindowsRecorder {
    control: CaptureControl<CaptureHandler, HandlerError>,
    encoder: SharedEncoder,
    audio: Option<LoopbackCapture>,
    thumbnail_rx: mpsc::Receiver<RgbaImage>,
    output_path: PathBuf,
    width: u32,
    height: u32,
}

impl ScreenRecorder for WindowsRecorder {
    fn start(options: RecordingOptions) -> Result<Self, RecordingError> {
        if !GraphicsCaptureApi::is_supported().unwrap_or(false) {
            return Err(RecordingError::Unsupported(
                "Windows Graphics Capture requires Windows 10 1903 or newer",
            ));
        }

        let (monitor, monitor_bounds) = monitor_under(&options.region)?;
        let crop = crop_within_monitor(&options.region, &monitor_bounds)?;
        let width = crop.2 - crop.0;
        let height = crop.3 - crop.1;

        // The encoder slot starts empty: the audio callback holds a handle
        // before the encoder exists and simply drops samples until it lands.
        let encoder_slot: SharedEncoder = Arc::new(Mutex::new(None));

        // Probe is fast; the actual stream startup runs on the audio thread
        // concurrently with the (dominant) encoder creation below.
        let mut audio_pending = if options.capture_audio {
            match probe_format() {
                Ok(format) => {
                    let audio_encoder = encoder_slot.clone();
                    Some(begin(
                        move |bytes| {
                            let mut guard =
                                audio_encoder.lock().expect("encoder lock not poisoned");
                            if let Some(encoder) = guard.as_mut() {
                                if let Err(err) = encoder.send_audio_buffer(bytes, 0) {
                                    eprintln!("Failed to feed audio into the encoder: {}", err);
                                }
                            }
                        },
                        format,
                    ))
                }
                Err(err) => {
                    eprintln!("Recording without audio: {}", err);
                    None
                }
            }
        } else {
            None
        };

        let video_settings = || {
            VideoSettingsBuilder::new(width, height)
                .sub_type(sub_type_for(options.codec))
                .frame_rate(options.fps)
                .bitrate(bitrate_for(width, height, options.fps))
        };
        let audio_settings = match &audio_pending {
            Some(pending) => AudioSettingsBuilder::new()
                .sample_rate(pending.format.sample_rate)
                .channel_count(u32::from(pending.format.channels)),
            None => AudioSettingsBuilder::new().disabled(true),
        };

        let encoder = match VideoEncoder::new(
            video_settings(),
            audio_settings,
            ContainerSettingsBuilder::new(),
            &options.output_path,
        ) {
            Ok(encoder) => encoder,
            Err(err) => {
                if let Some(mut pending) = audio_pending {
                    pending.abort();
                }
                return Err(RecordingError::Failed(format!(
                    "Failed to create the video encoder: {}",
                    err
                )));
            }
        };

        let had_pending_audio = audio_pending.is_some();
        let audio = match audio_pending.take() {
            Some(pending) => match pending.wait_ready(std::time::Duration::from_secs(3)) {
                Ok(capture) => Some(capture),
                Err(err) => {
                    eprintln!("Recording without audio: {}", err);
                    None
                }
            },
            None => None,
        };

        // The encoder above expects an audio track; leaving it starving would
        // stall the muxer, so on audio failure rebuild it audio-less (rare ,
        // File::create inside truncates the first attempt's output).
        let encoder = if had_pending_audio && audio.is_none() {
            drop(encoder);
            VideoEncoder::new(
                video_settings(),
                AudioSettingsBuilder::new().disabled(true),
                ContainerSettingsBuilder::new(),
                &options.output_path,
            )
            .map_err(|err| {
                RecordingError::Failed(format!("Failed to create the video encoder: {}", err))
            })?
        } else {
            encoder
        };

        *encoder_slot.lock().expect("encoder lock not poisoned") = Some(encoder);

        let (thumbnail_tx, thumbnail_rx) = mpsc::channel();

        let monitor_size = (
            (monitor_bounds.right - monitor_bounds.left) as u32,
            (monitor_bounds.bottom - monitor_bounds.top) as u32,
        );
        let full_monitor = crop == (0, 0, monitor_size.0, monitor_size.1);

        let settings = Settings::new(
            monitor,
            cursor_settings(),
            border_settings(),
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Default,
            DirtyRegionSettings::Default,
            ColorFormat::Bgra8,
            CaptureFlags {
                encoder: encoder_slot.clone(),
                crop: (!full_monitor).then_some(crop),
                thumbnail_tx,
                frame_interval: TICKS_PER_SECOND / i64::from(options.fps.max(1)),
            },
        );

        let control = CaptureHandler::start_free_threaded(settings).map_err(|err| {
            encoder_slot
                .lock()
                .expect("encoder lock not poisoned")
                .take();
            RecordingError::Failed(format!("Failed to start the screen capture: {}", err))
        })?;

        Ok(Self {
            control,
            encoder: encoder_slot,
            audio,
            thumbnail_rx,
            output_path: options.output_path,
            width,
            height,
        })
    }

    fn stop(self) -> Result<RecordingResult, RecordingError> {
        let thumbnail = self.shutdown()?;
        Ok(RecordingResult { thumbnail })
    }

    fn cancel(self) -> Result<(), RecordingError> {
        let path = self.output_path.clone();
        let result = self.shutdown();
        if let Err(err) = std::fs::remove_file(&path) {
            if err.kind() != std::io::ErrorKind::NotFound {
                eprintln!("Failed to delete the cancelled recording: {}", err);
            }
        }
        result.map(|_| ())
    }

    fn with_audio(&self) -> bool {
        self.audio.is_some()
    }

    fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// Probes each codec by actually creating (and immediately dropping) an
    /// encoder for it , the only reliable way to know whether the running
    /// hardware/drivers support it, since Media Foundation doesn't expose
    /// that up front.
    fn available_codecs() -> Vec<VideoCodec> {
        if !GraphicsCaptureApi::is_supported().unwrap_or(false) {
            return Vec::new();
        }

        let probe_path = std::env::temp_dir().join(format!(".rosemyne-codec-probe-{}.mp4", rand::random::<u32>()));
        let available: Vec<VideoCodec> = [VideoCodec::H264, VideoCodec::H265]
            .into_iter()
            .filter(|codec| {
                VideoEncoder::new(
                    VideoSettingsBuilder::new(CODEC_PROBE_DIM, CODEC_PROBE_DIM)
                        .sub_type(sub_type_for(*codec))
                        .frame_rate(30)
                        .bitrate(bitrate_for(CODEC_PROBE_DIM, CODEC_PROBE_DIM, 30)),
                    AudioSettingsBuilder::new().disabled(true),
                    ContainerSettingsBuilder::new(),
                    &probe_path,
                )
                .is_ok()
            })
            .collect();

        let _ = std::fs::remove_file(&probe_path);
        available
    }
}

impl WindowsRecorder {
    /// Stop order matters: audio first (so no samples land after the encoder
    /// is taken), then the capture thread, then finalize the container.
    fn shutdown(self) -> Result<Option<RgbaImage>, RecordingError> {
        if let Some(audio) = self.audio {
            audio.stop();
        }

        let capture_result = self.control.stop();

        let encoder = self
            .encoder
            .lock()
            .expect("encoder lock not poisoned")
            .take();
        let finish_result = match encoder {
            Some(encoder) => encoder.finish().map_err(|err| {
                RecordingError::Failed(format!("Failed to finalize the recording: {}", err))
            }),
            None => Ok(()),
        };

        capture_result
            .map_err(|err| RecordingError::Failed(format!("The screen capture failed: {}", err)))?;
        finish_result?;

        Ok(self.thumbnail_rx.try_recv().ok())
    }
}

struct CaptureFlags {
    encoder: SharedEncoder,
    /// (start_x, start_y, end_x, end_y) within the monitor frame; None = full monitor.
    crop: Option<(u32, u32, u32, u32)>,
    thumbnail_tx: mpsc::Sender<RgbaImage>,
    frame_interval: i64,
}

struct CaptureHandler {
    encoder: SharedEncoder,
    crop: Option<(u32, u32, u32, u32)>,
    thumbnail_tx: Option<mpsc::Sender<RgbaImage>>,
    frame_interval: i64,
    next_frame_due: i64,
    flipped: Vec<u8>,
    scratch: Vec<u8>,
}

impl GraphicsCaptureApiHandler for CaptureHandler {
    type Flags = CaptureFlags;
    type Error = HandlerError;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            encoder: ctx.flags.encoder,
            crop: ctx.flags.crop,
            thumbnail_tx: Some(ctx.flags.thumbnail_tx),
            frame_interval: ctx.flags.frame_interval,
            next_frame_due: 0,
            flipped: Vec::new(),
            scratch: Vec::new(),
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        _capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        let timestamp = frame.timestamp()?.Duration;
        if timestamp < self.next_frame_due {
            return Ok(());
        }
        self.next_frame_due = timestamp + self.frame_interval;

        match self.crop {
            None => {
                if let Some(tx) = self.thumbnail_tx.take() {
                    let buffer = frame.buffer()?;
                    let (width, height) = (buffer.width(), buffer.height());
                    let pixels = buffer.as_nopadding_buffer(&mut self.scratch).to_vec();
                    send_thumbnail(tx, &pixels, width, height);
                }

                let mut guard = self.encoder.lock().expect("encoder lock not poisoned");
                if let Some(encoder) = guard.as_mut() {
                    encoder.send_frame(frame)?;
                }
            }
            Some((start_x, start_y, end_x, end_y)) => {
                // Monitor resolution changes mid-recording would shrink the
                // frame; clamp so buffer_crop can't run past its edges.
                let end_x = end_x.min(frame.width());
                let end_y = end_y.min(frame.height());
                if start_x >= end_x || start_y >= end_y {
                    return Ok(());
                }

                let width = (end_x - start_x) as usize;
                let height = (end_y - start_y) as usize;
                let row_bytes = width * 4;

                let mut buffer = frame.buffer_crop(start_x, start_y, end_x, end_y)?;
                let row_pitch = buffer.row_pitch() as usize;
                let raw = buffer.as_raw_buffer();

                if let Some(tx) = self.thumbnail_tx.take() {
                    self.scratch.clear();
                    for y in 0..height {
                        self.scratch
                            .extend_from_slice(&raw[y * row_pitch..y * row_pitch + row_bytes]);
                    }
                    send_thumbnail(tx, &self.scratch, width as u32, height as u32);
                }

                // The buffer-path encoder expects BGRA rows bottom-to-top;
                // strip the row pitch padding and flip in one pass.
                self.flipped.resize(row_bytes * height, 0);
                for y in 0..height {
                    let src = &raw[y * row_pitch..y * row_pitch + row_bytes];
                    let dst_start = (height - 1 - y) * row_bytes;
                    self.flipped[dst_start..dst_start + row_bytes].copy_from_slice(src);
                }

                let mut guard = self.encoder.lock().expect("encoder lock not poisoned");
                if let Some(encoder) = guard.as_mut() {
                    encoder.send_frame_buffer(&self.flipped, timestamp)?;
                }
            }
        }

        Ok(())
    }
}

fn send_thumbnail(tx: mpsc::Sender<RgbaImage>, bgra: &[u8], width: u32, height: u32) {
    let mut rgba = bgra.to_vec();
    for pixel in rgba.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    if let Some(image) = RgbaImage::from_raw(width, height, rgba) {
        let _ = tx.send(image);
    }
}

/// The monitor under the region's center, with its virtual-desktop bounds.
fn monitor_under(region: &WindowBounds) -> Result<(Monitor, WindowBounds), RecordingError> {
    let center = POINT {
        x: region.left + (region.right - region.left) / 2,
        y: region.top + (region.bottom - region.top) / 2,
    };

    let hmonitor = unsafe { MonitorFromPoint(center, MONITOR_DEFAULTTONEAREST) };
    if hmonitor.is_invalid() {
        return Err(RecordingError::Failed(
            "No monitor found under the selection".into(),
        ));
    }

    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(hmonitor, &mut info) }.as_bool() {
        return Err(RecordingError::Failed(
            "Failed to read the monitor bounds".into(),
        ));
    }

    let bounds = WindowBounds {
        left: info.rcMonitor.left,
        top: info.rcMonitor.top,
        right: info.rcMonitor.right,
        bottom: info.rcMonitor.bottom,
        z_order: 0,
    };

    Ok((Monitor::from_raw_hmonitor(hmonitor.0), bounds))
}

/// Clamps the virtual-desktop region to the monitor, converts it to
/// monitor-relative coordinates, and floors the size to even (H.264).
fn crop_within_monitor(
    region: &WindowBounds,
    monitor: &WindowBounds,
) -> Result<(u32, u32, u32, u32), RecordingError> {
    let left = region.left.max(monitor.left);
    let top = region.top.max(monitor.top);
    let right = region.right.min(monitor.right);
    let bottom = region.bottom.min(monitor.bottom);

    let mut width = (right - left).max(0) as u32 & !1;
    let mut height = (bottom - top).max(0) as u32 & !1;
    // A selection can legitimately be as small as the click threshold; the
    // encoder needs at least one macroblock-ish worth of pixels.
    width = width.max(2);
    height = height.max(2);

    if right <= left || bottom <= top {
        return Err(RecordingError::Failed(
            "The selection does not overlap the monitor under it".into(),
        ));
    }

    let start_x = (left - monitor.left) as u32;
    let start_y = (top - monitor.top) as u32;
    let monitor_width = (monitor.right - monitor.left) as u32;
    let monitor_height = (monitor.bottom - monitor.top) as u32;

    let start_x = start_x.min(monitor_width.saturating_sub(width));
    let start_y = start_y.min(monitor_height.saturating_sub(height));

    Ok((start_x, start_y, start_x + width, start_y + height))
}

fn bitrate_for(width: u32, height: u32, fps: u32) -> u32 {
    let bits = f64::from(width) * f64::from(height) * f64::from(fps.max(1)) * 0.13;
    (bits as u32).clamp(1_000_000, 40_000_000)
}

fn cursor_settings() -> CursorCaptureSettings {
    if GraphicsCaptureApi::is_cursor_settings_supported().unwrap_or(false) {
        CursorCaptureSettings::WithCursor
    } else {
        CursorCaptureSettings::Default
    }
}

fn border_settings() -> DrawBorderSettings {
    if GraphicsCaptureApi::is_border_settings_supported().unwrap_or(false) {
        DrawBorderSettings::WithoutBorder
    } else {
        DrawBorderSettings::Default
    }
}
