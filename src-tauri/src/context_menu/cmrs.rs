//! Windows 11 context-menu entry through windows11-context-rs (cmrs), downloaded on demand.

use super::{CmrsStatus, FILE_TITLE, IMPORT_ARG, TYPED_TITLES, blocking};
use crate::HttpClientHandler;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

const RELEASE_URL: &str = "https://github.com/SalahaldinBilal/windows11-context-rs/releases/download";
const CONFIG_FILE: &str = "rosemyne.json";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct Release {
    version: &'static str,
    setup: &'static str,
    dll: &'static str,
    runner: &'static str,
}

/// Every published release with its SHA-256 hashes, oldest first; the last one is what we install.
static RELEASES: [Release; 3] = [
    Release {
        version: "v1.0.0",
        setup: "19e4a38e82f603984e207df837b2eaf2c8b96288659dc3b216a5fc0517c1fb87",
        dll: "db57e0cd8d2a41fe6806b80bf46bb45d19faa830ccee2e913d452d9412c70469",
        runner: "292c7027c7fc1fde0a39833700374ff966c51dd8f7feab03e1fbf40fd0be6d2f",
    },
    Release {
        version: "v1.1.0",
        setup: "ab77df161c0613265db29e2fe17b3000dfbebe669984b036a9e19cfffc6da124",
        dll: "97ea459e6a9f1557634c4ddbf21b5c1ea0d911fe918c389914150ef918cf5325",
        runner: "2cc6bf7fbc2a3a2ec1e66058918e91224d67692469aab2aeb12a9e6d9b38fd54",
    },
    Release {
        version: "v1.2.0",
        setup: "bb44ca1e367f0b460a19b7d0927e9e1063dc6f70e431bda09b9b3a8851415da9",
        dll: "15805c1f6cd60122304157995cf36ec6f670e9914d381ff263812d2bc96778a5",
        runner: "86c8bc81049e125e06d3fb415a74304cc09ff8ecc77c9084fa78b42de37c9564",
    },
];

/// `titleRules` and `classicMenu`, which our config relies on, arrived in v1.1.0.
const FIRST_COMPATIBLE: usize = 1;

fn latest() -> &'static Release {
    RELEASES.last().expect("at least one release")
}

#[derive(Debug, Clone, Copy)]
enum Part {
    Setup,
    Dll,
    Runner,
}

impl Part {
    fn file_name(self) -> &'static str {
        match self {
            Part::Setup => "cmrsSetup.exe",
            Part::Dll => "cmrs.dll",
            Part::Runner => "cmrsRun.exe",
        }
    }

    fn sha256(self, release: &Release) -> &'static str {
        match self {
            Part::Setup => release.setup,
            Part::Dll => release.dll,
            Part::Runner => release.runner,
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum Installed {
    Missing,
    /// An index into `RELEASES`.
    Known(usize),
    Unrecognized,
}

fn data_root() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join("ContextMenuRs"))
}

fn config_path() -> Option<PathBuf> {
    data_root().map(|root| root.join("custom_commands").join(CONFIG_FILE))
}

/// Downloaded releases, kept so the entry can be removed or re-synced offline.
fn download_path(release: &Release, part: Part) -> Option<PathBuf> {
    data_root().map(|root| root.join("installer").join(release.version).join(part.file_name()))
}

fn installed_path(part: Part) -> Option<PathBuf> {
    data_root().map(|root| root.join("bin").join(part.file_name()))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

fn file_sha256(path: &Path) -> Option<String> {
    std::fs::read(path).ok().map(|bytes| sha256_hex(&bytes))
}

fn matches(path: &Path, release: &Release, part: Part) -> bool {
    file_sha256(path).is_some_and(|hash| hash == part.sha256(release))
}

fn installed() -> Installed {
    let dll = installed_path(Part::Dll).and_then(|path| file_sha256(&path));
    let runner = installed_path(Part::Runner).and_then(|path| file_sha256(&path));
    let (Some(dll), Some(runner)) = (dll, runner) else {
        return Installed::Missing;
    };
    RELEASES
        .iter()
        .position(|release| release.dll == dll && release.runner == runner)
        .map_or(Installed::Unrecognized, Installed::Known)
}

pub fn status() -> CmrsStatus {
    let installed = installed();
    CmrsStatus {
        latest_version: latest().version,
        installed: !matches!(installed, Installed::Missing),
        installed_version: match installed {
            Installed::Known(index) => Some(RELEASES[index].version),
            _ => None,
        },
        compatible: matches!(installed, Installed::Known(index) if index >= FIRST_COMPATIBLE),
    }
}

pub fn config_exists() -> bool {
    config_path().is_some_and(|path| path.is_file())
}

pub fn read_config_text() -> Option<String> {
    std::fs::read_to_string(config_path()?).ok()
}

pub fn read_config() -> Option<Value> {
    serde_json::from_str(&read_config_text()?).ok()
}

pub fn includes_classic_menu(config: &Value) -> bool {
    config["classicMenu"].as_bool().unwrap_or(true)
}

pub fn config_text(exe: &Path, classic: bool) -> String {
    let rules: Vec<Value> = TYPED_TITLES
        .iter()
        .map(|(extensions, title)| {
            let accept_exts: Vec<String> = extensions.iter().map(|ext| format!(".{ext}")).collect();
            json!({
                "acceptExts": accept_exts.join("|"),
                "title": title.single,
                "titlePlural": title.plural,
            })
        })
        .collect();

    let config = json!({
        "title": FILE_TITLE.single,
        "titlePlural": FILE_TITLE.plural,
        "titleRules": rules,
        "exe": exe.display().to_string(),
        "param": format!("{IMPORT_ARG} \"{{path}}\""),
        "paramForMultipleFiles": format!("{IMPORT_ARG} {{path}}"),
        "icon": "exe",
        "copyIcon": true,
        "acceptDirectoryFlag": "none",
        "acceptFileFlag": "all",
        "acceptMultipleFilesFlag": "join",
        "classicMenu": classic,
    });
    serde_json::to_string_pretty(&config).expect("static JSON shape")
}

async fn ensure_downloaded(
    http: &HttpClientHandler,
    release: &'static Release,
    part: Part,
) -> Result<PathBuf, String> {
    let name = part.file_name();
    let path = download_path(release, part).ok_or("Failed to locate the local app data folder")?;

    let check_path = path.clone();
    let cached = blocking(move || matches(&check_path, release, part))
        .await
        .unwrap_or(false);
    if cached {
        return Ok(path);
    }

    let url = format!("{RELEASE_URL}/{}/{name}", release.version);
    let bytes = http
        .get(&url)
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|err| format!("Failed to download {name}: {err}"))?
        .bytes()
        .await
        .map_err(|err| format!("Failed to download {name}: {err}"))?;

    if sha256_hex(&bytes) != part.sha256(release) {
        return Err(format!("{name} failed its integrity check"));
    }

    let write_path = path.clone();
    blocking(move || {
        if let Some(dir) = write_path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&write_path, &bytes)
    })
    .await?
    .map_err(|err| format!("Failed to save {name}: {err}"))?;

    Ok(path)
}

