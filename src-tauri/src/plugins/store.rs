use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};

use super::manifest::PluginManifest;

const SCHEMA: &str = "\
CREATE TABLE IF NOT EXISTS plugins (
  id              TEXT PRIMARY KEY,
  version         TEXT NOT NULL,
  manifest        TEXT NOT NULL,
  wasm_sha256     TEXT NOT NULL,
  enabled         INTEGER NOT NULL,
  dev             INTEGER NOT NULL,
  dev_path        TEXT,
  position        INTEGER NOT NULL,
  installed_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plugin_kv (
  plugin_id TEXT NOT NULL,
  key       TEXT NOT NULL,
  value     BLOB NOT NULL,
  PRIMARY KEY (plugin_id, key)
);
CREATE TABLE IF NOT EXISTS plugin_uploaders (
  plugin_id   TEXT NOT NULL,
  uploader_id TEXT NOT NULL,
  auto_upload INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, uploader_id)
);";

pub const KV_TOTAL_BYTES: usize = 1024 * 1024 * 1024;
pub const KV_VALUE_BYTES: usize = 256 * 1024 * 1024;
pub const KV_KEY_BYTES: usize = 256;
pub const SETTING_PREFIX: &str = "settings.";

#[derive(Debug, Clone)]
pub struct PluginRow {
    pub id: String,
    pub manifest: PluginManifest,
    pub wasm_sha256: String,
    pub enabled: bool,
    pub dev: bool,
    pub dev_path: Option<PathBuf>,
}

pub struct PluginStore {
    conn: Mutex<Connection>,
    kv_total_bytes: usize,
}

type StoreResult<T> = Result<T, String>;

fn sql(err: rusqlite::Error) -> String {
    format!("Plugin database error: {err}")
}

impl PluginStore {
    pub fn open(base_path: &Path) -> StoreResult<Self> {
        std::fs::create_dir_all(base_path).map_err(|err| err.to_string())?;
        Self::from_conn(Connection::open(base_path.join("plugins.db")).map_err(sql)?)
    }

    #[cfg(test)]
    pub fn in_memory() -> Self {
        Self::from_conn(Connection::open_in_memory().unwrap()).unwrap()
    }

    #[cfg(test)]
    fn in_memory_with_quota(kv_total_bytes: usize) -> Self {
        Self { kv_total_bytes, ..Self::in_memory() }
    }

    fn from_conn(conn: Connection) -> StoreResult<Self> {
        conn.execute_batch(SCHEMA).map_err(sql)?;
        Ok(Self { conn: Mutex::new(conn), kv_total_bytes: KV_TOTAL_BYTES })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("plugin store not poisoned")
    }

