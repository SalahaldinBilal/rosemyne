use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

use super::manifest::{MAX_ICON_BYTES, MAX_MANIFEST_BYTES, MAX_WASM_BYTES, PluginManifest, check_wasm};
pub use super::manifest::{ICON_FILE, MANIFEST_FILE, WASM_FILE};

pub struct Package {
    pub manifest: PluginManifest,
    pub manifest_raw: Vec<u8>,
    pub wasm: Vec<u8>,
    pub icon: Option<Vec<u8>>,
}

impl Package {
    pub fn wasm_sha256(&self) -> String {
        sha256_hex(&self.wasm)
    }

    /// Writes the three known files into `dir`. Names are fixed, never taken from the package.
    pub fn write_to(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        std::fs::write(dir.join(MANIFEST_FILE), &self.manifest_raw)?;
        std::fs::write(dir.join(WASM_FILE), &self.wasm)?;
        let icon_path = dir.join(ICON_FILE);
        match &self.icon {
            Some(icon) => std::fs::write(icon_path, icon)?,
            None => match std::fs::remove_file(icon_path) {
                Err(err) if err.kind() != std::io::ErrorKind::NotFound => return Err(err),
                _ => {}
            },
        }
        Ok(())
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn read_package(path: &Path, app_version: &str) -> Result<Package, String> {
    let file = std::fs::File::open(path).map_err(|err| format!("Couldn't open the plugin file: {err}"))?;
    read_package_from(file, app_version)
}

pub fn read_package_from<R: Read + std::io::Seek>(reader: R, app_version: &str) -> Result<Package, String> {
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|_| "This is not a Rosemyne plugin file".to_string())?;

    let manifest_raw = read_entry(&mut archive, MANIFEST_FILE, MAX_MANIFEST_BYTES)?
        .ok_or("The plugin file has no plugin.json")?;
    let wasm = read_entry(&mut archive, WASM_FILE, MAX_WASM_BYTES)?
        .ok_or("The plugin file has no plugin.wasm")?;
    let icon = read_entry(&mut archive, ICON_FILE, MAX_ICON_BYTES)?;

    finish(manifest_raw, wasm, icon, app_version)
}

/// A plugin author's build folder, loaded in place.
pub fn read_unpacked(dir: &Path, app_version: &str) -> Result<Package, String> {
    let manifest_raw = read_file(&dir.join(MANIFEST_FILE), MAX_MANIFEST_BYTES)?
        .ok_or("The folder has no plugin.json")?;
    let wasm = read_file(&dir.join(WASM_FILE), MAX_WASM_BYTES)?.ok_or("The folder has no plugin.wasm")?;
    let icon = read_file(&dir.join(ICON_FILE), MAX_ICON_BYTES)?;

    finish(manifest_raw, wasm, icon, app_version)
}

fn finish(
    manifest_raw: Vec<u8>,
    wasm: Vec<u8>,
    icon: Option<Vec<u8>>,
    app_version: &str,
) -> Result<Package, String> {
    let manifest = PluginManifest::parse(&manifest_raw)?;
    manifest.validate(app_version)?;
    check_wasm(&wasm)?;

    Ok(Package { manifest, manifest_raw, wasm, icon })
}

fn read_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
    limit: u64,
) -> Result<Option<Vec<u8>>, String> {
    let entry = match archive.by_name(name) {
        Ok(entry) => entry,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(err) => return Err(format!("Couldn't read {name} from the plugin file: {err}")),
    };
    read_limited(entry, name, limit).map(Some)
}

fn read_file(path: &Path, limit: u64) -> Result<Option<Vec<u8>>, String> {
    let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default().to_owned();
    match std::fs::File::open(path) {
        Ok(file) => read_limited(file, &name, limit).map(Some),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("Couldn't read {name}: {err}")),
    }
}

// The size in a zip header can lie, so the limit is enforced on what is actually read.
fn read_limited(reader: impl Read, name: &str, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("Couldn't read {name}: {err}"))?;
    if bytes.len() as u64 > limit {
        return Err(format!("{name} is larger than {} MB", limit.div_ceil(1024 * 1024)));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    const MANIFEST: &str = r#"{"apiVersion":1,"id":"com.example.test","name":"Test","version":"1.0.0"}"#;
    const WASM: &[u8] = b"\0asm\x01\0\0\0";

    fn zip_of(entries: &[(&str, &[u8])]) -> Cursor<Vec<u8>> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap()
    }

    #[test]
    fn a_well_formed_package_is_read() {
        let package = read_package_from(
            zip_of(&[(MANIFEST_FILE, MANIFEST.as_bytes()), (WASM_FILE, WASM)]),
            "0.3.3",
        )
        .unwrap();
        assert_eq!(package.manifest.id, "com.example.test");
        assert_eq!(package.wasm, WASM);
        assert!(package.icon.is_none());
    }

    #[test]
    fn entries_with_other_names_never_reach_disk() {
        let dir = std::env::temp_dir().join(format!("rosemyne-plugin-test-{}", rand::random::<u64>()));
        let package = read_package_from(
            zip_of(&[
                (MANIFEST_FILE, MANIFEST.as_bytes()),
                (WASM_FILE, WASM),
                ("../escaped.txt", b"nope"),
                ("nested/extra.dll", b"nope"),
            ]),
            "0.3.3",
        )
        .unwrap();
        package.write_to(&dir.join("plugin")).unwrap();

        let written: Vec<String> = std::fs::read_dir(dir.join("plugin"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(written.len(), 2);
        assert!(!dir.join("escaped.txt").exists());

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_package_without_wasm_is_refused() {
        let result = read_package_from(zip_of(&[(MANIFEST_FILE, MANIFEST.as_bytes())]), "0.3.3");
        assert!(result.is_err());
    }

    #[test]
    fn a_wasm_entry_that_is_not_wasm_is_refused() {
        let result = read_package_from(
            zip_of(&[(MANIFEST_FILE, MANIFEST.as_bytes()), (WASM_FILE, b"MZ not wasm")]),
            "0.3.3",
        );
        assert!(result.is_err());
    }

    #[test]
    fn an_oversized_manifest_is_refused() {
        let huge = vec![b' '; MAX_MANIFEST_BYTES as usize + 1];
        let result = read_package_from(zip_of(&[(MANIFEST_FILE, &huge), (WASM_FILE, WASM)]), "0.3.3");
        assert!(result.is_err());
    }

    #[test]
    fn what_the_packer_writes_is_what_the_app_reads() {
        let dir = std::env::temp_dir().join(format!("rosemyne-pack-test-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(MANIFEST_FILE), MANIFEST).unwrap();
        std::fs::write(dir.join(WASM_FILE), WASM).unwrap();
        std::fs::write(dir.join(ICON_FILE), b"icon bytes").unwrap();

        let packed = rosemyne_plugin::pack::pack_plugin(&dir, None).unwrap();
        assert_eq!(packed.file_name().unwrap(), "com.example.test-1.0.0.rosemyne-plugin");

        let package = read_package(&packed, "0.3.3").unwrap();
        assert_eq!(package.manifest_raw, MANIFEST.as_bytes());
        assert_eq!(package.wasm, WASM);
        assert_eq!(package.icon.as_deref(), Some(&b"icon bytes"[..]));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_file_that_is_not_a_zip_is_refused() {
        let result = read_package_from(Cursor::new(b"definitely not a zip".to_vec()), "0.3.3");
        assert!(result.is_err());
    }
}
