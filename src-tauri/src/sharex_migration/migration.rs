use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

use chrono::{DateTime, Local, NaiveDateTime, Utc};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::error::MigrationError;
use crate::emit_on_main_thread;
use crate::screen_manager::screenshot_manager::{HistoryItemType, ImageHistoryData, TagValue};

/// Snapshot of existing Rosemyne state needed to plan the import without holding
/// the manager lock during the copy loop.
pub struct ExistingHistory {
    /// Lowercased file names already present, for collision-free renaming.
    pub names: HashSet<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MigrationSummary {
    pub imported: usize,
    pub skipped_non_image: usize,
    pub missing_file: usize,
    pub errors: usize,
    pub total: usize,
    pub dry_run: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MigrationProgress {
    current: usize,
    total: usize,
    current_file: String,
}

pub struct MigrationOutcome {
    pub summary: MigrationSummary,
    pub entries: Vec<ImageHistoryData>,
}

struct RawRow {
    file_name: Option<String>,
    file_path: Option<String>,
    date_time: Option<String>,
    host: Option<String>,
    url: Option<String>,
    deletion_url: Option<String>,
    shortened_url: Option<String>,
    tags: Option<String>,
}

struct PlannedCopy {
    source: PathBuf,
    dest_name: String,
    entry: ImageHistoryData,
}

pub fn run_migration(
    app_handle: &AppHandle,
    base_path: PathBuf,
    existing: ExistingHistory,
    sharex_path: &str,
    dry_run: bool,
) -> Result<MigrationOutcome, MigrationError> {
    let sharex_root = PathBuf::from(sharex_path);
    if !sharex_root.is_dir() {
        return Err(MigrationError::InvalidPath(sharex_path.to_string()));
    }

    let db_path = sharex_root.join("History.db");
    if !db_path.is_file() {
        return Err(MigrationError::DatabaseNotFound(
            db_path.display().to_string(),
        ));
    }

    // A running ShareX holds History.db with a lock that blocks plain reads.
    if let Err(err) = std::fs::File::open(&db_path) {
        return Err(MigrationError::DatabaseLocked(err.to_string()));
    }

    // Copy History.db to a staging file so SQLite never touches the original.
    std::fs::create_dir_all(&base_path)?;
    let staging_db = base_path.join(format!("sharex-history-{}.db", Utc::now().timestamp_millis()));
    std::fs::copy(&db_path, &staging_db)?;

    let result = process_database(
        app_handle,
        &base_path,
        &existing,
        &sharex_root,
        &staging_db,
        dry_run,
    );

    let _ = std::fs::remove_file(&staging_db);

    result
}

fn process_database(
    app_handle: &AppHandle,
    base_path: &Path,
    existing: &ExistingHistory,
    sharex_root: &Path,
    staging_db: &Path,
    dry_run: bool,
) -> Result<MigrationOutcome, MigrationError> {
    let conn = Connection::open_with_flags(staging_db, OpenFlags::SQLITE_OPEN_READ_ONLY)?;

    let mut stmt = conn.prepare(
        "SELECT FileName, FilePath, DateTime, Host, URL, DeletionURL, ShortenedURL, Tags \
         FROM History WHERE Type IN ('Image', 'File') ORDER BY DateTime",
    )?;

    let raw_rows = stmt
        .query_map([], |row| {
            Ok(RawRow {
                file_name: row.get(0)?,
                file_path: row.get(1)?,
                date_time: row.get(2)?,
                host: row.get(3)?,
                url: row.get(4)?,
                deletion_url: row.get(5)?,
                shortened_url: row.get(6)?,
                tags: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let images_dir = base_path.join("files");

    let mut summary = MigrationSummary {
        imported: 0,
        skipped_non_image: 0,
        missing_file: 0,
        errors: 0,
        total: raw_rows.len(),
        dry_run,
    };

    let mut used_names = existing.names.clone();
    let mut planned: Vec<PlannedCopy> = Vec::new();

    for row in raw_rows {
        let (Some(file_name), Some(file_path), Some(date_time_raw)) =
            (&row.file_name, &row.file_path, &row.date_time)
        else {
            summary.errors += 1;
            continue;
        };

        let Some(item_type) = Path::new(file_name)
            .extension()
            .and_then(|ext| ext.to_str())
            .and_then(HistoryItemType::from_extension)
        else {
            summary.skipped_non_image += 1;
            continue;
        };

        let Some(date_time) = parse_sharex_datetime(date_time_raw) else {
            summary.errors += 1;
            continue;
        };

        let Some(source) = resolve_source(file_path, file_name, date_time_raw, sharex_root) else {
            summary.missing_file += 1;
            continue;
        };

        let dest_name = unique_name(file_name, &mut used_names, &images_dir);

        // Remap ShareX's flat WindowTitle/ProcessName into our native `Windows`
        // tag shape; everything else migrates as-is.
        let mut tags: HashMap<String, TagValue> = HashMap::new();
        let mut window_entry: HashMap<String, TagValue> = HashMap::new();
        if let Some(raw) = &row.tags {
            if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(raw) {
                for (key, value) in map {
                    match key.as_str() {
                        "WindowTitle" => {
                            window_entry.insert("Window Name".to_string(), TagValue::String(value));
                        }
                        "ProcessName" => {
                            window_entry.insert("Process Name".to_string(), TagValue::String(value));
                        }
                        _ => {
                            tags.insert(key, TagValue::String(value));
                        }
                    }
                }
            }
        }
        if !window_entry.is_empty() {
            tags.insert("Windows".to_string(), TagValue::MapArray(vec![window_entry]));
        }
        if let Some(shortened) = row.shortened_url.clone().filter(|s| !s.is_empty()) {
            tags.insert("shortenedUrl".to_string(), TagValue::String(shortened));
        }

        let entry = ImageHistoryData {
            file_name: dest_name.clone(),
            file_path: images_dir.join(&dest_name),
            item_type,
            date_time,
            tags: Some(tags),
            file_size: None,
            host: row.host.clone().filter(|s| !s.is_empty()),
            url: row.url.clone().filter(|s| !s.is_empty()),
            deletion_url: row.deletion_url.clone().filter(|s| !s.is_empty()),
            upload_error: None,
        };

        planned.push(PlannedCopy {
            source,
            dest_name,
            entry,
        });
    }

    if dry_run {
        summary.imported = planned.len();
        return Ok(MigrationOutcome {
            summary,
            entries: Vec::new(),
        });
    }

    std::fs::create_dir_all(&images_dir)?;

    let required: u64 = planned
        .iter()
        .filter_map(|plan| std::fs::metadata(&plan.source).ok().map(|meta| meta.len()))
        .sum();
    if let Some(available) = free_space_bytes(&images_dir) {
        if available < required {
            return Err(MigrationError::InsufficientSpace {
                required,
                available,
            });
        }
    }

    let total = planned.len();
    let mut entries = Vec::with_capacity(total);

    for (index, mut plan) in planned.into_iter().enumerate() {
        let source_len = std::fs::metadata(&plan.source).map(|meta| meta.len()).ok();

        match std::fs::copy(&plan.source, &plan.entry.file_path) {
            Ok(copied) if source_len.map(|len| len == copied).unwrap_or(true) => {
                plan.entry.file_size = Some(copied);
                entries.push(plan.entry);
            }
            Ok(_) => {
                let _ = std::fs::remove_file(&plan.entry.file_path);
                summary.errors += 1;
            }
            Err(_) => {
                summary.errors += 1;
            }
        }

        if index == 0 || index + 1 == total || (index + 1) % 16 == 0 {
            emit_on_main_thread!(
                app_handle,
                "migration://progress",
                MigrationProgress {
                    current: index + 1,
                    total,
                    current_file: plan.dest_name,
                }
            );
        }
    }

    summary.imported = entries.len();

    Ok(MigrationOutcome { summary, entries })
}

/// ShareX serializes with `DateTime.ToString("o")`. Offset-bearing strings are
/// RFC 3339; offset-less ones (serialized from `DateTimeKind.Unspecified`) are
/// interpreted as local time.
fn parse_sharex_datetime(raw: &str) -> Option<DateTime<Utc>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Some(dt.with_timezone(&Utc));
    }

    let naive = NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f")
        .or_else(|_| NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S"))
        .ok()?;

    naive
        .and_local_timezone(Local)
        .earliest()
        .map(|dt| dt.with_timezone(&Utc))
}

fn resolve_source(
    file_path: &str,
    file_name: &str,
    date_time_raw: &str,
    sharex_root: &Path,
) -> Option<PathBuf> {
    let direct = PathBuf::from(file_path);
    if direct.is_file() {
        return Some(direct);
    }

    // Fallback for a moved ShareX folder: the month folder name (YYYY-MM) is the
    // date string's prefix, since ShareX derives both from the same timestamp.
    if date_time_raw.len() >= 7 {
        let month = &date_time_raw[..7];
        let candidate = sharex_root.join("Screenshots").join(month).join(file_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

fn unique_name(desired: &str, used: &mut HashSet<String>, images_dir: &Path) -> String {
    let path = Path::new(desired);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let ext = path.extension().and_then(|e| e.to_str());

    let mut candidate = desired.to_string();
    let mut suffix = 1;

    loop {
        let key = candidate.to_lowercase();
        if !used.contains(&key) && !images_dir.join(&candidate).exists() {
            used.insert(key);
            return candidate;
        }

        candidate = match ext {
            Some(ext) => format!("{}-{}.{}", stem, suffix, ext),
            None => format!("{}-{}", stem, suffix),
        };
        suffix += 1;
    }
}

#[cfg(target_os = "windows")]
fn free_space_bytes(path: &Path) -> Option<u64> {
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    use windows::core::{HSTRING, PCWSTR};

    let wide = HSTRING::from(path.as_os_str());
    let mut free_available: u64 = 0;

    let result = unsafe {
        GetDiskFreeSpaceExW(
            PCWSTR::from_raw(wide.as_ptr()),
            Some(&mut free_available),
            None,
            None,
        )
    };

    result.ok().map(|_| free_available)
}

#[cfg(not(target_os = "windows"))]
fn free_space_bytes(_path: &Path) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn parses_dotnet_offset_timestamp() {
        // ShareX "o" format: 7-digit fractional seconds + explicit offset.
        let dt = parse_sharex_datetime("2019-07-30T16:46:48.2659372+03:00").unwrap();
        assert_eq!(dt, Utc.with_ymd_and_hms(2019, 7, 30, 13, 46, 48).unwrap() + chrono::Duration::nanoseconds(265_937_200));
    }

    #[test]
    fn parses_offsetless_timestamp_as_local() {
        assert!(parse_sharex_datetime("2020-01-15T10:20:30.1234567").is_some());
        assert!(parse_sharex_datetime("2020-01-15T10:20:30").is_some());
    }

    #[test]
    fn rejects_garbage_timestamp() {
        assert!(parse_sharex_datetime("not a date").is_none());
    }

    #[test]
    fn classifies_migrated_extensions() {
        assert_eq!(HistoryItemType::from_extension("PNG"), Some(HistoryItemType::Image));
        assert_eq!(HistoryItemType::from_extension("jpeg"), Some(HistoryItemType::Image));
        // Videos are now imported (previously skipped).
        assert_eq!(HistoryItemType::from_extension("mp4"), Some(HistoryItemType::Video));
        assert_eq!(HistoryItemType::from_extension("mkv"), Some(HistoryItemType::Video));
        // Unsupported types are skipped in the migration.
        assert_eq!(HistoryItemType::from_extension("txt"), None);
    }

    #[test]
    fn unique_name_avoids_collisions() {
        let dir = std::env::temp_dir().join("rosemyne-nonexistent-test-dir");
        let mut used = HashSet::new();
        assert_eq!(unique_name("a.png", &mut used, &dir), "a.png");
        assert_eq!(unique_name("a.png", &mut used, &dir), "a-1.png");
        assert_eq!(unique_name("a.png", &mut used, &dir), "a-2.png");
    }
}