    pub fn list(&self) -> StoreResult<Vec<PluginRow>> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, manifest, wasm_sha256, enabled, dev, dev_path FROM plugins ORDER BY position, id",
            )
            .map_err(sql)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, bool>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            })
            .map_err(sql)?;

        let mut plugins = Vec::new();
        for row in rows {
            let (id, manifest, wasm_sha256, enabled, dev, dev_path) = row.map_err(sql)?;
            let manifest = match serde_json::from_str::<PluginManifest>(&manifest) {
                Ok(manifest) => manifest,
                Err(err) => {
                    eprintln!("Stored manifest of plugin {id} can't be read: {err}");
                    continue;
                }
            };
            plugins.push(PluginRow {
                id,
                manifest,
                wasm_sha256,
                enabled,
                dev,
                dev_path: dev_path.map(PathBuf::from),
            });
        }
        Ok(plugins)
    }

    /// Inserts a new plugin at the end of the list, or replaces an installed one in place
    /// (keeping its position, enabled state and storage).
    pub fn upsert(
        &self,
        manifest: &PluginManifest,
        wasm_sha256: &str,
        dev_path: Option<&Path>,
        now_ms: i64,
    ) -> StoreResult<()> {
        let conn = self.lock();
        let manifest_json = serde_json::to_string(manifest).map_err(|err| err.to_string())?;
        let dev_path = dev_path.map(|path| path.to_string_lossy().into_owned());
        conn.execute(
            "INSERT INTO plugins (id, version, manifest, wasm_sha256, enabled, dev, dev_path, position, installed_at_ms) \
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, (SELECT COALESCE(MAX(position), 0) + 1 FROM plugins), ?7) \
             ON CONFLICT(id) DO UPDATE SET version = ?2, manifest = ?3, wasm_sha256 = ?4, dev = ?5, dev_path = ?6",
            params![manifest.id, manifest.version, manifest_json, wasm_sha256, dev_path.is_some(), dev_path, now_ms],
        )
        .map_err(sql)?;
        Ok(())
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> StoreResult<()> {
        self.lock()
            .execute("UPDATE plugins SET enabled = ?1 WHERE id = ?2", params![enabled, id])
            .map_err(sql)?;
        Ok(())
    }

    pub fn set_order(&self, ids: &[String]) -> StoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(sql)?;
        for (index, id) in ids.iter().enumerate() {
            tx.execute("UPDATE plugins SET position = ?1 WHERE id = ?2", params![index as i64 + 1, id])
                .map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }

    pub fn delete(&self, id: &str, delete_data: bool) -> StoreResult<()> {
        let conn = self.lock();
        conn.execute("DELETE FROM plugins WHERE id = ?1", [id]).map_err(sql)?;
        conn.execute("DELETE FROM plugin_uploaders WHERE plugin_id = ?1", [id]).map_err(sql)?;
        if delete_data {
            conn.execute("DELETE FROM plugin_kv WHERE plugin_id = ?1", [id]).map_err(sql)?;
        }
        Ok(())
    }

    pub fn kv_get(&self, plugin_id: &str, key: &str) -> StoreResult<Option<Vec<u8>>> {
        self.lock()
            .query_row(
                "SELECT value FROM plugin_kv WHERE plugin_id = ?1 AND key = ?2",
                params![plugin_id, key],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)
    }

    pub fn kv_set(&self, plugin_id: &str, key: &str, value: &[u8]) -> StoreResult<()> {
        if key.is_empty() || key.len() > KV_KEY_BYTES {
            return Err(format!("Storage keys must be 1 to {KV_KEY_BYTES} bytes"));
        }
        if value.len() > KV_VALUE_BYTES {
            return Err(format!("A stored value can't be larger than {} MB", KV_VALUE_BYTES / (1024 * 1024)));
        }

        let conn = self.lock();
        let others: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(key) + LENGTH(value)), 0) FROM plugin_kv WHERE plugin_id = ?1 AND key != ?2",
                params![plugin_id, key],
                |row| row.get(0),
            )
            .map_err(sql)?;
        if others as usize + key.len() + value.len() > self.kv_total_bytes {
            return Err(format!("Plugin storage is full ({} MB)", self.kv_total_bytes / (1024 * 1024)));
        }

        conn.execute(
            "INSERT INTO plugin_kv (plugin_id, key, value) VALUES (?1, ?2, ?3) \
             ON CONFLICT(plugin_id, key) DO UPDATE SET value = ?3",
            params![plugin_id, key, value],
        )
        .map_err(sql)?;
        Ok(())
    }

    pub fn kv_delete(&self, plugin_id: &str, key: &str) -> StoreResult<()> {
        self.lock()
            .execute("DELETE FROM plugin_kv WHERE plugin_id = ?1 AND key = ?2", params![plugin_id, key])
            .map_err(sql)?;
        Ok(())
    }

    pub fn kv_keys(&self, plugin_id: &str, prefix: &str) -> StoreResult<Vec<String>> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare("SELECT key FROM plugin_kv WHERE plugin_id = ?1 AND substr(key, 1, ?2) = ?3 ORDER BY key")
            .map_err(sql)?;
        let keys = stmt
            .query_map(params![plugin_id, prefix.chars().count() as i64, prefix], |row| row.get(0))
            .map_err(sql)?
            .collect::<Result<Vec<String>, _>>()
            .map_err(sql)?;
        Ok(keys)
    }

    pub fn uploader_auto_upload(&self, plugin_id: &str, uploader_id: &str) -> bool {
        self.lock()
            .query_row(
                "SELECT auto_upload FROM plugin_uploaders WHERE plugin_id = ?1 AND uploader_id = ?2",
                params![plugin_id, uploader_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()
            .ok()
            .flatten()
            .unwrap_or(true)
    }

    pub fn set_uploader_auto_upload(&self, plugin_id: &str, uploader_id: &str, enabled: bool) -> StoreResult<()> {
        self.lock()
            .execute(
                "INSERT INTO plugin_uploaders (plugin_id, uploader_id, auto_upload) VALUES (?1, ?2, ?3) \
                 ON CONFLICT(plugin_id, uploader_id) DO UPDATE SET auto_upload = ?3",
                params![plugin_id, uploader_id, enabled],
            )
            .map_err(sql)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_is_separate_per_plugin() {
        let store = PluginStore::in_memory();
        store.kv_set("a", "token", b"secret-a").unwrap();
        store.kv_set("b", "token", b"secret-b").unwrap();

        assert_eq!(store.kv_get("a", "token").unwrap().unwrap(), b"secret-a");
        assert_eq!(store.kv_get("b", "token").unwrap().unwrap(), b"secret-b");
        assert_eq!(store.kv_keys("a", "").unwrap(), vec!["token"]);
    }

    #[test]
    fn the_quota_counts_everything_a_plugin_stored() {
        let store = PluginStore::in_memory_with_quota(5 * 1024);
        let chunk = vec![0u8; 1024];
        for index in 0..4 {
            store.kv_set("a", &format!("chunk{index}"), &chunk).unwrap();
        }
        assert!(store.kv_set("a", "chunk4", &chunk).is_err());

        // Replacing an existing value doesn't count it twice.
        assert!(store.kv_set("a", "chunk0", &chunk).is_ok());
        // Another plugin's quota is untouched.
        assert!(store.kv_set("b", "chunk0", &chunk).is_ok());
    }

    #[test]
    fn an_oversized_value_is_refused() {
        let store = PluginStore::in_memory();
        assert!(store.kv_set("a", "big", &vec![0u8; KV_VALUE_BYTES + 1]).is_err());
    }

    #[test]
    fn key_listing_treats_the_prefix_literally() {
        let store = PluginStore::in_memory();
        store.kv_set("a", "cache_1", b"1").unwrap();
        store.kv_set("a", "cacheX1", b"1").unwrap();
        assert_eq!(store.kv_keys("a", "cache_").unwrap(), vec!["cache_1"]);
    }
}
