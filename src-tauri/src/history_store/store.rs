use std::collections::HashSet;
use std::error::Error;
use std::fmt::Display;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Datelike, Local, Timelike, Utc};
use image::{ImageFormat, RgbaImage};
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension, Row, params, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error_serializers::error_serialize;
use crate::screen_manager::screenshot_manager::{HistoryItemType, ImageHistoryData, encode_image_as};

use super::compile::{collect_index_entries, compile};
use super::filter::{FilterNode, FilterSlot, register_filter_match};
use super::metadata::{MetadataBuilder, TagMetadata, collect_scalars, merge_schema};

const SCHEMA: &str = "\
CREATE TABLE IF NOT EXISTS history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name    TEXT NOT NULL UNIQUE,
  file_path    TEXT NOT NULL,
  type         TEXT NOT NULL,
  date_time_ms INTEGER NOT NULL,
  host         TEXT,
  url          TEXT,
  deletion_url TEXT,
  tags         TEXT,
  file_size    INTEGER,
  upload_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_date ON history(date_time_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_history_name ON history(file_name COLLATE NOCASE, id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tag_value_counts (
  path  TEXT NOT NULL,
  value TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (path, value)
);
CREATE TABLE IF NOT EXISTS tag_index (
  history_id INTEGER NOT NULL,
  path       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  value_text TEXT,
  value_num  REAL
);
CREATE INDEX IF NOT EXISTS idx_tag_index_text ON tag_index(path, kind, value_text, history_id);
CREATE INDEX IF NOT EXISTS idx_tag_index_num ON tag_index(path, kind, value_num, history_id);
CREATE INDEX IF NOT EXISTS idx_tag_index_row ON tag_index(history_id);";

const COLUMNS: &str =
    "file_name, file_path, type, date_time_ms, host, url, deletion_url, tags, file_size, upload_error";

const INSERT_TAG_INDEX: &str =
    "INSERT INTO tag_index (history_id, path, kind, value_text, value_num) VALUES (?1, ?2, ?3, ?4, ?5)";

// Bumped when the derived tables change shape so existing databases rebuild.
// Just needs to change whenever the shape does , not a meaningful version count.
const METADATA_STATUS_BUILT: &str = "built-v1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub items: Vec<ImageHistoryData>,
    /// Computed only on the first page (no cursor); later pages reuse it.
    pub total: Option<u64>,
    pub next_cursor: Option<HistoryCursor>,
}

/// Keyset cursor: the sort column's value on the last row (number for date,
/// string for name) plus the row id as tiebreak.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCursor {
    pub key: Value,
    pub id: i64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortField {
    Date,
    Name,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySort {
    pub field: SortField,
    pub direction: SortDirection,
}

impl Default for HistorySort {
    fn default() -> Self {
        Self { field: SortField::Date, direction: SortDirection::Desc }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagValueSuggestion {
    pub value: Value,
    pub count: i64,
}

struct Inner {
    conn: Connection,
    base_path: PathBuf,
}

pub struct HistoryStore {
    inner: Mutex<Inner>,
    filter_slot: FilterSlot,
}

impl HistoryStore {
    pub fn new(base_path: PathBuf) -> Result<Self, HistoryError> {
        std::fs::create_dir_all(&base_path)?;
        let filter_slot: FilterSlot = Arc::new(Mutex::new(None));
        let conn = open_conn(&base_path, filter_slot.clone())?;
        Ok(Self {
            inner: Mutex::new(Inner { conn, base_path }),
            filter_slot,
        })
    }

    pub fn get_by_file_name(&self, file_name: &str) -> Result<Option<ImageHistoryData>, HistoryError> {
        let inner = self.lock();
        let entry = inner
            .conn
            .prepare_cached(&format!("SELECT {COLUMNS} FROM history WHERE file_name = ?1"))?
            .query_row([file_name], row_to_entry)
            .optional()?;
        Ok(entry)
    }

    /// Encodes + writes the rendered image under `images/` with a unique,
    /// template-expanded name and inserts the row.
    pub fn save_rendered(
        &self,
        image: &RgbaImage,
        tags: Option<std::collections::HashMap<String, crate::screen_manager::screenshot_manager::TagValue>>,
        upload_template: Option<&str>,
        file_name_template: Option<&str>,
        format: crate::screen_manager::screenshot_manager::ScreenshotImageFormat,
    ) -> Result<ImageHistoryData, HistoryError> {
        let inner = self.lock();
        let date_time = Utc::now();
        let local_time = date_time.with_timezone(&Local);
        let dir = expand_save_dir(&inner.base_path, upload_template, local_time, HistoryItemType::Image);
        std::fs::create_dir_all(&dir)?;

        let tags_value = tags
            .as_ref()
            .map(|map| serde_json::to_value(map).unwrap_or(Value::Null));

        let file_name = unique_file_name(
            &inner.conn,
            &dir,
            file_name_template,
            local_time,
            tags_value.as_ref(),
            image.width(),
            image.height(),
            format.extension(),
        )?;
        let file_path = dir.join(&file_name);

        let bytes = encode_image_as(image, format.as_image_format()).map_err(|err| HistoryError::Encode(err.to_string()))?;
        std::fs::write(&file_path, &bytes)?;
        let file_size = bytes.len() as u64;

        insert_history_row(
            &inner.conn,
            &file_name,
            &file_path,
            HistoryItemType::Image,
            date_time,
            tags_value.as_ref(),
            Some(file_size),
        )?;

        Ok(ImageHistoryData {
            file_name,
            file_path,
            item_type: HistoryItemType::Image,
            date_time,
            tags,
            file_size: Some(file_size),
            host: None,
            url: None,
            deletion_url: None,
            upload_error: None,
        })
    }

    /// Moves a finished recording from its temp path to a template-expanded
    /// final name, writes its WebP thumbnail, and records the row (with the
    /// same derived-tag-table maintenance as `save_rendered`).
    pub fn save_recording(
        &self,
        temp_path: &Path,
        thumbnail: Option<&RgbaImage>,
        tags: Option<std::collections::HashMap<String, crate::screen_manager::screenshot_manager::TagValue>>,
        upload_template: Option<&str>,
        file_name_template: Option<&str>,
        width: u32,
        height: u32,
    ) -> Result<ImageHistoryData, HistoryError> {
        let inner = self.lock();
        let date_time = Utc::now();
        let local_time = date_time.with_timezone(&Local);
        let dir = expand_save_dir(&inner.base_path, upload_template, local_time, HistoryItemType::Video);
        std::fs::create_dir_all(&dir)?;

        let tags_value = tags
            .as_ref()
            .map(|map| serde_json::to_value(map).unwrap_or(Value::Null));

        let file_name = unique_file_name(
            &inner.conn,
            &dir,
            file_name_template,
            local_time,
            tags_value.as_ref(),
            width,
            height,
            "mp4",
        )?;
        let file_path = dir.join(&file_name);

        std::fs::rename(temp_path, &file_path)?;
        let file_size = std::fs::metadata(&file_path).map(|meta| meta.len()).ok();

        if let Some(thumbnail) = thumbnail {
            if let Err(err) = write_thumbnail(&inner.base_path, &file_name, thumbnail) {
                eprintln!("Failed to write the recording thumbnail: {}", err);
            }
        }

        insert_history_row(
            &inner.conn,
            &file_name,
            &file_path,
            HistoryItemType::Video,
            date_time,
            tags_value.as_ref(),
            file_size,
        )?;

        Ok(ImageHistoryData {
            file_name,
            file_path,
            item_type: HistoryItemType::Video,
            date_time,
            tags,
            file_size,
            host: None,
            url: None,
            deletion_url: None,
            upload_error: None,
        })
    }

    /// Absolute path a thumbnail for this file would live at, or `None` when
    /// the name tries to escape the thumbnails directory (the URI scheme
    /// passes untrusted names through here).
    pub fn thumbnail_path(&self, file_name: &str) -> Option<PathBuf> {
        if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
            return None;
        }
        Some(thumbnail_path_in(&self.lock().base_path, file_name))
    }

    /// Stores an already-encoded WebP thumbnail for an existing history entry
    /// (the frontend generates these lazily for imported videos).
    pub fn save_thumbnail_bytes(&self, file_name: &str, bytes: &[u8]) -> Result<(), HistoryError> {
        let inner = self.lock();
        if !name_exists(&inner.conn, file_name)? {
            return Err(HistoryError::Task(format!("{file_name} is not in the history")));
        }

        std::fs::create_dir_all(inner.base_path.join("thumbnails"))?;
        std::fs::write(thumbnail_path_in(&inner.base_path, file_name), bytes)?;
        Ok(())
    }

    /// Renders a small (max 128px) PNG preview to use as a native drag-and-drop
    /// icon, so dragging a card out doesn't drag the full-resolution image as
    /// the cursor preview. Returns `None` when there's nothing to render from
    /// (a generic imported file, or a video whose thumbnail hasn't been
    /// generated yet) , the caller should fall back to no custom icon then.
    pub fn drag_icon_path(&self, file_name: &str) -> Result<Option<PathBuf>, HistoryError> {
        let entry = match self.get_by_file_name(file_name)? {
            Some(entry) => entry,
            None => return Ok(None),
        };

        let source_bytes = match entry.item_type {
            HistoryItemType::Image => std::fs::read(&entry.file_path).ok(),
            HistoryItemType::Video => self
                .thumbnail_path(file_name)
                .and_then(|path| std::fs::read(path).ok()),
            HistoryItemType::File => None,
        };

        let Some(bytes) = source_bytes else {
            return Ok(None);
        };

        let image =
            image::load_from_memory(&bytes).map_err(|err| HistoryError::Encode(err.to_string()))?;
        let icon = image.thumbnail(128, 128);

        let mut png_bytes = Vec::new();
        icon.write_to(&mut std::io::Cursor::new(&mut png_bytes), ImageFormat::Png)
            .map_err(|err| HistoryError::Encode(err.to_string()))?;

        let icon_path = std::env::temp_dir().join(format!("rosemyne-drag-icon-{file_name}.png"));
        std::fs::write(&icon_path, &png_bytes)?;

        Ok(Some(icon_path))
    }

    /// Copies a user-provided file into storage (under the templated `files/`
    /// dir), classifying it by extension, and records a history row. Returns
    /// `None` without copying/recording anything when `source` already lives
    /// under our own storage tree (e.g. a card's native OS drag dropped back
    /// onto this window) , that's not a new file, so re-importing it would
    /// just duplicate it.
    pub fn import_file(
        &self,
        source: &Path,
        upload_template: Option<&str>,
    ) -> Result<Option<ImageHistoryData>, HistoryError> {
        let inner = self.lock();
        if let (Ok(canonical_source), Ok(canonical_base)) = (
            std::fs::canonicalize(source),
            std::fs::canonicalize(&inner.base_path),
        ) {
            if canonical_source.starts_with(&canonical_base) {
                return Ok(None);
            }
        }

        let item_type = source
            .extension()
            .and_then(|ext| ext.to_str())
            .and_then(HistoryItemType::from_extension)
            .unwrap_or(HistoryItemType::File);

        let original = source
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_string())
            .unwrap_or_else(|| "imported-file".to_string());

        let date_time = Utc::now();
        let dir = expand_save_dir(
            &inner.base_path,
            upload_template,
            date_time.with_timezone(&Local),
            item_type,
        );
        std::fs::create_dir_all(&dir)?;

        let file_name = unique_name_from(&inner.conn, &dir, &original)?;
        let file_path = dir.join(&file_name);

        let file_size = std::fs::copy(source, &file_path)?;

        insert_history_row(
            &inner.conn,
            &file_name,
            &file_path,
            item_type,
            date_time,
            None,
            Some(file_size),
        )?;

        Ok(Some(ImageHistoryData {
            file_name,
            file_path,
            item_type,
            date_time,
            tags: None,
            file_size: Some(file_size),
            host: None,
            url: None,
            deletion_url: None,
            upload_error: None,
        }))
    }

    /// Bulk insert (ShareX import) in a single transaction.
    pub fn insert_batch(&self, entries: Vec<ImageHistoryData>) -> Result<(), HistoryError> {
        let mut inner = self.lock();
        let tx = inner.conn.transaction()?;
        let mut schema = load_schema(&tx)?;
        {
            let mut stmt = tx.prepare(&format!(
                "INSERT INTO history ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
            ))?;
            let mut bump = tx.prepare(
                "INSERT INTO tag_value_counts (path, value, count) VALUES (?1, ?2, 1) \
                 ON CONFLICT(path, value) DO UPDATE SET count = count + 1",
            )?;
            let mut index_insert = tx.prepare(INSERT_TAG_INDEX)?;
            for entry in &entries {
                stmt.execute(params![
                    entry.file_name,
                    entry.file_path.to_string_lossy().into_owned(),
                    entry.item_type.as_str(),
                    entry.date_time.timestamp_millis(),
                    entry.host,
                    entry.url,
                    entry.deletion_url,
                    entry.tags.as_ref().map(serialize_tags),
                    entry.file_size.map(|size| size as i64),
                    entry.upload_error.as_ref().map(|value| value.to_string()),
                ])?;

                if let Some(map) = &entry.tags {
                    let history_id = tx.last_insert_rowid();
                    let tags_value = serde_json::to_value(map).unwrap_or(Value::Null);
                    merge_schema(&tags_value, &mut schema);
                    for (path, scalar) in collect_scalars(&tags_value) {
                        bump.execute(params![path, scalar.to_string()])?;
                    }
                    for index_entry in collect_index_entries(&tags_value) {
                        index_insert.execute(params![
                            history_id,
                            index_entry.path,
                            index_entry.kind,
                            index_entry.text,
                            index_entry.num,
                        ])?;
                    }
                }
            }
        }
        save_schema(&tx, &schema)?;

        tx.commit()?;
        Ok(())
    }

    /// Removes the file then the row; a missing file is fine, other IO errors
    /// keep the row (parity with the old `delete_saved_image`).
    pub fn delete_with_file(&self, file_name: &str) -> Result<(), HistoryError> {
        let inner = self.lock();
        let row: Option<(i64, String, Option<String>)> = inner
            .conn
            .query_row(
                "SELECT id, file_path, tags FROM history WHERE file_name = ?1",
                [file_name],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;

        let Some((history_id, path, tags_raw)) = row else {
            return Ok(());
        };

        match std::fs::remove_file(&path) {
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(err.into()),
        }

        // A stale thumbnail is only wasted disk, never a kept row.
        match std::fs::remove_file(thumbnail_path_in(&inner.base_path, file_name)) {
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => eprintln!("Failed to delete the thumbnail for {file_name}: {err}"),
        }

        inner.conn.execute("DELETE FROM history WHERE file_name = ?1", [file_name])?;
        inner.conn.execute("DELETE FROM tag_index WHERE history_id = ?1", [history_id])?;

        if let Some(raw) = tags_raw {
            if let Ok(tags_value) = serde_json::from_str::<Value>(&raw) {
                unrecord_tags(&inner.conn, &tags_value)?;
            }
        }

        Ok(())
    }

    pub fn set_upload_result(&self, file_name: &str, host: &str, url: &str) -> Result<(), HistoryError> {
        self.lock().conn.execute(
            "UPDATE history SET host = ?1, url = ?2, upload_error = NULL WHERE file_name = ?3",
            params![host, url, file_name],
        )?;
        Ok(())
    }

    /// Records a failed upload attempt so the status survives a restart until
    /// retried; `error_json` is the serialized `UploaderError`.
    pub fn set_upload_error(&self, file_name: &str, error_json: &str) -> Result<(), HistoryError> {
        self.lock().conn.execute(
            "UPDATE history SET upload_error = ?1 WHERE file_name = ?2",
            params![error_json, file_name],
        )?;
        Ok(())
    }

    pub fn existing_file_names(&self) -> Result<HashSet<String>, HistoryError> {
        let inner = self.lock();
        let mut stmt = inner.conn.prepare("SELECT file_name FROM history")?;
        let names = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .map(|name| name.map(|n| n.to_lowercase()))
            .collect::<rusqlite::Result<HashSet<_>>>()?;
        Ok(names)
    }

    /// Keyset-paginated page query. The filter tree is compiled to an indexed
    /// SQL prefilter over `tag_index` (and `$file` conditions to plain column
    /// predicates); only when the compilation is inexact (tag negations,
    /// fuzzy) does the `filter_match` residual run , and then only on rows
    /// passing the prefilter.
    pub fn query(
        &self,
        filter: FilterNode,
        sort: Option<HistorySort>,
        cursor: Option<HistoryCursor>,
        limit: u32,
    ) -> Result<HistoryPage, HistoryError> {
        let sort = sort.unwrap_or_default();
        let inner = self.lock();
        let compiled = compile(&filter);

        *self.filter_slot.lock().expect("filter slot not poisoned") =
            (!compiled.exact).then(|| Arc::new(filter));

        let mut where_expr = compiled.expr;
        if !compiled.exact {
            where_expr.push_str(" AND filter_match(tags, file_name, file_path, type, date_time_ms)");
        }

        let total = match cursor {
            Some(_) => None,
            None => {
                let count: i64 = inner
                    .conn
                    .prepare_cached(&format!("SELECT COUNT(*) FROM history AS h WHERE {where_expr}"))?
                    .query_row(params_from_iter(compiled.params.iter()), |row| row.get(0))?;
                Some(count as u64)
            }
        };

        let op = match sort.direction {
            SortDirection::Asc => ">",
            SortDirection::Desc => "<",
        };
        let dir = match sort.direction {
            SortDirection::Asc => "ASC",
            SortDirection::Desc => "DESC",
        };

        let mut sql = format!("SELECT {COLUMNS}, id FROM history AS h WHERE {where_expr}");
        let mut query_params = compiled.params;
        if let Some(cursor) = &cursor {
            match sort.field {
                SortField::Date => {
                    if let Some(key) = cursor.key.as_i64() {
                        sql.push_str(&format!(" AND (date_time_ms, id) {op} (?, ?)"));
                        query_params.push(SqlValue::Integer(key));
                        query_params.push(SqlValue::Integer(cursor.id));
                    }
                }
                SortField::Name => {
                    if let Some(key) = cursor.key.as_str() {
                        sql.push_str(&format!(
                            " AND (file_name COLLATE NOCASE {op} ? \
                             OR (file_name COLLATE NOCASE = ? AND id {op} ?))"
                        ));
                        query_params.push(SqlValue::Text(key.to_string()));
                        query_params.push(SqlValue::Text(key.to_string()));
                        query_params.push(SqlValue::Integer(cursor.id));
                    }
                }
            }
        }
        match sort.field {
            SortField::Date => sql.push_str(&format!(" ORDER BY date_time_ms {dir}, id {dir}")),
            SortField::Name => sql.push_str(&format!(" ORDER BY file_name COLLATE NOCASE {dir}, id {dir}")),
        }
        sql.push_str(" LIMIT ?");
        query_params.push(SqlValue::Integer(limit as i64));

        let mut stmt = inner.conn.prepare_cached(&sql)?;
        let rows = stmt
            .query_map(params_from_iter(query_params), |row| {
                let date_time_ms: i64 = row.get(3)?;
                let id: i64 = row.get(10)?;
                Ok((row_to_entry(row)?, date_time_ms, id))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);

        *self.filter_slot.lock().expect("filter slot not poisoned") = None;

        let next_cursor = rows.last().map(|(entry, date_time_ms, id)| HistoryCursor {
            key: match sort.field {
                SortField::Date => Value::from(*date_time_ms),
                SortField::Name => Value::from(entry.file_name.clone()),
            },
            id: *id,
        });
        Ok(HistoryPage {
            items: rows.into_iter().map(|(entry, _, _)| entry).collect(),
            total,
            next_cursor,
        })
    }

    /// Autocomplete values for one tag path (or virtual `$file` path), matched
    /// case-insensitively against the cached distinct values, most common first.
    pub fn suggest_tag_values(&self, path: &[String], query: &str) -> Result<Vec<TagValueSuggestion>, HistoryError> {
        let inner = self.lock();
        let pattern = format!("%{}%", escape_like(query));

        if path.len() == 2 && path[0] == "$file" {
            let sql = match path[1].as_str() {
                "Type" => {
                    "SELECT type, COUNT(*) FROM history WHERE type LIKE ?1 ESCAPE '\\' \
                     GROUP BY type ORDER BY 2 DESC, 1 ASC LIMIT 50"
                }
                "Name" => {
                    "SELECT file_name, 1 FROM history WHERE file_name LIKE ?1 ESCAPE '\\' \
                     ORDER BY file_name ASC LIMIT 50"
                }
                "Path" => {
                    "SELECT DISTINCT file_path, 1 FROM history WHERE file_path LIKE ?1 ESCAPE '\\' \
                     ORDER BY file_path ASC LIMIT 50"
                }
                _ => return Ok(Vec::new()),
            };
            let mut stmt = inner.conn.prepare_cached(sql)?;
            let rows = stmt
                .query_map([&pattern], |row| {
                    Ok(TagValueSuggestion { value: Value::String(row.get(0)?), count: row.get(1)? })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            return Ok(rows);
        }

        let path_key = serde_json::to_string(path).expect("path is serializable");
        let mut stmt = inner.conn.prepare_cached(
            "SELECT value, count FROM tag_value_counts WHERE path = ?1 AND value LIKE ?2 ESCAPE '\\' \
             ORDER BY count DESC, value ASC LIMIT 50",
        )?;
        let rows = stmt
            .query_map(params![path_key, pattern], |row| {
                let raw: String = row.get(0)?;
                Ok(TagValueSuggestion {
                    value: serde_json::from_str(&raw).unwrap_or(Value::Null),
                    count: row.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// The tag path/type schema for the filter UI, with the virtual `$file`
    /// fields injected. Value suggestions are queried on demand via
    /// `suggest_tag_values` instead of being shipped here.
    pub fn tag_metadata(&self) -> Result<TagMetadata, HistoryError> {
        let inner = self.lock();
        let mut schema = load_schema(&inner.conn)?;
        schema.insert(
            "$file".to_string(),
            serde_json::json!({
                "type": {
                    "Name": { "type": "string", "isArray": false },
                    "Path": { "type": "string", "isArray": false },
                    "Type": { "type": "string", "isArray": false },
                    "DateTime": { "type": "dateTime", "isArray": false },
                },
                "isArray": false,
            }),
        );

        Ok(TagMetadata { schema: Value::Object(schema) })
    }

    pub fn base_path(&self) -> PathBuf {
        self.lock().base_path.clone()
    }

    pub fn set_base_path(&self, base_path: PathBuf) -> Result<(), HistoryError> {
        let mut inner = self.lock();
        std::fs::create_dir_all(&base_path)?;
        inner.conn = open_conn(&base_path, self.filter_slot.clone())?;
        inner.base_path = base_path;
        Ok(())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().expect("history store not poisoned")
    }
}

fn open_conn(base_path: &Path, filter_slot: FilterSlot) -> Result<Connection, HistoryError> {
    let mut conn = Connection::open(base_path.join("history.db"))?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch(SCHEMA)?;
    register_filter_match(&conn, filter_slot)?;
    ensure_metadata_built(&mut conn)?;
    Ok(conn)
}

/// Populates the derived tag tables (schema + value counts + `tag_index`) by
/// scanning `history` once. A `building` status is committed before the scan so
/// an interrupted build is detected (and restarted) on the next open; the
/// versioned built status is set only on success.
fn ensure_metadata_built(conn: &mut Connection) -> rusqlite::Result<()> {
    let status: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = 'metadata_status'", [], |row| row.get(0))
        .optional()?;

    if status.as_deref() == Some(METADATA_STATUS_BUILT) {
        return Ok(());
    }

    set_meta(conn, "metadata_status", "building")?;

    let mut builder = MetadataBuilder::default();
    let mut index_rows = Vec::new();
    {
        let mut stmt = conn.prepare("SELECT id, tags FROM history WHERE tags IS NOT NULL")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let history_id: i64 = row.get(0)?;
            let raw: String = row.get(1)?;
            if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                builder.add(&value);
                for entry in collect_index_entries(&value) {
                    index_rows.push((history_id, entry));
                }
            }
        }
    }
    let (schema, counts) = builder.into_parts();

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM tag_value_counts", [])?;
    tx.execute("DELETE FROM tag_index", [])?;
    save_schema(&tx, &schema)?;
    {
        let mut insert = tx.prepare("INSERT INTO tag_value_counts (path, value, count) VALUES (?1, ?2, ?3)")?;
        for (path, values) in &counts {
            for (value_json, (_, count)) in values {
                insert.execute(params![path, value_json, *count as i64])?;
            }
        }
        let mut index_insert = tx.prepare(INSERT_TAG_INDEX)?;
        for (history_id, entry) in &index_rows {
            index_insert.execute(params![history_id, entry.path, entry.kind, entry.text, entry.num])?;
        }
    }
    set_meta(&tx, "metadata_status", METADATA_STATUS_BUILT)?;
    tx.commit()?;
    Ok(())
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
}

fn load_schema(conn: &Connection) -> rusqlite::Result<Map<String, Value>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = 'tag_schema'", [], |row| row.get(0))
        .optional()?;
    Ok(raw
        .and_then(|text| serde_json::from_str::<Map<String, Value>>(&text).ok())
        .unwrap_or_default())
}

fn save_schema(conn: &Connection, schema: &Map<String, Value>) -> rusqlite::Result<()> {
    let json = serde_json::to_string(schema).expect("schema is serializable");
    set_meta(conn, "tag_schema", &json)
}

/// Updates the derived tag tables for one inserted row: merges the schema,
/// increments the cached value counts, and adds the row's `tag_index` entries.
fn record_tags(
    conn: &Connection,
    history_id: i64,
    tags: &Value,
    schema: &mut Map<String, Value>,
) -> rusqlite::Result<()> {
    merge_schema(tags, schema);
    for (path, scalar) in collect_scalars(tags) {
        conn.execute(
            "INSERT INTO tag_value_counts (path, value, count) VALUES (?1, ?2, 1) \
             ON CONFLICT(path, value) DO UPDATE SET count = count + 1",
            params![path, scalar.to_string()],
        )?;
    }
    let mut index_insert = conn.prepare_cached(INSERT_TAG_INDEX)?;
    for entry in collect_index_entries(tags) {
        index_insert.execute(params![history_id, entry.path, entry.kind, entry.text, entry.num])?;
    }
    Ok(())
}

/// Shared tail for every "add a row to history" path (`save_rendered`,
/// `save_recording`, `import_file`): inserts the row and, if tagged, updates
/// the derived tag tables. Callers have already picked the file name/path and
/// written the file itself , that part differs enough between an encoded PNG,
/// a moved recording, and a copied import to stay separate.
fn insert_history_row(
    conn: &Connection,
    file_name: &str,
    file_path: &Path,
    item_type: HistoryItemType,
    date_time: DateTime<Utc>,
    tags_value: Option<&Value>,
    file_size: Option<u64>,
) -> Result<(), HistoryError> {
    let tags_json = tags_value.map(|value| value.to_string());

    conn.execute(
        &format!("INSERT INTO history ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"),
        params![
            file_name,
            file_path.to_string_lossy().into_owned(),
            item_type.as_str(),
            date_time.timestamp_millis(),
            Option::<String>::None,
            Option::<String>::None,
            Option::<String>::None,
            tags_json,
            file_size.map(|size| size as i64),
            Option::<String>::None,
        ],
    )?;

    if let Some(tags_value) = tags_value {
        let history_id = conn.last_insert_rowid();
        let mut schema = load_schema(conn)?;
        record_tags(conn, history_id, tags_value, &mut schema)?;
        save_schema(conn, &schema)?;
    }

    Ok(())
}

/// Decrements the cached value counts for a deleted row's tags (schema is left
/// as-is , a stale path is harmless).
fn unrecord_tags(conn: &Connection, tags: &Value) -> rusqlite::Result<()> {
    for (path, scalar) in collect_scalars(tags) {
        conn.execute(
            "UPDATE tag_value_counts SET count = count - 1 WHERE path = ?1 AND value = ?2",
            params![path, scalar.to_string()],
        )?;
    }
    conn.execute("DELETE FROM tag_value_counts WHERE count <= 0", [])?;
    Ok(())
}

fn serialize_tags(
    tags: &std::collections::HashMap<String, crate::screen_manager::screenshot_manager::TagValue>,
) -> String {
    serde_json::to_string(tags).expect("tags are always serializable")
}

fn escape_like(query: &str) -> String {
    query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

fn row_to_entry(row: &Row) -> rusqlite::Result<ImageHistoryData> {
    let file_path: String = row.get(1)?;
    let item_type: String = row.get(2)?;
    let date_time_ms: i64 = row.get(3)?;
    let tags_raw: Option<String> = row.get(7)?;
    let file_size: Option<i64> = row.get(8)?;
    let upload_error_raw: Option<String> = row.get(9)?;

    Ok(ImageHistoryData {
        file_name: row.get(0)?,
        file_path: PathBuf::from(file_path),
        item_type: HistoryItemType::from_str(&item_type),
        date_time: DateTime::from_timestamp_millis(date_time_ms)
            .unwrap_or_else(|| DateTime::from_timestamp_nanos(0)),
        tags: tags_raw
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok()),
        file_size: file_size.map(|size| size as u64),
        upload_error: upload_error_raw
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok()),
        host: row.get(4)?,
        url: row.get(5)?,
        deletion_url: row.get(6)?,
    })
}

const DEFAULT_FILE_NAME_TEMPLATE: &str = "${process}_${random:10}";

fn unique_file_name(
    conn: &Connection,
    dir: &Path,
    template: Option<&str>,
    now_local: DateTime<Local>,
    tags: Option<&Value>,
    width: u32,
    height: u32,
    ext: &str,
) -> Result<String, HistoryError> {
    let base = expand_file_name_template(template, now_local, tags, width, height);
    let mut name = format!("{base}.{ext}");
    let mut suffix = 1;

    while name_exists(conn, &name)? || dir.join(&name).exists() {
        name = format!("{base}-{suffix}.{ext}");
        suffix += 1;
    }

    Ok(name)
}

fn expand_file_name_template(
    template: Option<&str>,
    now_local: DateTime<Local>,
    tags: Option<&Value>,
    width: u32,
    height: u32,
) -> String {
    let template = template
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .unwrap_or(DEFAULT_FILE_NAME_TEMPLATE);

    let (process_name, window_title) = most_captured_window(tags);

    let expanded = template
        .replace("${year}", &format!("{:04}", now_local.year()))
        .replace("${month}", &format!("{:02}", now_local.month()))
        .replace("${day}", &format!("{:02}", now_local.day()))
        .replace("${hour}", &format!("{:02}", now_local.hour()))
        .replace("${minute}", &format!("{:02}", now_local.minute()))
        .replace("${second}", &format!("{:02}", now_local.second()))
        .replace("${millisecond}", &format!("{:03}", now_local.timestamp_subsec_millis()))
        .replace("${process}", &process_name)
        .replace("${windowTitle}", &window_title)
        .replace("${width}", &width.to_string())
        .replace("${height}", &height.to_string())
        .replace("${guid}", &random_guid());

    sanitize_file_name(&expand_random_tokens(&expanded))
}

/// The window covering the largest share of the capture, from the saved tags.
fn most_captured_window(tags: Option<&Value>) -> (String, String) {
    let Some(windows) = tags.and_then(|t| t.get("Windows")).and_then(|w| w.as_array()) else {
        return (String::new(), String::new());
    };

    let mut best: Option<(&Value, f64)> = None;
    for window in windows {
        let percentage = window
            .get("Screenshot Percentage")
            .and_then(|p| p.as_f64())
            .unwrap_or(0.0);
        if best.is_none_or(|(_, current)| percentage > current) {
            best = Some((window, percentage));
        }
    }

    match best {
        Some((window, _)) => (
            window.get("Process Name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            window.get("Window Name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        ),
        None => (String::new(), String::new()),
    }
}

/// Replaces `${random}` (8 chars) and `${random:N}` (N clamped to 1–32).
fn expand_random_tokens(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;

    while let Some(pos) = rest.find("${random") {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + "${random".len()..];

        if let Some(tail) = after.strip_prefix('}') {
            out.push_str(&random_alphanumeric(8));
            rest = tail;
        } else if let Some(spec) = after.strip_prefix(':') {
            match spec.find('}') {
                Some(close) => {
                    let count = spec[..close].parse::<usize>().map(|n| n.clamp(1, 32)).unwrap_or(8);
                    out.push_str(&random_alphanumeric(count));
                    rest = &spec[close + 1..];
                }
                None => {
                    out.push_str("${random:");
                    rest = spec;
                }
            }
        } else {
            out.push_str("${random");
            rest = after;
        }
    }

    out.push_str(rest);
    out
}

fn random_alphanumeric(count: usize) -> String {
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    (0..count)
        .map(|_| CHARSET[rand::random::<u32>() as usize % CHARSET.len()] as char)
        .collect()
}

fn random_guid() -> String {
    let bytes: [u8; 16] = rand::random();
    let hex = |range: std::ops::Range<usize>| {
        bytes[range].iter().map(|byte| format!("{byte:02x}")).collect::<String>()
    };
    format!("{}-{}-{}-{}-{}", hex(0..4), hex(4..6), hex(6..8), hex(8..10), hex(10..16))
}

/// Window titles can contain anything: swap out characters Windows forbids in
/// file names, bound the length, and never return an empty stem.
fn sanitize_file_name(name: &str) -> String {
    let mut cleaned: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if (c as u32) < 0x20 => '-',
            c => c,
        })
        .collect();

    while cleaned.len() > 120 {
        cleaned.pop();
    }

    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']);
    if trimmed.is_empty() { "screeny".to_string() } else { trimmed.to_string() }
}

/// De-duplicated destination name for an imported file, preserving its original
/// stem/extension and adding `-1`, `-2`… on collision (against history + disk).
fn unique_name_from(conn: &Connection, dir: &Path, original: &str) -> Result<String, HistoryError> {
    let path = Path::new(original);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|e| e.to_str());

    let mut name = original.to_string();
    let mut suffix = 1;
    while name_exists(conn, &name)? || dir.join(&name).exists() {
        name = match ext {
            Some(ext) => format!("{stem}-{suffix}.{ext}"),
            None => format!("{stem}-{suffix}"),
        };
        suffix += 1;
    }

    Ok(name)
}

const DEFAULT_SAVE_TEMPLATE: &str = "${year}-${month}";

/// Resolves the destination directory for a saved/imported file. Always rooted
/// at `<base>/files/`, with the (variable-expanded) template as a subpath;
/// root/parent components are dropped so the template can't escape `files/`.
fn expand_save_dir(
    base: &Path,
    template: Option<&str>,
    now_local: DateTime<Local>,
    item_type: HistoryItemType,
) -> PathBuf {
    let template = template
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .unwrap_or(DEFAULT_SAVE_TEMPLATE);

    let expanded = template
        .replace("${year}", &format!("{:04}", now_local.year()))
        .replace("${month}", &format!("{:02}", now_local.month()))
        .replace("${day}", &format!("{:02}", now_local.day()))
        .replace("${hour}", &format!("{:02}", now_local.hour()))
        .replace("${minute}", &format!("{:02}", now_local.minute()))
        .replace("${second}", &format!("{:02}", now_local.second()))
        .replace("${type}", item_type.as_str());

    let mut sub = PathBuf::new();
    for component in Path::new(&expanded).components() {
        if let std::path::Component::Normal(part) = component {
            sub.push(part);
        }
    }

    base.join("files").join(sub)
}

const THUMBNAIL_MAX_WIDTH: u32 = 480;

fn thumbnail_path_in(base: &Path, file_name: &str) -> PathBuf {
    base.join("thumbnails").join(format!("{file_name}.webp"))
}

/// Scales the frame down to card size and writes it as
/// `thumbnails/<file_name>.webp` under the store's base path.
fn write_thumbnail(base: &Path, file_name: &str, image: &RgbaImage) -> Result<(), HistoryError> {
    std::fs::create_dir_all(base.join("thumbnails"))?;

    let scaled;
    let source = if image.width() > THUMBNAIL_MAX_WIDTH {
        let height = (u64::from(image.height()) * u64::from(THUMBNAIL_MAX_WIDTH)
            / u64::from(image.width()))
        .max(1) as u32;
        scaled = image::imageops::thumbnail(image, THUMBNAIL_MAX_WIDTH, height);
        &scaled
    } else {
        image
    };

    let bytes = encode_image_as(source, ImageFormat::WebP)
        .map_err(|err| HistoryError::Encode(err.to_string()))?;
    std::fs::write(thumbnail_path_in(base, file_name), &bytes)?;
    Ok(())
}

fn name_exists(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM history WHERE file_name = ?1",
        [name],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HistoryError {
    #[serde(serialize_with = "error_serialize")]
    Sqlite(rusqlite::Error),
    #[serde(serialize_with = "error_serialize")]
    Io(std::io::Error),
    Encode(String),
    Task(String),
}

impl Display for HistoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(err) => write!(f, "HistoryError::Sqlite: {err}"),
            Self::Io(err) => write!(f, "HistoryError::Io: {err}"),
            Self::Encode(err) => write!(f, "HistoryError::Encode: {err}"),
            Self::Task(err) => write!(f, "HistoryError::Task: {err}"),
        }
    }
}

impl Error for HistoryError {}

impl From<rusqlite::Error> for HistoryError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

impl From<std::io::Error> for HistoryError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history_store::filter::FilterNode;
    use crate::screen_manager::screenshot_manager::{ScreenshotImageFormat, TagValue};
    use chrono::TimeZone;
    use serde_json::json;
    use std::collections::HashMap;

    fn temp_store() -> HistoryStore {
        let dir = std::env::temp_dir().join(format!("rosemyne-store-test-{}", rand::random::<u64>()));
        HistoryStore::new(dir).unwrap()
    }

    fn entry(name: &str, ms: i64, tags: HashMap<String, TagValue>) -> ImageHistoryData {
        ImageHistoryData {
            file_name: name.to_string(),
            file_path: std::env::temp_dir().join(name),
            item_type: HistoryItemType::Image,
            date_time: Utc.timestamp_millis_opt(ms).unwrap(),
            tags: Some(tags),
            file_size: None,
            host: None,
            url: None,
            deletion_url: None,
            upload_error: None,
        }
    }

    fn empty_filter() -> FilterNode {
        FilterNode::Group { relation: 0, children: vec![] }
    }

    fn equals(path: &[&str], value: serde_json::Value) -> FilterNode {
        FilterNode::Group {
            relation: 0,
            children: vec![FilterNode::Condition {
                path: path.iter().map(|s| s.to_string()).collect(),
                operation: 0,
                values: vec![value],
            }],
        }
    }

    fn process(name: &str) -> HashMap<String, TagValue> {
        HashMap::from([("ProcessName".to_string(), TagValue::String(name.to_string()))])
    }

    #[test]
    fn query_orders_newest_first_and_paginates() {
        let store = temp_store();
        store
            .insert_batch(vec![
                entry("a.png", 100, process("firefox")),
                entry("c.png", 300, process("chrome")),
                entry("b.png", 200, process("firefox")),
            ])
            .unwrap();

        let page = store.query(empty_filter(), None, None, 2).unwrap();
        assert_eq!(page.total, Some(3));
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.items[0].file_name, "c.png");
        assert_eq!(page.items[1].file_name, "b.png");

        let page = store.query(empty_filter(), None, page.next_cursor, 2).unwrap();
        assert_eq!(page.total, None);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].file_name, "a.png");

        let page = store.query(empty_filter(), None, page.next_cursor, 2).unwrap();
        assert!(page.items.is_empty());
        assert!(page.next_cursor.is_none());
    }

    #[test]
    fn query_applies_scalar_filter() {
        let store = temp_store();
        store
            .insert_batch(vec![
                entry("a.png", 100, process("firefox")),
                entry("b.png", 200, process("chrome")),
                entry("c.png", 300, process("firefox")),
            ])
            .unwrap();

        let page = store.query(equals(&["ProcessName"], json!("firefox")), None, None, 50).unwrap();
        assert_eq!(page.total, Some(2));
        assert_eq!(page.items.len(), 2);
        assert!(page.items.iter().all(|item| item
            .tags
            .as_ref()
            .and_then(|t| t.get("ProcessName"))
            .is_some()));
    }

    #[test]
    fn query_filters_through_window_array() {
        let store = temp_store();
        let windows = HashMap::from([(
            "Windows".to_string(),
            TagValue::MapArray(vec![HashMap::from([(
                "Window Name".to_string(),
                TagValue::String("firefox".to_string()),
            )])]),
        )]);
        store
            .insert_batch(vec![
                entry("a.png", 100, windows),
                entry("b.png", 200, process("chrome")),
            ])
            .unwrap();

        let page = store
            .query(equals(&["Windows", "Window Name"], json!("firefox")), None, None, 50)
            .unwrap();
        assert_eq!(page.total, Some(1));
        assert_eq!(page.items[0].file_name, "a.png");
    }

    #[test]
    fn keyset_pagination_respects_filter() {
        let store = temp_store();
        store
            .insert_batch(vec![
                entry("a.png", 100, process("firefox")),
                entry("b.png", 200, process("chrome")),
                entry("c.png", 300, process("firefox")),
                entry("d.png", 400, process("chrome")),
                entry("e.png", 500, process("firefox")),
            ])
            .unwrap();

        let filter = equals(&["ProcessName"], json!("firefox"));
        let mut names = Vec::new();
        let mut cursor = None;
        let mut total = None;
        loop {
            let page = store.query(filter.clone(), None, cursor.clone(), 1).unwrap();
            if cursor.is_none() {
                total = page.total;
            }
            if page.items.is_empty() {
                break;
            }
            names.extend(page.items.iter().map(|item| item.file_name.clone()));
            cursor = page.next_cursor;
        }

        assert_eq!(total, Some(3));
        assert_eq!(names, vec!["e.png", "c.png", "a.png"]);
    }

    #[test]
    fn delete_and_upload_result() {
        let store = temp_store();
        store.insert_batch(vec![entry("a.png", 100, process("firefox"))]).unwrap();

        store.set_upload_result("a.png", "Imgur", "https://example.com/a.png").unwrap();
        let saved = store.get_by_file_name("a.png").unwrap().unwrap();
        assert_eq!(saved.host.as_deref(), Some("Imgur"));
        assert_eq!(saved.url.as_deref(), Some("https://example.com/a.png"));

        store.delete_with_file("a.png").unwrap();
        assert!(store.get_by_file_name("a.png").unwrap().is_none());
    }

    #[test]
    fn tag_metadata_reports_paths() {
        let store = temp_store();
        store
            .insert_batch(vec![
                entry("a.png", 100, process("firefox")),
                entry("b.png", 200, process("firefox")),
            ])
            .unwrap();

        let meta = store.tag_metadata().unwrap();
        assert_eq!(meta.schema["ProcessName"], json!({ "type": "string", "isArray": false }));
        // The virtual $file fields are always present in the schema.
        assert_eq!(meta.schema["$file"]["type"]["Type"], json!({ "type": "string", "isArray": false }));

        let suggestions = store.suggest_tag_values(&["ProcessName".to_string()], "").unwrap();
        assert_eq!(suggestions[0].value, json!("firefox"));
        assert_eq!(suggestions[0].count, 2);
    }

    #[test]
    fn tag_metadata_reports_time_and_date_time_fields() {
        let store = temp_store();
        store
            .insert_batch(vec![entry("a.png", 100, HashMap::from([
                ("Duration".to_string(), TagValue::time_millis(5000)),
                ("CapturedAt".to_string(), TagValue::date_time_millis(1_737_000_000_000)),
            ]))])
            .unwrap();

        let meta = store.tag_metadata().unwrap();
        assert_eq!(meta.schema["Duration"], json!({ "type": "time", "isArray": false }));
        assert_eq!(meta.schema["CapturedAt"], json!({ "type": "dateTime", "isArray": false }));

        let page = store.query(equals(&["Duration"], json!(5000)), None, None, 10).unwrap();
        assert_eq!(page.items[0].file_name, "a.png");
    }

    #[test]
    fn delete_decrements_cached_counts() {
        let store = temp_store();
        store
            .insert_batch(vec![
                entry("a.png", 100, process("firefox")),
                entry("b.png", 200, process("firefox")),
                entry("c.png", 300, process("chrome")),
            ])
            .unwrap();

        store.delete_with_file("a.png").unwrap();
        store.delete_with_file("c.png").unwrap();

        let values = store.suggest_tag_values(&["ProcessName".to_string()], "").unwrap();
        // firefox drops to 1; chrome hits 0 and is pruned.
        assert_eq!(values.len(), 1);
        assert_eq!(values[0].value, json!("firefox"));
        assert_eq!(values[0].count, 1);
    }

    #[test]
    fn backfills_metadata_from_existing_rows() {
        let dir = std::env::temp_dir().join(format!("rosemyne-backfill-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        {
            // Pre-existing history with a stale (pre-tag_index) cache status.
            let conn = Connection::open(dir.join("history.db")).unwrap();
            conn.execute_batch(SCHEMA).unwrap();
            conn.execute(
                "INSERT INTO history (file_name, file_path, type, date_time_ms, tags) \
                 VALUES ('x.png', '/tmp/x.png', 'image', 1, '{\"ProcessName\":\"firefox\"}')",
                [],
            )
            .unwrap();
            conn.execute("INSERT INTO meta (key, value) VALUES ('metadata_status', 'built')", []).unwrap();
        }

        let store = HistoryStore::new(dir).unwrap();
        let meta = store.tag_metadata().unwrap();
        assert_eq!(meta.schema["ProcessName"], json!({ "type": "string", "isArray": false }));
        let suggestions = store.suggest_tag_values(&["ProcessName".to_string()], "").unwrap();
        assert_eq!(suggestions[0].value, json!("firefox"));
        assert_eq!(suggestions[0].count, 1);

        // The rebuild also populated tag_index: an exact filter finds the row.
        let page = store.query(equals(&["ProcessName"], json!("firefox")), None, None, 10).unwrap();
        assert_eq!(page.total, Some(1));
        assert_eq!(page.items[0].file_name, "x.png");
    }

    #[test]
    fn delete_removes_index_entries() {
        let store = temp_store();
        store
            .insert_batch(vec![
                entry("a.png", 100, process("firefox")),
                entry("b.png", 200, process("chrome")),
            ])
            .unwrap();

        store.delete_with_file("a.png").unwrap();

        let page = store.query(equals(&["ProcessName"], json!("firefox")), None, None, 10).unwrap();
        assert_eq!(page.total, Some(0));
        let page = store.query(equals(&["ProcessName"], json!("chrome")), None, None, 10).unwrap();
        assert_eq!(page.total, Some(1));
    }

    #[test]
    fn save_rendered_rows_are_queryable_by_filter() {
        let store = temp_store();
        let image = RgbaImage::new(2, 2);
        let saved = store
            .save_rendered(&image, Some(process("firefox")), None, None, ScreenshotImageFormat::Png)
            .unwrap();

        let page = store.query(equals(&["ProcessName"], json!("firefox")), None, None, 10).unwrap();
        assert_eq!(page.total, Some(1));
        assert_eq!(page.items[0].file_name, saved.file_name);

        std::fs::remove_file(&saved.file_path).ok();
    }

    fn condition(path: &[&str], operation: u8, values: Vec<serde_json::Value>) -> FilterNode {
        FilterNode::Group {
            relation: 0,
            children: vec![FilterNode::Condition {
                path: path.iter().map(|s| s.to_string()).collect(),
                operation,
                values,
            }],
        }
    }

    /// Every operation, exact-compiled or residual, must return the same rows
    /// as the reference evaluator (`filter::eval`) run over the raw tags.
    #[test]
    fn compiled_queries_match_reference_eval() {
        let store = temp_store();

        let rows: Vec<(String, Option<HashMap<String, TagValue>>)> = vec![
            ("firefox.png".into(), Some(HashMap::from([
                ("ProcessName".to_string(), TagValue::String("firefox".to_string())),
                ("Timestamp".to_string(), TagValue::Int(1500)),
                ("Focused".to_string(), TagValue::Bool(true)),
                ("Duration".to_string(), TagValue::time_millis(5000)),
                ("CapturedAt".to_string(), TagValue::date_time_millis(1_737_000_000_000)),
            ]))),
            ("code.png".into(), Some(HashMap::from([
                ("ProcessName".to_string(), TagValue::String("Code".to_string())),
                ("Timestamp".to_string(), TagValue::Int(900)),
                ("Focused".to_string(), TagValue::Bool(false)),
                ("Windows".to_string(), TagValue::MapArray(vec![
                    HashMap::from([
                        ("Window Name".to_string(), TagValue::String("rosemyne - Visual Studio Code".to_string())),
                        ("Screenshot Percentage".to_string(), TagValue::Float(0.75)),
                    ]),
                    HashMap::from([
                        ("Window Name".to_string(), TagValue::String("firefox".to_string())),
                        ("Screenshot Percentage".to_string(), TagValue::Float(0.25)),
                    ]),
                ])),
            ]))),
            ("empty.png".into(), Some(HashMap::new())),
            ("untagged.png".into(), None),
        ];

        let mut entries = Vec::new();
        for (index, (name, tags)) in rows.iter().enumerate() {
            let mut item = entry(name, 100 * (index as i64 + 1), HashMap::new());
            item.tags = tags.clone();
            entries.push(item);
        }
        store.insert_batch(entries).unwrap();

        let filters = vec![
            condition(&["ProcessName"], 0, vec![json!("firefox")]),
            condition(&["ProcessName"], 0, vec![json!("firefox"), json!("Code")]),
            condition(&["ProcessName"], 1, vec![json!("firefox")]),
            condition(&["Missing"], 1, vec![json!("x")]),
            condition(&["Timestamp"], 0, vec![json!(1500)]),
            condition(&["Timestamp"], 2, vec![json!(1000)]),
            condition(&["Timestamp"], 3, vec![json!(1000)]),
            condition(&["Timestamp"], 4, vec![json!(900)]),
            condition(&["Timestamp"], 5, vec![json!(900)]),
            condition(&["Duration"], 0, vec![json!(5000)]),
            condition(&["Duration"], 2, vec![json!(1000)]),
            condition(&["Duration"], 3, vec![json!(1000)]),
            condition(&["CapturedAt"], 0, vec![json!(1_737_000_000_000i64)]),
            condition(&["CapturedAt"], 5, vec![json!(1_737_000_000_000i64)]),
            condition(&["CapturedAt"], 1, vec![json!(0)]),
            condition(&["Focused"], 0, vec![json!(true)]),
            condition(&["Focused"], 0, vec![json!(false)]),
            condition(&["ProcessName"], 6, vec![json!("fire")]),
            condition(&["ProcessName"], 6, vec![json!("")]),
            condition(&["ProcessName"], 7, vec![json!("fire")]),
            condition(&["ProcessName"], 8, vec![json!("Co")]),
            condition(&["ProcessName"], 9, vec![json!("fox")]),
            condition(&["ProcessName"], 10, vec![json!("ffx")]),
            condition(&["Windows", "Window Name"], 0, vec![json!("firefox")]),
            condition(&["Windows", "Window Name"], 6, vec![json!("Studio")]),
            condition(&["Windows", "Screenshot Percentage"], 2, vec![json!(0.5)]),
            condition(&["ProcessName"], 0, vec![json!(null)]),
            condition(&["$file", "Type"], 0, vec![json!("image")]),
            condition(&["$file", "Type"], 1, vec![json!("image")]),
            condition(&["$file", "Name"], 0, vec![json!("code.png")]),
            condition(&["$file", "Name"], 1, vec![json!("code.png")]),
            condition(&["$file", "Name"], 6, vec![json!("fire")]),
            condition(&["$file", "Name"], 7, vec![json!("fire")]),
            condition(&["$file", "Name"], 8, vec![json!("empty")]),
            condition(&["$file", "Name"], 9, vec![json!(".png")]),
            condition(&["$file", "Name"], 10, vec![json!("fpn")]),
            condition(&["$file", "Path"], 6, vec![json!("rosemyne")]),
            condition(&["$file", "DateTime"], 0, vec![json!(200)]),
            condition(&["$file", "DateTime"], 1, vec![json!(100)]),
            condition(&["$file", "DateTime"], 2, vec![json!(200)]),
            condition(&["$file", "DateTime"], 5, vec![json!(200)]),
            FilterNode::Group {
                relation: 1,
                children: vec![
                    FilterNode::Condition {
                        path: vec!["ProcessName".to_string()],
                        operation: 0,
                        values: vec![json!("firefox")],
                    },
                    FilterNode::Condition {
                        path: vec!["$file".to_string(), "Name".to_string()],
                        operation: 6,
                        values: vec![json!("untagged")],
                    },
                ],
            },
        ];

        for filter in filters {
            let expected: Vec<&str> = rows
                .iter()
                .enumerate()
                .rev()
                .filter(|(index, (name, tags))| {
                    let tags_value = tags
                        .as_ref()
                        .map(|map| serde_json::to_value(map).unwrap())
                        .unwrap_or(serde_json::Value::Null);
                    let file_path = std::env::temp_dir().join(name.as_str());
                    // Mirrors `entry(name, 100 * (index + 1), ..)` below.
                    let date_time_ms = 100 * (*index as i64 + 1);
                    let augmented = crate::history_store::filter::augment_tags(
                        tags_value,
                        name,
                        &file_path.to_string_lossy(),
                        "image",
                        date_time_ms,
                    );
                    crate::history_store::filter::eval(&filter, &augmented)
                })
                .map(|(_, (name, _))| name.as_str())
                .collect();

            let page = store.query(filter.clone(), None, None, 50).unwrap();
            let actual: Vec<&str> = page.items.iter().map(|item| item.file_name.as_str()).collect();

            assert_eq!(actual, expected, "filter {filter:?} diverged from reference eval");
            assert_eq!(page.total, Some(expected.len() as u64), "count diverged for {filter:?}");
        }
    }

    #[test]
    fn sorts_by_name_case_insensitively_with_cursor() {
        let store = temp_store();
        store
            .insert_batch(vec![
                entry("Banana.png", 100, HashMap::new()),
                entry("apple.png", 200, HashMap::new()),
                entry("cherry.png", 300, HashMap::new()),
            ])
            .unwrap();

        let walk = |sort: HistorySort| {
            let mut names = Vec::new();
            let mut cursor = None;
            loop {
                let page = store.query(empty_filter(), Some(sort), cursor.clone(), 1).unwrap();
                if page.items.is_empty() {
                    break;
                }
                names.extend(page.items.iter().map(|item| item.file_name.clone()));
                cursor = page.next_cursor;
            }
            names
        };

        let asc = HistorySort { field: SortField::Name, direction: SortDirection::Asc };
        assert_eq!(walk(asc), vec!["apple.png", "Banana.png", "cherry.png"]);

        let desc = HistorySort { field: SortField::Name, direction: SortDirection::Desc };
        assert_eq!(walk(desc), vec!["cherry.png", "Banana.png", "apple.png"]);

        let oldest = HistorySort { field: SortField::Date, direction: SortDirection::Asc };
        assert_eq!(walk(oldest), vec!["Banana.png", "apple.png", "cherry.png"]);
    }

    #[test]
    fn suggests_values_on_demand() {
        let store = temp_store();
        store
            .insert_batch(vec![
                entry("a.png", 100, process("firefox")),
                entry("b.png", 200, process("firefox")),
                entry("c.png", 300, process("chrome")),
            ])
            .unwrap();

        let path = vec!["ProcessName".to_string()];
        let all = store.suggest_tag_values(&path, "").unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!((all[0].value.clone(), all[0].count), (json!("firefox"), 2));
        assert_eq!((all[1].value.clone(), all[1].count), (json!("chrome"), 1));

        let filtered = store.suggest_tag_values(&path, "fire").unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].value, json!("firefox"));

        // LIKE wildcards in the query are literals, not patterns.
        assert!(store.suggest_tag_values(&path, "%").unwrap().is_empty());

        let types = store.suggest_tag_values(&["$file".to_string(), "Type".to_string()], "").unwrap();
        assert_eq!((types[0].value.clone(), types[0].count), (json!("image"), 3));

        let names = store.suggest_tag_values(&["$file".to_string(), "Name".to_string()], "a.").unwrap();
        assert_eq!(names.len(), 1);
        assert_eq!(names[0].value, json!("a.png"));
    }

    #[test]
    fn file_name_template_expands_and_sanitizes() {
        let now = Local.with_ymd_and_hms(2026, 7, 5, 9, 8, 7).unwrap();
        let tags = json!({
            "Windows": [
                { "Process Name": "chrome", "Window Name": "Tab: a/b?", "Screenshot Percentage": 0.8 },
                { "Process Name": "code", "Window Name": "other", "Screenshot Percentage": 0.2 },
            ]
        });

        let expand = |template: &str| expand_file_name_template(Some(template), now, Some(&tags), 10, 20);

        assert_eq!(expand("${process}-${year}${month}${day}"), "chrome-20260705");
        assert_eq!(expand("${width}x${height}"), "10x20");
        // Illegal filename characters from the window title become dashes.
        assert_eq!(expand("${windowTitle}"), "Tab- a-b-");

        assert_eq!(expand("${random}").len(), 8);
        assert_eq!(expand("${random:12}").len(), 12);
        assert_eq!(expand("${random:999}").len(), 32);
        let guid = expand("${guid}");
        assert_eq!(guid.len(), 36);
        assert_eq!(guid.chars().filter(|c| *c == '-').count(), 4);

        // Default: process name + 10 random alphanumerics.
        let default = expand_file_name_template(None, now, Some(&tags), 10, 20);
        assert_eq!(default.len(), "chrome_".len() + 10);
        assert!(default.starts_with("chrome_"));

        // No tags → the process part is empty but the name never is.
        assert_eq!(expand_file_name_template(Some("${process}"), now, None, 10, 20), "screeny");
    }

    #[test]
    fn expand_save_dir_roots_under_files() {
        let base = Path::new("/base");
        let now = Local.with_ymd_and_hms(2026, 7, 5, 9, 8, 7).unwrap();

        assert_eq!(
            expand_save_dir(base, None, now, HistoryItemType::Image),
            base.join("files").join("2026-07")
        );
        assert_eq!(
            expand_save_dir(base, Some("${year}-${month}/${type}"), now, HistoryItemType::Video),
            base.join("files").join("2026-07").join("video")
        );
        // Templates cannot escape files/.
        assert_eq!(
            expand_save_dir(base, Some("../../etc"), now, HistoryItemType::File),
            base.join("files").join("etc")
        );
    }

    #[test]
    fn type_round_trips_through_query() {
        let store = temp_store();
        let mut video = entry("clip.mp4", 100, HashMap::new());
        video.item_type = HistoryItemType::Video;
        store.insert_batch(vec![video, entry("a.png", 200, HashMap::new())]).unwrap();

        let page = store.query(empty_filter(), None, None, 50).unwrap();
        let clip = page.items.iter().find(|i| i.file_name == "clip.mp4").unwrap();
        assert_eq!(clip.item_type, HistoryItemType::Video);
        let png = page.items.iter().find(|i| i.file_name == "a.png").unwrap();
        assert_eq!(png.item_type, HistoryItemType::Image);
    }

    #[test]
    fn import_file_copies_classifies_and_records() {
        let store = temp_store();

        let mp4 = std::env::temp_dir().join(format!("rosemyne-import-{}.mp4", rand::random::<u64>()));
        std::fs::write(&mp4, b"video-bytes").unwrap();
        let zip = std::env::temp_dir().join(format!("rosemyne-import-{}.zip", rand::random::<u64>()));
        std::fs::write(&zip, b"zip-bytes").unwrap();

        let video = store.import_file(&mp4, Some("vids")).unwrap().unwrap();
        assert_eq!(video.item_type, HistoryItemType::Video);
        assert_eq!(std::fs::read(&video.file_path).unwrap(), b"video-bytes");
        assert!(video.file_path.to_string_lossy().replace('\\', "/").contains("/files/vids/"));
        assert_eq!(
            store.get_by_file_name(&video.file_name).unwrap().unwrap().item_type,
            HistoryItemType::Video
        );

        let file = store.import_file(&zip, None).unwrap().unwrap();
        assert_eq!(file.item_type, HistoryItemType::File);

        std::fs::remove_file(&mp4).ok();
        std::fs::remove_file(&zip).ok();
    }

    #[test]
    fn import_file_skips_files_already_in_storage() {
        let store = temp_store();

        let mp4 = std::env::temp_dir().join(format!("rosemyne-import-{}.mp4", rand::random::<u64>()));
        std::fs::write(&mp4, b"video-bytes").unwrap();

        let video = store.import_file(&mp4, None).unwrap().unwrap();
        let count_after_first_import = store.query(empty_filter(), None, None, 50).unwrap().items.len();

        // Re-"importing" the file we just copied in (e.g. a native drag of one
        // of our own cards dropped back onto the window) must be a no-op.
        let reimported = store.import_file(&video.file_path, None).unwrap();
        assert!(reimported.is_none());
        assert_eq!(
            store.query(empty_filter(), None, None, 50).unwrap().items.len(),
            count_after_first_import
        );

        std::fs::remove_file(&mp4).ok();
    }
}

