use std::sync::{Arc, LazyLock, Mutex};

use fuzzy_matcher::FuzzyMatcher;
use fuzzy_matcher::skim::SkimMatcherV2;
use rusqlite::Connection;
use rusqlite::functions::FunctionFlags;
use serde::Deserialize;
use serde_json::Value;

use crate::screen_manager::screenshot_manager::{DATE_TIME_TAG_KEY, TIME_TAG_KEY};

/// Rust mirror of the frontend filter tree (`src/types/screenshot.ts`). `id` and
/// `valueType` are sent but unused for matching, so they're ignored on decode.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FilterNode {
    Group {
        relation: u8,
        children: Vec<FilterNode>,
    },
    Condition {
        path: Vec<String>,
        operation: u8,
        values: Vec<Value>,
    },
}

// Operation codes mirror the `FilterOperations` enum order in screenshot.ts.
pub(super) const EQUALS: u8 = 0;
pub(super) const NOT_EQUALS: u8 = 1;
pub(super) const GREATER_THAN: u8 = 2;
pub(super) const LESS_THAN: u8 = 3;
pub(super) const GREATER_OR_EQUAL: u8 = 4;
pub(super) const LESS_OR_EQUAL: u8 = 5;
pub(super) const CONTAINS: u8 = 6;
pub(super) const NOT_CONTAINS: u8 = 7;
pub(super) const STARTS_WITH: u8 = 8;
pub(super) const ENDS_WITH: u8 = 9;
pub(super) const FUZZY: u8 = 10;

// `FilterRelationOperations`: and = 0, or = 1.
pub(super) const RELATION_OR: u8 = 1;

static FUZZY_MATCHER: LazyLock<SkimMatcherV2> = LazyLock::new(SkimMatcherV2::default);

/// A resolved path candidate: either a scalar value or a "missing key" marker,
/// mirroring how the JS matcher lets `undefined` flow through `resolvePath`.
enum Candidate<'a> {
    Scalar(&'a Value),
    Missing,
}

pub fn eval(node: &FilterNode, tags: &Value) -> bool {
    match node {
        FilterNode::Group { relation, children } => {
            if children.is_empty() {
                return true;
            }
            if *relation == RELATION_OR {
                children.iter().any(|child| eval(child, tags))
            } else {
                children.iter().all(|child| eval(child, tags))
            }
        }
        FilterNode::Condition {
            path,
            operation,
            values,
        } => {
            if path.is_empty() || values.is_empty() {
                return true;
            }
            let candidates = resolve_path(tags, path);
            candidates.iter().any(|actual| {
                values
                    .iter()
                    .any(|value| apply_operation(*operation, value, actual))
            })
        }
    }
}

/// Recognizes the wrapped-value convention for `Time`/`DateTime` tags: a
/// single-key object `{ "$time": <ms> }` / `{ "$dateTime": <ms> }` wrapping a
/// millisecond number, produced by `TagValue::time_millis`/`date_time_millis`.
/// Everything else in `tags` stays a plain JSON scalar/object/array.
pub(super) fn marker_scalar(value: &Value) -> Option<(&'static str, &Value)> {
    let Value::Object(map) = value else { return None };
    if map.len() != 1 {
        return None;
    }
    if let Some(inner @ Value::Number(_)) = map.get(TIME_TAG_KEY) {
        return Some(("time", inner));
    }
    if let Some(inner @ Value::Number(_)) = map.get(DATE_TIME_TAG_KEY) {
        return Some(("dateTime", inner));
    }
    None
}

fn resolve_path<'a>(value: &'a Value, path: &[String]) -> Vec<Candidate<'a>> {
    if let Value::Array(items) = value {
        return items
            .iter()
            .flat_map(|item| resolve_path(item, path))
            .collect();
    }

    if path.is_empty() {
        return match value {
            Value::Null => vec![],
            Value::Object(_) => match marker_scalar(value) {
                Some((_, inner)) => vec![Candidate::Scalar(inner)],
                None => vec![],
            },
            scalar => vec![Candidate::Scalar(scalar)],
        };
    }

    match value {
        Value::Object(map) => {
            let (head, rest) = path.split_first().expect("path is non-empty");
            match map.get(head) {
                Some(next) => resolve_path(next, rest),
                // Absent key: JS `resolvePath(undefined, rest)` yields a single
                // `undefined` only when it was the final segment, else nothing.
                None if rest.is_empty() => vec![Candidate::Missing],
                None => vec![],
            }
        }
        _ => vec![],
    }
}

