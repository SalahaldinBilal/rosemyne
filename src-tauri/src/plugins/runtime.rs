use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, SyncSender, TrySendError, sync_channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use image::RgbaImage;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::emit_on_main_thread;
use crate::screen_manager::screenshot_manager::{HistoryItemType, now_ms};

use super::host;
use super::manifest::PluginManifest;
use super::package::sha256_hex;
use super::store::PluginStore;

// 1 GB in 64 KiB wasm pages.
const MEMORY_PAGES: u32 = 16384;
const QUEUE_SIZE: usize = 32;
const LOG_LINES: usize = 500;
const LOG_LINE_CHARS: usize = 2000;
const ASSET_BYTES_PER_PLUGIN: usize = 8 * 1024 * 1024;
const WATCHDOG_TICK: Duration = Duration::from_millis(20);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub time_ms: u64,
    pub level: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEvent {
    plugin_id: String,
    line: LogLine,
}

pub struct LogBuffer {
    plugin_id: String,
    app: AppHandle,
    lines: Mutex<VecDeque<LogLine>>,
}

impl LogBuffer {
    pub fn new(plugin_id: String, app: AppHandle) -> Self {
        Self { plugin_id, app, lines: Mutex::new(VecDeque::new()) }
    }

    pub fn push(&self, level: &str, text: &str) {
        let level = match level {
            "debug" | "warn" | "error" => level,
            _ => "info",
        };
        let line = LogLine {
            time_ms: now_ms(),
            level: level.to_owned(),
            text: text.chars().take(LOG_LINE_CHARS).collect(),
        };

        let mut lines = self.lines.lock().expect("plugin log not poisoned");
        if lines.len() == LOG_LINES {
            lines.pop_front();
        }
        lines.push_back(line.clone());
        drop(lines);

        emit_on_main_thread!(self.app, "plugins://log", LogEvent { plugin_id: self.plugin_id.clone(), line });
    }

    pub fn lines(&self) -> Vec<LogLine> {
        self.lines.lock().expect("plugin log not poisoned").iter().cloned().collect()
    }
}

#[derive(Clone)]
pub struct Asset {
    pub mime: String,
    pub bytes: Arc<Vec<u8>>,
}

#[derive(Default)]
pub struct AssetStore {
    assets: Mutex<HashMap<String, HashMap<String, Asset>>>,
}

impl AssetStore {
    pub fn put(&self, plugin_id: &str, id: &str, mime: String, bytes: Vec<u8>) -> Result<(), String> {
        let mut assets = self.assets.lock().expect("plugin assets not poisoned");
        let own = assets.entry(plugin_id.to_owned()).or_default();
        let others: usize = own
            .iter()
            .filter(|(key, _)| key.as_str() != id)
            .map(|(_, asset)| asset.bytes.len())
            .sum();
        if others + bytes.len() > ASSET_BYTES_PER_PLUGIN {
            return Err(format!(
                "Plugin images can't take more than {} MB in total",
                ASSET_BYTES_PER_PLUGIN / (1024 * 1024)
            ));
        }
        own.insert(id.to_owned(), Asset { mime, bytes: Arc::new(bytes) });
        Ok(())
    }

    pub fn get(&self, plugin_id: &str, id: &str) -> Option<Asset> {
        self.assets
            .lock()
            .expect("plugin assets not poisoned")
            .get(plugin_id)
            .and_then(|own| own.get(id))
            .cloned()
    }

    pub fn clear(&self, plugin_id: &str) {
        self.assets.lock().expect("plugin assets not poisoned").remove(plugin_id);
    }
}

#[derive(Debug, Clone)]
pub struct CaptureRef {
    pub file_name: String,
    pub file_path: PathBuf,
    pub item_type: HistoryItemType,
}

#[derive(Default)]
pub struct CallState {
    pub hook: &'static str,
    pub capture: Option<CaptureRef>,
    pub image: Option<RgbaImage>,
    pub image_changed: bool,
    pub response_body: Vec<u8>,
}

#[derive(Default)]
struct WatchState {
    done: bool,
    paused: bool,
    timed_out: bool,
}

#[derive(Default)]
pub struct Watch {
    state: Mutex<WatchState>,
}

impl Watch {
    pub fn set_paused(&self, paused: bool) {
        self.state.lock().expect("watch not poisoned").paused = paused;
    }

    fn finish(&self) -> bool {
        let mut state = self.state.lock().expect("watch not poisoned");
        state.done = true;
        state.timed_out
    }
}

fn watchdog(watch: Arc<Watch>, budget: Duration, cancel: extism::CancelHandle) {
    let mut used = Duration::ZERO;
    loop {
        std::thread::sleep(WATCHDOG_TICK);
        let mut state = watch.state.lock().expect("watch not poisoned");
        if state.done {
            return;
        }
        if state.paused {
            continue;
        }
        used += WATCHDOG_TICK;
        if used >= budget {
            state.timed_out = true;
            let _ = cancel.cancel();
            return;
        }
    }
}

/// Everything a plugin's host functions can reach, shared with its worker.
pub struct HostShared {
    pub plugin_id: String,
    pub manifest: PluginManifest,
    pub app: AppHandle,
    pub store: Arc<PluginStore>,
    pub log: Arc<LogBuffer>,
    pub assets: Arc<AssetStore>,
    pub client: Option<reqwest::Client>,
    pub call: Mutex<CallState>,
    pub watch: Mutex<Option<Arc<Watch>>>,
    pub last_toast: Mutex<Option<Instant>>,
}

