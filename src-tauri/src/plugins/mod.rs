pub mod commands;
mod host;
mod net;
mod package;
mod runtime;
mod store;

// The package rules live in the SDK crate, so the packer and the app can't disagree.
pub use rosemyne_plugin::manifest;
use rosemyne_plugin::tree as ui;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use image::RgbaImage;
use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use crate::screen_manager::screenshot_manager::{HistoryItemType, ImageHistoryData, now_ms};
use crate::{HistoryStoreHandler, emit_on_main_thread};

use manifest::{
    HOOK_CAPTURE_SAVED, HOOK_CARD_ACTION, HOOK_EDIT_IMAGE, HOOK_UI_EVENT, HOOK_UI_RENDER, HOOK_UPLOAD,
    PluginManifest,
};
use package::{ICON_FILE, Package, WASM_FILE, sha256_hex};
use runtime::{
    Asset, AssetStore, CallError, CallOutput, CaptureRef, HostShared, Job, LogBuffer, LogLine, WasmSource, Worker,
};
use store::{PluginRow, PluginStore, SETTING_PREFIX};

pub type PluginManagerHandler = Arc<PluginManager>;

pub const UPLOADER_ID_PREFIX: &str = "plugin:";

const BUDGET_CAPTURE_SAVED: Duration = Duration::from_secs(30);
const BUDGET_EDIT_IMAGE: Duration = Duration::from_secs(5);
const BUDGET_UPLOAD: Duration = Duration::from_secs(60);
const BUDGET_UI: Duration = Duration::from_secs(2);
const EDIT_TIMEOUTS_BEFORE_PAUSE: u32 = 3;
const MIN_REFRESH_MS: u64 = 500;

enum Problem {
    ChangedOnDisk,
    Unusable(String),
}

impl Problem {
    fn message(&self) -> String {
        match self {
            Self::ChangedOnDisk => "plugin.wasm changed on disk since it was installed".into(),
            Self::Unusable(message) => message.clone(),
        }
    }
}

struct Loaded {
    row: PluginRow,
    folder: PathBuf,
    worker: Option<Worker>,
    problem: Option<Problem>,
    log: Arc<LogBuffer>,
    last_error: Mutex<Option<String>>,
    edit_timeouts: AtomicU32,
    paused: AtomicBool,
}

impl Loaded {
    fn manifest(&self) -> &PluginManifest {
        &self.row.manifest
    }

    fn runs(&self, hook: &str) -> bool {
        self.worker.is_some() && !self.paused.load(Ordering::SeqCst) && self.manifest().has_hook(hook)
    }