fn apply_operation(operation: u8, filter: &Value, actual: &Candidate) -> bool {
    // equals/notEquals use JS `===`/`!==`, which also apply to a missing candidate.
    match operation {
        EQUALS => return strict_eq(actual, filter),
        NOT_EQUALS => return !strict_eq(actual, filter),
        _ => {}
    }

    let Candidate::Scalar(actual) = actual else {
        return false;
    };

    if let (Value::Number(a), Value::Number(f)) = (actual, filter) {
        let (a, f) = (a.as_f64().unwrap_or(f64::NAN), f.as_f64().unwrap_or(f64::NAN));
        match operation {
            GREATER_THAN => return a > f,
            GREATER_OR_EQUAL => return a >= f,
            LESS_THAN => return a < f,
            LESS_OR_EQUAL => return a <= f,
            _ => {}
        }
    }

    if let (Value::String(a), Value::String(f)) = (actual, filter) {
        match operation {
            CONTAINS => return a.contains(f.as_str()),
            NOT_CONTAINS => return !a.contains(f.as_str()),
            STARTS_WITH => return a.starts_with(f.as_str()),
            ENDS_WITH => return a.ends_with(f.as_str()),
            FUZZY => return f.is_empty() || FUZZY_MATCHER.fuzzy_match(a, f).is_some(),
            _ => {}
        }
    }

    false
}

fn strict_eq(actual: &Candidate, filter: &Value) -> bool {
    let Candidate::Scalar(actual) = actual else {
        return false;
    };
    match (actual, filter) {
        (Value::Number(a), Value::Number(f)) => a.as_f64() == f.as_f64(),
        (Value::String(a), Value::String(f)) => a == f,
        (Value::Bool(a), Value::Bool(f)) => a == f,
        _ => false,
    }
}