fn run_setup(setup: &Path, command: &str) -> Result<(), String> {
    let output = Command::new(setup)
        .arg(command)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| format!("Failed to run cmrsSetup: {err}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let reason = stderr
        .lines()
        .chain(stdout.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("no output");
    Err(format!("cmrsSetup {command} failed: {reason}"))
}

/// Writes (or removes, when `text` is `None`) our config and runs cmrsSetup, restoring the previous config on failure.
fn write_config_and_run(setup: &Path, text: Option<&str>, command: &str) -> Result<(), String> {
    let path = config_path().ok_or("Failed to locate the local app data folder")?;
    let previous = std::fs::read_to_string(&path).ok();

    match text {
        Some(text) => {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).map_err(|err| err.to_string())?;
            }
            std::fs::write(&path, text).map_err(|err| err.to_string())?;
        }
        None => {
            let _ = std::fs::remove_file(&path);
        }
    }

    let result = run_setup(setup, command);
    if result.is_err() {
        match &previous {
            Some(previous) => {
                let _ = std::fs::write(&path, previous);
            }
            None => {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    result
}

/// Downloads the latest release and installs it, replacing whatever is in `bin`.
async fn install_latest(http: &HttpClientHandler, text: Option<String>) -> Result<(), String> {
    let setup = ensure_downloaded(http, latest(), Part::Setup).await?;
    ensure_downloaded(http, latest(), Part::Dll).await?;
    ensure_downloaded(http, latest(), Part::Runner).await?;
    match text {
        Some(text) => blocking(move || write_config_and_run(&setup, Some(&text), "install")).await?,
        None => blocking(move || run_setup(&setup, "install")).await?,
    }
}

/// Never replaces an existing install: a compatible one is synced with its own release's cmrsSetup.
pub async fn enable(http: &HttpClientHandler, exe: &Path, classic: bool) -> Result<(), String> {
    let text = config_text(exe, classic);
    match blocking(installed).await? {
        Installed::Missing => install_latest(http, Some(text)).await,
        Installed::Known(index) if index >= FIRST_COMPATIBLE => {
            let setup = ensure_downloaded(http, &RELEASES[index], Part::Setup).await?;
            blocking(move || write_config_and_run(&setup, Some(&text), "sync")).await?
        }
        Installed::Known(index) => Err(format!(
            "windows11-context-rs {} is too old for this, update it to {} first",
            RELEASES[index].version,
            latest().version
        )),
        Installed::Unrecognized => Err(format!(
            "An unrecognized windows11-context-rs build is installed, update it to {} first",
            latest().version
        )),
    }
}

pub async fn disable(http: &HttpClientHandler) -> Result<(), String> {
    let release = match blocking(installed).await? {
        Installed::Missing => {
            if let Some(path) = config_path() {
                let _ = std::fs::remove_file(path);
            }
            return Ok(());
        }
        Installed::Known(index) => &RELEASES[index],
        // Its own cmrsSetup can't be fetched, and unregistering needs some sync.
        Installed::Unrecognized => latest(),
    };
    let setup = ensure_downloaded(http, release, Part::Setup).await?;
    blocking(move || write_config_and_run(&setup, None, "sync")).await?
}

/// Explicit user action: replaces the installed cmrs with the latest release.
pub async fn update(http: &HttpClientHandler) -> Result<(), String> {
    install_latest(http, None).await
}

/// Removes our config, then syncs with a cached cmrsSetup, preferring the installed release's own.
pub fn unregister_offline() {
    let Some(path) = config_path().filter(|path| path.is_file()) else {
        return;
    };
    let _ = std::fs::remove_file(path);

    let installed = installed();
    let preferred = match installed {
        Installed::Known(index) => Some(index),
        _ => None,
    };
    let setup = preferred
        .into_iter()
        .chain((0..RELEASES.len()).rev())
        .find_map(|index| {
            let release = &RELEASES[index];
            download_path(release, Part::Setup).filter(|path| matches(path, release, Part::Setup))
        });

    if let Some(setup) = setup.filter(|_| !matches!(installed, Installed::Missing)) {
        if let Err(err) = run_setup(&setup, "sync") {
            eprintln!("Failed to unregister the Windows 11 context menu entry: {err}");
        }
    }
}
