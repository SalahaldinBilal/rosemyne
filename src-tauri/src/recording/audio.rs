//! System-audio loopback capture via cpal. On Windows, building an *input*
//! stream on an *output* device transparently enables WASAPI loopback; the
//! same code path covers macOS (CoreAudio loopback) later.

use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};

/// PCM format delivered to the sink (interleaved 16-bit little-endian).
#[derive(Debug, Clone, Copy)]
pub struct LoopbackFormat {
    pub sample_rate: u32,
    pub channels: u16,
}

pub struct LoopbackCapture {
    stop_tx: mpsc::Sender<()>,
    thread: Option<JoinHandle<()>>,
    pub format: LoopbackFormat,
}

impl LoopbackCapture {
    pub fn stop(mut self) {
        let _ = self.stop_tx.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// A loopback capture whose streams are still being built on the audio
/// thread. Split from [`begin`] so the (slow) video encoder creation can
/// overlap the stream startup instead of waiting behind it.
pub struct PendingLoopback {
    stop_tx: mpsc::Sender<()>,
    thread: Option<JoinHandle<()>>,
    ready_rx: mpsc::Receiver<Result<(), String>>,
    pub format: LoopbackFormat,
}

impl PendingLoopback {
    pub fn wait_ready(mut self, timeout: Duration) -> Result<LoopbackCapture, String> {
        match self.ready_rx.recv_timeout(timeout) {
            Ok(Ok(())) => Ok(LoopbackCapture {
                stop_tx: self.stop_tx,
                thread: self.thread.take(),
                format: self.format,
            }),
            Ok(Err(err)) => {
                if let Some(thread) = self.thread.take() {
                    let _ = thread.join();
                }
                Err(err)
            }
            Err(_) => {
                self.abort();
                Err("Timed out waiting for the audio capture to start".into())
            }
        }
    }

    /// Signals the thread to wind down without waiting for it.
    pub fn abort(&mut self) {
        let _ = self.stop_tx.send(());
        self.thread.take();
    }
}

/// The output format capture would use, from the default device's mix format
/// (the MF AAC encoder only takes 44.1/48 kHz mono/stereo PCM). Fast , no
/// streams are opened.
pub fn probe_format() -> Result<LoopbackFormat, String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("No default audio output device")?;
    let supported = device
        .default_output_config()
        .map_err(|err| format!("No default output config: {}", err))?;

    let device_rate = supported.sample_rate().0;
    Ok(LoopbackFormat {
        sample_rate: match device_rate {
            44100 | 48000 => device_rate,
            _ => 48000,
        },
        channels: supported.channels().clamp(1, 2),
    })
}

/// Starts capturing the default output device on a dedicated thread,
/// converting to `format` (interleaved i16 LE into `sink`). Returns
/// immediately; call [`PendingLoopback::wait_ready`] once the other startup
/// work is done.
pub fn begin<F>(sink: F, format: LoopbackFormat) -> PendingLoopback
where
    F: FnMut(&[u8]) + Send + 'static,
{
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

    let thread = std::thread::spawn(move || run_capture(stop_rx, ready_tx, sink, format));

    PendingLoopback { stop_tx, thread: Some(thread), ready_rx, format }
}

fn run_capture<F>(
    stop_rx: mpsc::Receiver<()>,
    ready_tx: mpsc::Sender<Result<(), String>>,
    mut sink: F,
    format: LoopbackFormat,
) where
    F: FnMut(&[u8]) + Send + 'static,
{
    let host = cpal::default_host();
    let Some(device) = host.default_output_device() else {
        let _ = ready_tx.send(Err("No default audio output device".into()));
        return;
    };

    let supported = match device.default_output_config() {
        Ok(config) => config,
        Err(err) => {
            let _ = ready_tx.send(Err(format!("No default output config: {}", err)));
            return;
        }
    };

    let device_rate = supported.sample_rate().0;
    let device_channels = supported.channels();

    let stream_config: StreamConfig = supported.config();
    let err_fn = |err| eprintln!("Audio capture stream error: {}", err);

    // Loopback delivers no packets while the system is silent, which would
    // starve (and desync) the audio track; playing silence keeps it flowing.
    let silence = device
        .build_output_stream(
            &stream_config,
            |data: &mut [f32], _| data.fill(0.0),
            err_fn,
            None,
        )
        .ok();
    if let Some(stream) = &silence {
        let _ = stream.play();
    }

    let mut converter =
        Converter::new(device_channels, device_rate, format.channels, format.sample_rate);

    let input = match supported.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |data: &[f32], _| {
                let bytes = converter.push(data);
                if !bytes.is_empty() {
                    sink(bytes);
                }
            },
            err_fn,
            None,
        ),
        SampleFormat::I16 => {
            let mut scratch: Vec<f32> = Vec::new();
            device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    scratch.clear();
                    scratch.extend(data.iter().map(|s| f32::from(*s) / 32768.0));
                    let bytes = converter.push(&scratch);
                    if !bytes.is_empty() {
                        sink(bytes);
                    }
                },
                err_fn,
                None,
            )
        }
        other => {
            let _ = ready_tx.send(Err(format!("Unsupported audio sample format: {:?}", other)));
            return;
        }
    };

    let input = match input {
        Ok(stream) => stream,
        Err(err) => {
            let _ = ready_tx.send(Err(format!("Failed to open the loopback stream: {}", err)));
            return;
        }
    };

    if let Err(err) = input.play() {
        let _ = ready_tx.send(Err(format!("Failed to start the loopback stream: {}", err)));
        return;
    }

    let _ = ready_tx.send(Ok(()));

    // Streams are !Send, so they live (and die) on this thread.
    let _ = stop_rx.recv();
    drop(input);
    drop(silence);
}