/// Injects the virtual `$file` tag (Name/Path/Type/DateTime/Size, backed by
/// table columns) into a row's tags so the evaluator can treat it like any
/// other tag. `$`-prefixed top-level keys are reserved for such system fields
/// , see CLAUDE.md. `Size` is omitted (not written as `null`) when
/// `file_size` is `None`, so `resolve_path` treats it as a missing key , same
/// as any other optional tag , rather than a present-but-null value (which
/// `resolve_path` drops instead of treating as missing).
pub fn augment_tags(
    tags: Value,
    file_name: &str,
    file_path: &str,
    item_type: &str,
    date_time_ms: i64,
    file_size: Option<i64>,
) -> Value {
    let mut map = match tags {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    let mut file = serde_json::Map::new();
    file.insert("Name".to_string(), Value::String(file_name.to_string()));
    file.insert("Path".to_string(), Value::String(file_path.to_string()));
    file.insert("Type".to_string(), Value::String(item_type.to_string()));
    file.insert("DateTime".to_string(), Value::Number(date_time_ms.into()));
    if let Some(size) = file_size {
        file.insert("Size".to_string(), Value::Number(size.into()));
    }
    map.insert("$file".to_string(), Value::Object(file));
    Value::Object(map)
}

/// Holds the filter for the currently-running query. Reads happen inside
/// `filter_match` on the same (Mutex-serialized) thread that set it.
pub type FilterSlot = Arc<Mutex<Option<Arc<FilterNode>>>>;

/// Registers `filter_match(tags, file_name, file_path, type, date_time_ms, file_size)`;
/// it evaluates the node currently in `slot` against the row's tags augmented
/// with the `$file` columns. No active filter → matches every row.
pub fn register_filter_match(conn: &Connection, slot: FilterSlot) -> rusqlite::Result<()> {
    conn.create_scalar_function(
        "filter_match",
        6,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        move |ctx| {
            let filter = slot.lock().expect("filter slot not poisoned").clone();
            let Some(filter) = filter else {
                return Ok(true);
            };

            let tags = match ctx.get_raw(0) {
                rusqlite::types::ValueRef::Text(bytes) => {
                    serde_json::from_slice::<Value>(bytes).unwrap_or(Value::Null)
                }
                _ => Value::Null,
            };
            let file_name: String = ctx.get(1)?;
            let file_path: String = ctx.get(2)?;
            let item_type: String = ctx.get(3)?;
            let date_time_ms: i64 = ctx.get(4)?;
            let file_size: Option<i64> = ctx.get(5)?;

            Ok(eval(
                &filter,
                &augment_tags(tags, &file_name, &file_path, &item_type, date_time_ms, file_size),
            ))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cond(path: &[&str], operation: u8, values: Vec<Value>) -> FilterNode {
        FilterNode::Condition {
            path: path.iter().map(|s| s.to_string()).collect(),
            operation,
            values,
        }
    }

    fn matches(node: &FilterNode, tags: Value) -> bool {
        eval(node, &tags)
    }

    #[test]
    fn equals_and_not_equals() {
        let tags = json!({ "ProcessName": "firefox" });
        assert!(matches(&cond(&["ProcessName"], EQUALS, vec![json!("firefox")]), tags.clone()));
        assert!(!matches(&cond(&["ProcessName"], EQUALS, vec![json!("chrome")]), tags.clone()));
        assert!(matches(&cond(&["ProcessName"], NOT_EQUALS, vec![json!("chrome")]), tags));
    }

    #[test]
    fn not_equals_matches_missing_key() {
        // Parity with the JS matcher: `undefined !== "x"` is true.
        assert!(matches(&cond(&["Missing"], NOT_EQUALS, vec![json!("x")]), json!({})));
        assert!(!matches(&cond(&["Missing"], EQUALS, vec![json!("x")]), json!({})));
    }

    #[test]
    fn numeric_ranges() {
        let tags = json!({ "Timestamp": 1500 });
        assert!(matches(&cond(&["Timestamp"], GREATER_THAN, vec![json!(1000)]), tags.clone()));
        assert!(!matches(&cond(&["Timestamp"], LESS_THAN, vec![json!(1000)]), tags.clone()));
        assert!(matches(&cond(&["Timestamp"], GREATER_OR_EQUAL, vec![json!(1500)]), tags));
    }

    #[test]
    fn string_ops() {
        let tags = json!({ "WindowTitle": "rosemyne - Visual Studio Code" });
        assert!(matches(&cond(&["WindowTitle"], CONTAINS, vec![json!("Visual")]), tags.clone()));
        assert!(matches(&cond(&["WindowTitle"], STARTS_WITH, vec![json!("rose")]), tags.clone()));
        assert!(matches(&cond(&["WindowTitle"], ENDS_WITH, vec![json!("Code")]), tags.clone()));
        assert!(!matches(&cond(&["WindowTitle"], NOT_CONTAINS, vec![json!("rose")]), tags));
    }

    #[test]
    fn array_expansion_existential() {
        // `Windows` is an array of maps; the path expands across elements.
        let tags = json!({
            "Windows": [
                { "Window Name": "notepad", "Process Name": "notepad" },
                { "Window Name": "firefox", "Process Name": "firefox" },
            ]
        });
        assert!(matches(&cond(&["Windows", "Window Name"], EQUALS, vec![json!("firefox")]), tags.clone()));
        assert!(!matches(&cond(&["Windows", "Window Name"], EQUALS, vec![json!("chrome")]), tags));
    }

    #[test]
    fn time_and_date_time_markers_resolve_as_numbers() {
        let tags = json!({ "Duration": { "$time": 5000 }, "CapturedAt": { "$dateTime": 1_737_000_000_000i64 } });
        assert!(matches(&cond(&["Duration"], EQUALS, vec![json!(5000)]), tags.clone()));
        assert!(matches(&cond(&["Duration"], GREATER_THAN, vec![json!(1000)]), tags.clone()));
        assert!(!matches(&cond(&["Duration"], LESS_THAN, vec![json!(1000)]), tags.clone()));
        assert!(matches(&cond(&["CapturedAt"], LESS_OR_EQUAL, vec![json!(1_737_000_000_000i64)]), tags.clone()));
        assert!(matches(&cond(&["CapturedAt"], NOT_EQUALS, vec![json!(0)]), tags));
    }

    #[test]
    fn fuzzy_threshold() {
        // Approximate (subsequence) fuzzy: an in-order character match passes.
        let tags = json!({ "WindowTitle": "firefox" });
        assert!(matches(&cond(&["WindowTitle"], FUZZY, vec![json!("ffx")]), tags.clone()));
        assert!(matches(&cond(&["WindowTitle"], FUZZY, vec![json!("")]), tags.clone()));
        assert!(!matches(&cond(&["WindowTitle"], FUZZY, vec![json!("zzz")]), tags));
    }

    #[test]
    fn deserializes_frontend_payload() {
        // Exact shape the frontend sends: extra `id`/`valueType` fields, enum-number
        // `relation`/`operation` (6 = contains).
        let json = r#"{
            "id": 1, "kind": "group", "relation": 0,
            "children": [
                { "id": 2, "kind": "condition", "path": ["ProcessName"],
                  "valueType": "string", "operation": 6, "values": ["fire"] }
            ]
        }"#;
        let node: FilterNode = serde_json::from_str(json).unwrap();
        assert!(eval(&node, &json!({ "ProcessName": "firefox" })));
        assert!(!eval(&node, &json!({ "ProcessName": "chrome" })));
    }

    #[test]
    fn group_and_or() {
        let tags = json!({ "a": "1", "b": "2" });
        let and = FilterNode::Group {
            relation: 0,
            children: vec![
                cond(&["a"], EQUALS, vec![json!("1")]),
                cond(&["b"], EQUALS, vec![json!("2")]),
            ],
        };
        let or = FilterNode::Group {
            relation: RELATION_OR,
            children: vec![
                cond(&["a"], EQUALS, vec![json!("nope")]),
                cond(&["b"], EQUALS, vec![json!("2")]),
            ],
        };
        assert!(matches(&and, tags.clone()));
        assert!(matches(&or, tags.clone()));
        // Empty group matches everything.
        assert!(matches(&FilterNode::Group { relation: 0, children: vec![] }, tags));
    }
}