pub struct Job {
    pub hook: &'static str,
    pub input: Vec<u8>,
    pub capture: Option<CaptureRef>,
    pub image: Option<RgbaImage>,
    pub budget: Duration,
    pub reply: oneshot::Sender<Result<CallOutput, CallError>>,
}

pub struct CallOutput {
    pub output: Vec<u8>,
    /// The image after `edit_image`, only when the plugin replaced it.
    pub image: Option<RgbaImage>,
}

#[derive(Debug, Clone)]
pub struct CallError {
    pub message: String,
    pub timed_out: bool,
}

impl CallError {
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), timed_out: false }
    }
}

pub struct WasmSource {
    pub path: PathBuf,
    /// `None` for plugins loaded unpacked, which have no hash lock.
    pub expected_sha256: Option<String>,
}

pub struct Worker {
    sender: SyncSender<Job>,
}

impl Worker {
    pub fn spawn(shared: Arc<HostShared>, source: WasmSource) -> Self {
        let (sender, receiver) = sync_channel(QUEUE_SIZE);
        let thread_name = format!("plugin-{}", shared.plugin_id);
        let spawned = std::thread::Builder::new()
            .name(thread_name)
            .spawn(move || run(shared, source, receiver));
        if let Err(err) = spawned {
            eprintln!("Failed to start a plugin worker: {err}");
        }
        Self { sender }
    }

    /// Hands the job back when the queue is full or the worker is gone.
    pub fn send(&self, job: Job) -> Result<(), Job> {
        self.sender.try_send(job).map_err(|err| match err {
            TrySendError::Full(job) | TrySendError::Disconnected(job) => job,
        })
    }
}

fn run(shared: Arc<HostShared>, source: WasmSource, receiver: Receiver<Job>) {
    let mut compiled: Option<extism::CompiledPlugin> = None;
    let mut instance: Option<extism::Plugin> = None;

    while let Ok(job) = receiver.recv() {
        let Job { hook, input, capture, image, budget, reply } = job;
        let result = call(&shared, &source, &mut compiled, &mut instance, hook, &input, capture, image, budget);
        if let Err(err) = &result {
            shared.log.push("error", &format!("{hook}: {}", err.message));
        }
        let _ = reply.send(result);
    }
}

fn compile(shared: &Arc<HostShared>, source: &WasmSource) -> Result<extism::CompiledPlugin, CallError> {
    let wasm = std::fs::read(&source.path)
        .map_err(|err| CallError::new(format!("Couldn't read plugin.wasm: {err}")))?;

    if let Some(expected) = &source.expected_sha256 {
        if sha256_hex(&wasm) != *expected {
            return Err(CallError::new("plugin.wasm changed on disk since it was installed"));
        }
    }

    let manifest = extism::Manifest::new([extism::Wasm::data(wasm)]).with_memory_max(MEMORY_PAGES);
    extism::PluginBuilder::new(manifest)
        .with_wasi(true)
        .with_functions(host::functions(shared))
        .compile()
        .map_err(|err| CallError::new(format!("Couldn't load the plugin: {err}")))
}

#[allow(clippy::too_many_arguments)]
fn call(
    shared: &Arc<HostShared>,
    source: &WasmSource,
    compiled: &mut Option<extism::CompiledPlugin>,
    instance: &mut Option<extism::Plugin>,
    hook: &'static str,
    input: &[u8],
    capture: Option<CaptureRef>,
    image: Option<RgbaImage>,
    budget: Duration,
) -> Result<CallOutput, CallError> {
    if instance.is_none() {
        if compiled.is_none() {
            *compiled = Some(compile(shared, source)?);
        }
        let built = extism::Plugin::new_from_compiled(compiled.as_ref().expect("compiled above"))
            .map_err(|err| CallError::new(format!("Couldn't start the plugin: {err}")))?;
        *instance = Some(built);
    }
    let plugin = instance.as_mut().expect("instance built above");

    if !plugin.function_exists(hook) {
        return Err(CallError::new(format!("The plugin lists {hook} but doesn't export it")));
    }

    *shared.call.lock().expect("call state not poisoned") =
        CallState { hook, capture, image, image_changed: false, response_body: Vec::new() };

    let watch = Arc::new(Watch::default());
    *shared.watch.lock().expect("watch slot not poisoned") = Some(watch.clone());
    let cancel = plugin.cancel_handle();
    let watchdog_watch = watch.clone();
    std::thread::spawn(move || watchdog(watchdog_watch, budget, cancel));

    let result = plugin.call::<&[u8], Vec<u8>>(hook, input);

    let timed_out = watch.finish();
    *shared.watch.lock().expect("watch slot not poisoned") = None;
    let state = std::mem::take(&mut *shared.call.lock().expect("call state not poisoned"));

    match result {
        Ok(output) if !timed_out => Ok(CallOutput {
            output,
            image: if state.image_changed { state.image } else { None },
        }),
        Ok(_) => {
            *instance = None;
            Err(CallError { message: format!("Took longer than {} s", budget.as_secs()), timed_out: true })
        }
        Err(err) => {
            *instance = None;
            let message = if timed_out {
                format!("Took longer than {} s", budget.as_secs())
            } else {
                err.to_string()
            };
            Err(CallError { message, timed_out })
        }
    }
}