/// Downmixes to mono/stereo, linearly resamples when the device rate isn't
/// AAC-compatible, and emits interleaved i16 LE bytes. State persists across
/// callbacks so resampling stays continuous.
struct Converter {
    in_channels: usize,
    out_channels: usize,
    /// input frames advanced per output frame (1.0 = passthrough)
    step: f64,
    /// next output sample position, in input-frame units relative to the
    /// current buffer ([-1, 0) reaches into `prev`)
    pos: f64,
    prev: [f32; 2],
    out: Vec<u8>,
}

impl Converter {
    fn new(in_channels: u16, in_rate: u32, out_channels: u16, out_rate: u32) -> Self {
        Self {
            in_channels: in_channels.max(1) as usize,
            out_channels: out_channels.max(1) as usize,
            step: f64::from(in_rate) / f64::from(out_rate),
            pos: 0.0,
            prev: [0.0; 2],
            out: Vec::new(),
        }
    }

    fn push(&mut self, data: &[f32]) -> &[u8] {
        self.out.clear();
        let frames = data.len() / self.in_channels;
        if frames == 0 {
            return &self.out;
        }

        let prev = self.prev;

        if (self.step - 1.0).abs() < f64::EPSILON {
            for frame in 0..frames as isize {
                for ch in 0..self.out_channels {
                    push_i16(&mut self.out, channel_at(data, self.in_channels, &prev, frame, ch));
                }
            }
        } else {
            // Interpolate between frames floor(pos) and floor(pos)+1; the last
            // input frame carries over as `prev` for the next callback.
            while self.pos < (frames - 1) as f64 {
                let base = self.pos.floor();
                let frac = (self.pos - base) as f32;
                let base = base as isize;
                for ch in 0..self.out_channels {
                    let a = channel_at(data, self.in_channels, &prev, base, ch);
                    let b = channel_at(data, self.in_channels, &prev, base + 1, ch);
                    push_i16(&mut self.out, a + (b - a) * frac);
                }
                self.pos += self.step;
            }
            self.pos -= frames as f64;
        }

        for ch in 0..2 {
            self.prev[ch] = channel_at(data, self.in_channels, &prev, frames as isize - 1, ch);
        }

        &self.out
    }
}

fn channel_at(data: &[f32], in_channels: usize, prev: &[f32; 2], frame: isize, out_ch: usize) -> f32 {
    if frame < 0 {
        prev[out_ch.min(1)]
    } else {
        data[frame as usize * in_channels + out_ch.min(in_channels - 1)]
    }
}

fn push_i16(out: &mut Vec<u8>, sample: f32) {
    let value = (sample.clamp(-1.0, 1.0) * 32767.0) as i16;
    out.extend_from_slice(&value.to_le_bytes());
}