    fn status(&self) -> &'static str {
        match &self.problem {
            Some(Problem::ChangedOnDisk) => "changedOnDisk",
            Some(Problem::Unusable(_)) => "unusable",
            None if !self.row.enabled => "disabled",
            None if self.paused.load(Ordering::SeqCst) => "paused",
            None if self.last_error.lock().expect("plugin error not poisoned").is_some() => "error",
            None => "ok",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub dev: bool,
    pub status: &'static str,
    pub problem: Option<String>,
    pub last_error: Option<String>,
    pub has_icon: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInspection {
    pub manifest: PluginManifest,
    pub wasm_sha256: String,
    pub installed_version: Option<String>,
    pub added_permissions: Vec<String>,
    pub added_hosts: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUploaderInfo {
    pub id: String,
    pub name: String,
    pub auto_upload: bool,
    pub plugin_id: String,
    pub plugin_name: String,
    pub uploader_id: String,
}

pub struct PluginUpload {
    pub url: String,
    pub deletion_url: Option<String>,
}

pub struct PluginManager {
    app: AppHandle,
    store: Arc<PluginStore>,
    dir: PathBuf,
    assets: Arc<AssetStore>,
    plugins: RwLock<Vec<Arc<Loaded>>>,
    logs: Mutex<HashMap<String, Arc<LogBuffer>>>,
}

fn capture_ref(entry: &ImageHistoryData) -> CaptureRef {
    CaptureRef {
        file_name: entry.file_name.clone(),
        file_path: entry.file_path.clone(),
        item_type: entry.item_type,
    }
}

fn capture_json(entry: &ImageHistoryData, with_tags: bool) -> Value {
    let mut capture = json!({
        "fileName": entry.file_name,
        "type": entry.item_type.as_str(),
        "dateTimeMs": entry.date_time.timestamp_millis(),
    });
    let fields = capture.as_object_mut().expect("capture is an object");

    if entry.item_type == HistoryItemType::Image {
        if let Ok((width, height)) = image::image_dimensions(&entry.file_path) {
            fields.insert("width".into(), json!(width));
            fields.insert("height".into(), json!(height));
        }
    }
    if let Some(file_size) = entry.file_size {
        fields.insert("fileSize".into(), json!(file_size));
    }
    if let Some(url) = &entry.url {
        fields.insert("url".into(), json!(url));
    }
    if with_tags {
        fields.insert("tags".into(), json!(entry.tags.clone().unwrap_or_default()));
    }
    capture
}

fn parse_output(output: &[u8]) -> Result<Value, String> {
    if output.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(output).map_err(|err| format!("The plugin returned invalid JSON: {err}"))
}

fn check_tree(holder: &Value, key: &str) -> Result<(), String> {
    match holder.get(key) {
        None | Some(Value::Null) => Ok(()),
        Some(Value::Array(nodes)) => ui::validate_tree(nodes, false),
        Some(_) => Err("A tree must be a list of nodes".into()),
    }
}

impl PluginManager {
    pub fn new(app: AppHandle, base_path: &Path) -> Result<Arc<Self>, String> {
        let manager = Arc::new(Self {
            app,
            store: Arc::new(PluginStore::open(base_path)?),
            dir: base_path.join("plugins"),
            assets: Arc::new(AssetStore::default()),
            plugins: RwLock::new(Vec::new()),
            logs: Mutex::new(HashMap::new()),
        });
        manager.reload_all()?;
        Ok(manager)
    }

    fn app_version(&self) -> String {
        self.app.package_info().version.to_string()
    }

    fn log_for(&self, plugin_id: &str) -> Arc<LogBuffer> {
        self.logs
            .lock()
            .expect("plugin logs not poisoned")
            .entry(plugin_id.to_owned())
            .or_insert_with(|| Arc::new(LogBuffer::new(plugin_id.to_owned(), self.app.clone())))
            .clone()
    }

    fn all(&self) -> Vec<Arc<Loaded>> {
        self.plugins.read().expect("plugin list not poisoned").clone()
    }

    fn find(&self, id: &str) -> Result<Arc<Loaded>, String> {
        self.all()
            .into_iter()
            .find(|plugin| plugin.row.id == id)
            .ok_or_else(|| format!("Plugin {id} is not installed"))
    }

    /// Rebuilds every plugin from the database. Old workers stop once their queue is drained.
    pub fn reload_all(&self) -> Result<(), String> {
        let loaded: Vec<Arc<Loaded>> = self
            .store
            .list()?
            .into_iter()
            .map(|row| Arc::new(self.load(row)))
            .collect();
        *self.plugins.write().expect("plugin list not poisoned") = loaded;
        emit_on_main_thread!(self.app, "plugins://changed", ());
        Ok(())
    }

    fn load(&self, mut row: PluginRow) -> Loaded {
        let folder = row.dev_path.clone().unwrap_or_else(|| self.dir.join(&row.id));
        let log = self.log_for(&row.id);
        let app_version = self.app_version();

        let problem = if row.dev {
            match package::read_unpacked(&folder, &app_version) {
                Ok(package) if package.manifest.id != row.id => {
                    Some(Problem::Unusable("The folder now holds a different plugin".into()))
                }
                Ok(package) => {
                    row.manifest = package.manifest;
                    row.wasm_sha256 = sha256_hex(&package.wasm);
                    if let Err(err) = self.store.upsert(&row.manifest, &row.wasm_sha256, Some(&folder), now_ms() as i64) {
                        eprintln!("Failed to refresh dev plugin {}: {err}", row.id);
                    }
                    None
                }
                Err(err) => Some(Problem::Unusable(err)),
            }
        } else {
            match row.manifest.validate(&app_version) {
                Err(err) => Some(Problem::Unusable(err)),
                Ok(()) => match std::fs::read(folder.join(WASM_FILE)) {
                    Ok(wasm) if sha256_hex(&wasm) == row.wasm_sha256 => None,
                    Ok(_) => Some(Problem::ChangedOnDisk),
                    Err(err) => Some(Problem::Unusable(format!("Couldn't read plugin.wasm: {err}"))),
                },
            }
        };

        let worker = (row.enabled && problem.is_none()).then(|| {
            let network = row.manifest.permissions.network.clone();
            let client = if network.is_empty() {
                None
            } else {
                net::build_client(network)
                    .inspect_err(|err| log.push("error", err))
                    .ok()
            };
            let shared = Arc::new(HostShared {
                plugin_id: row.id.clone(),
                manifest: row.manifest.clone(),
                app: self.app.clone(),
                store: self.store.clone(),
                log: log.clone(),
                assets: self.assets.clone(),
                client,
                call: Mutex::default(),
                watch: Mutex::default(),
                last_toast: Mutex::default(),
            });
            let source = WasmSource {
                path: folder.join(WASM_FILE),
                expected_sha256: (!row.dev).then(|| row.wasm_sha256.clone()),
            };
            Worker::spawn(shared, source)
        });

        Loaded {
            row,
            folder,
            worker,
            problem,
            log,
            last_error: Mutex::new(None),
            edit_timeouts: AtomicU32::new(0),
            paused: AtomicBool::new(false),
        }
    }

    fn info(plugin: &Loaded) -> PluginInfo {
        PluginInfo {
            manifest: plugin.row.manifest.clone(),
            enabled: plugin.row.enabled,
            dev: plugin.row.dev,
            status: plugin.status(),
            problem: plugin.problem.as_ref().map(Problem::message),
            last_error: plugin.last_error.lock().expect("plugin error not poisoned").clone(),
            has_icon: plugin.folder.join(ICON_FILE).is_file(),
        }
    }

    pub fn list(&self) -> Vec<PluginInfo> {
        self.all().iter().map(|plugin| Self::info(plugin)).collect()
    }

    async fn call(
        &self,
        plugin: &Arc<Loaded>,
        hook: &'static str,
        input: &Value,
        capture: Option<CaptureRef>,
        image: Option<RgbaImage>,
        budget: Duration,
    ) -> Result<CallOutput, CallError> {
        let worker = plugin
            .worker
            .as_ref()
            .ok_or_else(|| CallError::new("The plugin is not running"))?;
        if !plugin.manifest().has_hook(hook) {
            return Err(CallError::new(format!("The plugin has no {hook} hook")));
        }

        let (reply, response) = oneshot::channel();
        let job = Job { hook, input: input.to_string().into_bytes(), capture, image, budget, reply };
        if worker.send(job).is_err() {
            plugin.log.push("warn", &format!("{hook} skipped, the plugin is busy"));
            return Err(CallError::new("The plugin is busy"));
        }

        let result = response
            .await
            .unwrap_or_else(|_| Err(CallError::new("The plugin stopped before it answered")));

        let error = result.as_ref().err().map(|err| err.message.clone());
        let mut last_error = plugin.last_error.lock().expect("plugin error not poisoned");
        if *last_error != error {
            *last_error = error;
            drop(last_error);
            emit_on_main_thread!(self.app, "plugins://changed", ());
        }

        result
    }

    /// Runs every plugin's after-save hook on its own task, so none of them holds up the others.
    pub fn capture_saved(self: &Arc<Self>, entry: &ImageHistoryData) {
        for plugin in self.all().into_iter().filter(|plugin| plugin.runs(HOOK_CAPTURE_SAVED)) {
            let manager = self.clone();
            let entry = entry.clone();
            tauri::async_runtime::spawn(async move {
                let input = json!({ "capture": capture_json(&entry, plugin.manifest().permissions.tags_read) });
                let _ = manager
                    .call(&plugin, HOOK_CAPTURE_SAVED, &input, Some(capture_ref(&entry)), None, BUDGET_CAPTURE_SAVED)
                    .await;
            });
        }
    }

    pub fn edits_images(&self) -> bool {
        self.all().iter().any(|plugin| plugin.runs(HOOK_EDIT_IMAGE))
    }

    /// Passes a screenshot through every plugin with the edit hook, in list order.
    /// A plugin that fails or runs out of time leaves the image as it got it.
    pub async fn edit_image(&self, mut image: RgbaImage) -> RgbaImage {
        for plugin in self.all().into_iter().filter(|plugin| plugin.runs(HOOK_EDIT_IMAGE)) {
            let input = json!({ "width": image.width(), "height": image.height() });
            let result = self
                .call(&plugin, HOOK_EDIT_IMAGE, &input, None, Some(image.clone()), BUDGET_EDIT_IMAGE)
                .await;

            match result {
                Ok(output) => {
                    plugin.edit_timeouts.store(0, Ordering::SeqCst);
                    if let Some(edited) = output.image {
                        image = edited;
                    }
                }
                Err(err) if err.timed_out => self.count_edit_timeout(&plugin),
                Err(_) => {}
            }
        }
        image
    }

    fn count_edit_timeout(&self, plugin: &Loaded) {
        if plugin.edit_timeouts.fetch_add(1, Ordering::SeqCst) + 1 < EDIT_TIMEOUTS_BEFORE_PAUSE {
            return;
        }
        plugin.paused.store(true, Ordering::SeqCst);
        plugin.log.push("error", "Paused: edit_image ran out of time 3 times in a row");
        emit_on_main_thread!(
            self.app,
            "plugins://toast",
            host::ToastEvent {
                plugin_id: plugin.row.id.clone(),
                plugin_name: plugin.manifest().name.clone(),
                kind: "error".into(),
                text: "Paused because it kept slowing down saves. Turn it off and on again in Settings › Plugins to resume.".into(),
            }
        );
        emit_on_main_thread!(self.app, "plugins://changed", ());
    }

    fn split_uploader_id(id: &str) -> Option<(&str, &str)> {
        id.strip_prefix(UPLOADER_ID_PREFIX)?.split_once(':')
    }

    pub fn uploaders(&self) -> Vec<PluginUploaderInfo> {
        self.all()
            .iter()
            .filter(|plugin| plugin.worker.is_some())
            .flat_map(|plugin| {
                plugin.manifest().uploaders.iter().map(|uploader| PluginUploaderInfo {
                    id: format!("{UPLOADER_ID_PREFIX}{}:{}", plugin.row.id, uploader.id),
                    name: uploader.name.clone(),
                    auto_upload: self.store.uploader_auto_upload(&plugin.row.id, &uploader.id),
                    plugin_id: plugin.row.id.clone(),
                    plugin_name: plugin.manifest().name.clone(),
                    uploader_id: uploader.id.clone(),
                })
            })
            .collect()
    }

    pub fn uploader(&self, id: &str) -> Option<PluginUploaderInfo> {
        self.uploaders().into_iter().find(|uploader| uploader.id == id)
    }

    pub fn set_uploader_auto_upload(&self, id: &str, enabled: bool) -> Result<(), String> {
        let (plugin_id, uploader_id) = Self::split_uploader_id(id).ok_or("Not a plugin uploader")?;
        self.store.set_uploader_auto_upload(plugin_id, uploader_id, enabled)
    }

    pub async fn upload(&self, uploader: &PluginUploaderInfo, entry: &ImageHistoryData) -> Result<PluginUpload, String> {
        let plugin = self.find(&uploader.plugin_id)?;
        let input = json!({
            "uploaderId": uploader.uploader_id,
            "capture": capture_json(entry, plugin.manifest().permissions.tags_read),
        });
        let output = self
            .call(&plugin, HOOK_UPLOAD, &input, Some(capture_ref(entry)), None, BUDGET_UPLOAD)
            .await
            .map_err(|err| err.message)?;

        let result = parse_output(&output.output)?;
        let url = result
            .get("url")
            .and_then(Value::as_str)
            .filter(|url| !url.trim().is_empty())
            .ok_or("The plugin returned no link")?
            .to_owned();
        let deletion_url = result.get("deletionUrl").and_then(Value::as_str).map(str::to_owned);
        Ok(PluginUpload { url, deletion_url })
    }

    async fn ui_call(
        &self,
        id: &str,
        hook: &'static str,
        input: Value,
        capture: Option<CaptureRef>,
    ) -> Result<Value, String> {
        let plugin = self.find(id)?;
        let output = self
            .call(&plugin, hook, &input, capture, None, BUDGET_UI)
            .await
            .map_err(|err| err.message)?;
        let mut response = parse_output(&output.output)?;

        let checked = check_tree(&response, "tree")
            .and_then(|()| response.get("modal").map_or(Ok(()), |modal| check_tree(modal, "tree")));
        if let Err(err) = checked {
            plugin.log.push("error", &format!("{hook}: the returned tree was dropped: {err}"));
            return Err(format!("The plugin's view is not valid: {err}"));
        }

        if let Some(refresh) = response.get_mut("refreshAfterMs") {
            if let Some(ms) = refresh.as_u64() {
                *refresh = json!(ms.max(MIN_REFRESH_MS));
            }
        }
        Ok(response)
    }

    pub async fn ui_render(&self, id: &str, view: &str) -> Result<Value, String> {
        self.ui_call(id, HOOK_UI_RENDER, json!({ "view": view }), None).await
    }

    pub async fn ui_event(&self, id: &str, view: &str, mut event: Value) -> Result<Value, String> {
        let fields = event.as_object_mut().ok_or("An event must be an object")?;
        fields.insert("view".into(), json!(view));
        self.ui_call(id, HOOK_UI_EVENT, event, None).await
    }

    pub async fn card_action(&self, id: &str, action_id: &str, entry: &ImageHistoryData) -> Result<Value, String> {
        let plugin = self.find(id)?;
        if !plugin.manifest().card_actions.iter().any(|action| action.id == action_id) {
            return Err(format!("The plugin has no action {action_id}"));
        }
        let input = json!({
            "actionId": action_id,
            "capture": capture_json(entry, plugin.manifest().permissions.tags_read),
        });
        self.ui_call(id, HOOK_CARD_ACTION, input, Some(capture_ref(entry))).await
    }

    fn check_tag_key_free(&self, manifest: &PluginManifest) -> Result<(), String> {
        let Some(key) = &manifest.tag_key else {
            return Ok(());
        };
        let taken = self.all().into_iter().find(|plugin| {
            plugin.row.id != manifest.id
                && plugin.manifest().tag_key.as_deref().is_some_and(|other| other.eq_ignore_ascii_case(key))
        });
        match taken {
            Some(other) => Err(format!("The tag name \"{key}\" is already used by {}", other.manifest().name)),
            None => Ok(()),
        }
    }

    pub fn inspect(&self, path: &Path) -> Result<PluginInspection, String> {
        let package = package::read_package(path, &self.app_version())?;
        self.check_tag_key_free(&package.manifest)?;

        let installed = self.find(&package.manifest.id).ok();
        let (added_permissions, added_hosts) = match &installed {
            Some(installed) => package.manifest.permissions.added_since(&installed.manifest().permissions),
            None => (Vec::new(), Vec::new()),
        };

        Ok(PluginInspection {
            wasm_sha256: package.wasm_sha256(),
            installed_version: installed.map(|plugin| plugin.manifest().version.clone()),
            added_permissions,
            added_hosts,
            manifest: package.manifest,
        })
    }

    /// Installs or updates from a package the user was already shown through `inspect`.
    /// `expected_sha256` is what they approved, so a file swapped in between is refused.
    pub fn install(&self, path: &Path, expected_sha256: &str) -> Result<(), String> {
        let package = package::read_package(path, &self.app_version())?;
        if package.wasm_sha256() != expected_sha256 {
            return Err("The plugin file changed since you reviewed it. Try again.".into());
        }
        self.check_tag_key_free(&package.manifest)?;
        self.write_and_record(&package)
    }

    fn write_and_record(&self, package: &Package) -> Result<(), String> {
        let id = &package.manifest.id;
        package
            .write_to(&self.dir.join(id))
            .map_err(|err| format!("Couldn't write the plugin's files: {err}"))?;
        self.store.upsert(&package.manifest, &package.wasm_sha256(), None, now_ms() as i64)?;
        self.assets.clear(id);
        self.reload_all()
    }

    pub fn load_unpacked(&self, folder: &Path) -> Result<(), String> {
        let package = package::read_unpacked(folder, &self.app_version())?;
        self.check_tag_key_free(&package.manifest)?;
        self.store
            .upsert(&package.manifest, &package.wasm_sha256(), Some(folder), now_ms() as i64)?;
        self.assets.clear(&package.manifest.id);
        self.reload_all()
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<(), String> {
        self.find(id)?;
        self.store.set_enabled(id, enabled)?;
        self.reload_all()
    }

    pub fn set_order(&self, ids: &[String]) -> Result<(), String> {
        self.store.set_order(ids)?;
        self.reload_all()
    }

    pub fn tagged_count(&self, id: &str) -> Result<u64, String> {
        let plugin = self.find(id)?;
        match &plugin.manifest().tag_key {
            Some(key) => self
                .app
                .state::<HistoryStoreHandler>()
                .count_tag_key(key)
                .map_err(|err| err.to_string()),
            None => Ok(0),
        }
    }

    pub fn uninstall(&self, id: &str, delete_data: bool, remove_tags: bool) -> Result<(), String> {
        let plugin = self.find(id)?;
        self.plugins.write().expect("plugin list not poisoned").retain(|plugin| plugin.row.id != id);

        if remove_tags {
            if let Some(key) = &plugin.manifest().tag_key {
                let removed = self
                    .app
                    .state::<HistoryStoreHandler>()
                    .remove_tag_key(key)
                    .map_err(|err| err.to_string())?;
                if removed > 0 {
                    emit_on_main_thread!(self.app, "history://tags-removed", key.clone());
                }
            }
        }

        self.store.delete(id, delete_data)?;
        if !plugin.row.dev {
            match std::fs::remove_dir_all(&plugin.folder) {
                Err(err) if err.kind() != std::io::ErrorKind::NotFound => {
                    eprintln!("Failed to remove the folder of plugin {id}: {err}");
                }
                _ => {}
            }
        }
        self.assets.clear(id);
        self.logs.lock().expect("plugin logs not poisoned").remove(id);
        self.reload_all()
    }

    pub fn stored_settings(&self, id: &str) -> Result<HashMap<String, Value>, String> {
        self.find(id)?;
        let mut settings = HashMap::new();
        for key in self.store.kv_keys(id, SETTING_PREFIX)? {
            let Some(bytes) = self.store.kv_get(id, &key)? else { continue };
            if let Ok(value) = serde_json::from_slice(&bytes) {
                settings.insert(key[SETTING_PREFIX.len()..].to_owned(), value);
            }
        }
        Ok(settings)
    }

    pub fn set_setting(&self, id: &str, setting_id: &str, value: &Value) -> Result<(), String> {
        let plugin = self.find(id)?;
        if !plugin.manifest().has_setting(setting_id) {
            return Err(format!("The plugin has no setting {setting_id}"));
        }
        self.store
            .kv_set(id, &format!("{SETTING_PREFIX}{setting_id}"), value.to_string().as_bytes())
    }

    pub fn log_lines(&self, id: &str) -> Result<Vec<LogLine>, String> {
        Ok(self.find(id)?.log.lines())
    }

    pub fn asset(&self, plugin_id: &str, asset_id: &str) -> Option<Asset> {
        self.assets.get(plugin_id, asset_id)
    }

    pub fn icon(&self, plugin_id: &str) -> Option<Vec<u8>> {
        let plugin = self.find(plugin_id).ok()?;
        std::fs::read(plugin.folder.join(ICON_FILE)).ok()
    }
}
