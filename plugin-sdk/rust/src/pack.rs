//! Builds a plugin crate to `plugin.wasm` and writes its `.rosemyne-plugin` file.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::manifest::{
    check_wasm, PluginManifest, ICON_FILE, MANIFEST_FILE, MAX_ICON_BYTES, MAX_MANIFEST_BYTES, MAX_WASM_BYTES,
    WASM_FILE,
};

const WASM_TARGET: &str = "wasm32-unknown-unknown";

/// Runs `cargo build --release` for wasm in `folder` and copies the result to `plugin.wasm` there.
pub fn build_plugin(folder: &Path) -> Result<PathBuf, String> {
    if !folder.join("Cargo.toml").is_file() {
        return Err(format!("{} has no Cargo.toml", folder.display()));
    }

    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let output = Command::new(cargo)
        .current_dir(folder)
        .args(["build", "--release", "--target", WASM_TARGET, "--message-format=json-render-diagnostics"])
        .stderr(Stdio::inherit())
        .output()
        .map_err(|err| format!("Couldn't run cargo: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "cargo build failed. If the {WASM_TARGET} target is missing, run: rustup target add {WASM_TARGET}"
        ));
    }

    let built = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|message| message["reason"] == "compiler-artifact")
        .flat_map(|message| {
            message["filenames"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|name| name.as_str().map(PathBuf::from))
                .collect::<Vec<_>>()
        })
        .filter(|path| path.extension().is_some_and(|extension| extension == "wasm"))
        .last()
        .ok_or("The crate built no .wasm file. Its Cargo.toml needs [lib] crate-type = [\"cdylib\"]")?;

    let target = folder.join(WASM_FILE);
    std::fs::copy(&built, &target).map_err(|err| format!("Couldn't write {WASM_FILE}: {err}"))?;
    Ok(target)
}

fn read_limited(folder: &Path, name: &str, limit: u64) -> Result<Option<Vec<u8>>, String> {
    let file = match std::fs::File::open(folder.join(name)) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("Couldn't read {name}: {err}")),
    };
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("Couldn't read {name}: {err}"))?;
    if bytes.len() as u64 > limit {
        return Err(format!("{name} is larger than {} KB", limit / 1024));
    }
    Ok(Some(bytes))
}

/// Checks the plugin in `folder` and writes its package. `output` defaults to
/// `<folder>/<id>-<version>.rosemyne-plugin`. Returns where it was written.
pub fn pack_plugin(folder: &Path, output: Option<&Path>) -> Result<PathBuf, String> {
    let manifest_raw = read_limited(folder, MANIFEST_FILE, MAX_MANIFEST_BYTES)?
        .ok_or_else(|| format!("{} has no {MANIFEST_FILE}", folder.display()))?;
    let wasm = read_limited(folder, WASM_FILE, MAX_WASM_BYTES)?
        .ok_or_else(|| format!("{} has no {WASM_FILE}", folder.display()))?;
    let icon = read_limited(folder, ICON_FILE, MAX_ICON_BYTES)?;

    let manifest = PluginManifest::parse(&manifest_raw)?;
    manifest.validate_shape()?;
    check_wasm(&wasm)?;

    let path = output.map_or_else(|| folder.join(manifest.package_file_name()), Path::to_path_buf);
    let file = std::fs::File::create(&path).map_err(|err| format!("Couldn't write {}: {err}", path.display()))?;

    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut archive = zip::ZipWriter::new(file);
    let entries = [(MANIFEST_FILE, Some(manifest_raw)), (WASM_FILE, Some(wasm)), (ICON_FILE, icon)];
    for (name, bytes) in entries {
        let Some(bytes) = bytes else { continue };
        archive
            .start_file(name, options)
            .and_then(|()| archive.write_all(&bytes).map_err(Into::into))
            .map_err(|err| format!("Couldn't write {name} into the package: {err}"))?;
    }
    archive.finish().map_err(|err| format!("Couldn't finish the package: {err}"))?;
    Ok(path)
}
