use std::borrow::Cow;
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
        /// Empty (or absent) scopes the group to the whole row.
        #[serde(default)]
        scope: Vec<String>,
        children: Vec<FilterNode>,
    },
    // Struct-variant fields need their own `rename_all`; the enum's only cases the tag.
    #[serde(rename_all = "camelCase")]
    Condition {
        path: Vec<String>,
        operation: u8,
        values: Vec<Value>,
        /// Absent in filters saved before this existed, which read as insensitive.
        #[serde(default)]
        case_sensitive: bool,
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

// Insensitive conditions fold both sides first, so smart-case would only misfire.
static FUZZY_MATCHER: LazyLock<SkimMatcherV2> = LazyLock::new(|| SkimMatcherV2::default().respect_case());

/// SQL mirror of [`fold`]; `store::SCHEMA`'s expression indexes are built on it.
pub(super) const FOLD_FN: &str = "rosemyne_fold";

/// Both evaluators, the compiled SQL and the fold indexes must agree byte for byte.
pub fn fold(value: &str) -> String {
    value.to_lowercase()
}

fn cased(value: &str, case_sensitive: bool) -> Cow<'_, str> {
    if case_sensitive { Cow::Borrowed(value) } else { Cow::Owned(fold(value)) }
}

/// A resolved path candidate: either a scalar value or a "missing key" marker,
/// mirroring how the JS matcher lets `undefined` flow through `resolvePath`.
enum Candidate<'a> {
    Scalar(&'a Value),
    Missing,
}

pub fn eval(node: &FilterNode, tags: &Value) -> bool {
    match node {
        FilterNode::Group {
            relation,
            scope,
            children,
        } => {
            if children.is_empty() {
                return true;
            }
            let matches = |value: &Value| {
                if *relation == RELATION_OR {
                    children.iter().any(|child| eval(child, value))
                } else {
                    children.iter().all(|child| eval(child, value))
                }
            };
            if scope.is_empty() {
                return matches(tags);
            }
            let mut candidates = Vec::new();
            resolve_scope(tags, scope, &mut candidates);
            candidates.iter().any(|candidate| matches(candidate))
        }
        FilterNode::Condition {
            path,
            operation,
            values,
            case_sensitive,
        } => {
            if path.is_empty() || values.is_empty() {
                return true;
            }
            let candidates = resolve_path(tags, path);
            candidates.iter().any(|actual| {
                values
                    .iter()
                    .any(|value| apply_operation(*operation, value, actual, *case_sensitive))
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

/// `resolve_path`'s counterpart for scopes: the containers at the path, not the scalars under it.
fn resolve_scope<'a>(value: &'a Value, path: &[String], out: &mut Vec<&'a Value>) {
    if let Value::Array(items) = value {
        for item in items {
            resolve_scope(item, path, out);
        }
        return;
    }

    if path.is_empty() {
        if !value.is_null() {
            out.push(value);
        }
        return;
    }

    if let Value::Object(map) = value {
        let (head, rest) = path.split_first().expect("path is non-empty");
        if let Some(next) = map.get(head) {
            resolve_scope(next, rest, out);
        }
    }
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

fn apply_operation(operation: u8, filter: &Value, actual: &Candidate, case_sensitive: bool) -> bool {
    // equals/notEquals use JS `===`/`!==`, which also apply to a missing candidate.
    match operation {
        EQUALS => return strict_eq(actual, filter, case_sensitive),
        NOT_EQUALS => return !strict_eq(actual, filter, case_sensitive),
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
        let (a, f) = (cased(a, case_sensitive), cased(f, case_sensitive));
        let (a, f) = (a.as_ref(), f.as_ref());
        match operation {
            CONTAINS => return a.contains(f),
            NOT_CONTAINS => return !a.contains(f),
            STARTS_WITH => return a.starts_with(f),
            ENDS_WITH => return a.ends_with(f),
            FUZZY => return f.is_empty() || FUZZY_MATCHER.fuzzy_match(a, f).is_some(),
            _ => {}
        }
    }

    false
}

fn strict_eq(actual: &Candidate, filter: &Value, case_sensitive: bool) -> bool {
    let Candidate::Scalar(actual) = actual else {
        return false;
    };
    match (actual, filter) {
        (Value::Number(a), Value::Number(f)) => a.as_f64() == f.as_f64(),
        (Value::String(a), Value::String(f)) => cased(a, case_sensitive) == cased(f, case_sensitive),
        (Value::Bool(a), Value::Bool(f)) => a == f,
        _ => false,
    }
}

/// Injects the virtual `$file` tag (Name/Path/Type/DateTime/Size, backed by
/// table columns) into a row's tags so the evaluator can treat it like any
/// other tag. `$`-prefixed top-level keys are reserved for such system fields
///, see CLAUDE.md. `Size` is omitted (not written as `null`) when
/// `file_size` is `None`, so `resolve_path` treats it as a missing key, same
/// as any other optional tag, rather than a present-but-null value (which
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

/// Must run before `SCHEMA` and on every writing connection: the fold indexes call it.
pub fn register_fold(conn: &Connection) -> rusqlite::Result<()> {
    conn.create_scalar_function(
        FOLD_FN,
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            Ok(match ctx.get_raw(0) {
                rusqlite::types::ValueRef::Text(bytes) => Some(fold(&String::from_utf8_lossy(bytes))),
                _ => None,
            })
        },
    )
}

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
        cond_cased(path, operation, values, false)
    }

    fn cond_cased(path: &[&str], operation: u8, values: Vec<Value>, case_sensitive: bool) -> FilterNode {
        FilterNode::Condition {
            path: path.iter().map(|s| s.to_string()).collect(),
            operation,
            values,
            case_sensitive,
        }
    }

    fn group(relation: u8, scope: &[&str], children: Vec<FilterNode>) -> FilterNode {
        FilterNode::Group {
            relation,
            scope: scope.iter().map(|s| s.to_string()).collect(),
            children,
        }
    }

    fn matches(node: &FilterNode, tags: Value) -> bool {
        eval(node, &tags)
    }

    fn windows() -> Value {
        json!({
            "Windows": [
                { "Name": "code", "Percentage": 0.75 },
                { "Name": "firefox", "Percentage": 0.25 },
            ]
        })
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
    fn case_sensitivity_is_per_condition() {
        let tags = json!({ "ProcessName": "FireFox" });
        for (operation, value) in [
            (EQUALS, "firefox"),
            (CONTAINS, "FOX"),
            (STARTS_WITH, "fire"),
            (ENDS_WITH, "FOX"),
        ] {
            assert!(matches(&cond(&["ProcessName"], operation, vec![json!(value)]), tags.clone()));
            assert!(!matches(&cond_cased(&["ProcessName"], operation, vec![json!(value)], true), tags.clone()));
        }
        // notContains inverts, so insensitivity makes it fail where sensitivity passes.
        assert!(!matches(&cond(&["ProcessName"], NOT_CONTAINS, vec![json!("FOX")]), tags.clone()));
        assert!(matches(&cond_cased(&["ProcessName"], NOT_CONTAINS, vec![json!("FOX")], true), tags));
    }

    #[test]
    fn case_folding_is_unicode_aware() {
        let tags = json!({ "WindowTitle": "ÉCOLE", "Process": "ПРИВЕТ" });
        assert!(matches(&cond(&["WindowTitle"], EQUALS, vec![json!("école")]), tags.clone()));
        assert!(matches(&cond(&["Process"], CONTAINS, vec![json!("привет")]), tags.clone()));
        assert!(!matches(&cond_cased(&["WindowTitle"], EQUALS, vec![json!("école")], true), tags));
    }

    #[test]
    fn case_sensitive_defaults_to_false_when_absent() {
        // Filters saved before the flag existed carry no `caseSensitive` key.
        let json = r#"{ "kind": "condition", "path": ["ProcessName"], "operation": 0, "values": ["FIREFOX"] }"#;
        let node: FilterNode = serde_json::from_str(json).unwrap();
        assert!(eval(&node, &json!({ "ProcessName": "firefox" })));
    }

    #[test]
    fn case_sensitive_decodes_from_the_camel_case_key() {
        // The frontend sends `caseSensitive`; a snake_case field would silently
        // miss it and `serde(default)` would swallow the mismatch as `false`.
        let json = r#"{ "id": 1, "kind": "condition", "path": ["ProcessName"],
                        "valueType": "string", "operation": 0, "values": ["FIREFOX"],
                        "caseSensitive": true }"#;
        let node: FilterNode = serde_json::from_str(json).unwrap();
        assert!(matches!(node, FilterNode::Condition { case_sensitive: true, .. }));
        assert!(!eval(&node, &json!({ "ProcessName": "firefox" })));
        assert!(eval(&node, &json!({ "ProcessName": "FIREFOX" })));
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
        let and = group(0, &[], vec![
            cond(&["a"], EQUALS, vec![json!("1")]),
            cond(&["b"], EQUALS, vec![json!("2")]),
        ]);
        let or = group(RELATION_OR, &[], vec![
            cond(&["a"], EQUALS, vec![json!("nope")]),
            cond(&["b"], EQUALS, vec![json!("2")]),
        ]);
        assert!(matches(&and, tags.clone()));
        assert!(matches(&or, tags.clone()));
        // Empty group matches everything.
        assert!(matches(&group(0, &[], vec![]), tags));
    }

    #[test]
    fn scoped_and_requires_one_element_to_satisfy_every_child() {
        let children = vec![
            cond(&["Name"], EQUALS, vec![json!("firefox")]),
            cond(&["Percentage"], GREATER_THAN, vec![json!(0.5)]),
        ];
        // Unscoped, the two conditions are satisfied by different windows.
        assert!(matches(
            &group(0, &[], vec![
                cond(&["Windows", "Name"], EQUALS, vec![json!("firefox")]),
                cond(&["Windows", "Percentage"], GREATER_THAN, vec![json!(0.5)]),
            ]),
            windows()
        ));
        assert!(!matches(&group(0, &["Windows"], children), windows()));
        assert!(matches(
            &group(0, &["Windows"], vec![
                cond(&["Name"], EQUALS, vec![json!("code")]),
                cond(&["Percentage"], GREATER_THAN, vec![json!(0.5)]),
            ]),
            windows()
        ));
    }

    #[test]
    fn scoped_or_matches_any_element() {
        assert!(matches(
            &group(RELATION_OR, &["Windows"], vec![
                cond(&["Name"], EQUALS, vec![json!("firefox")]),
                cond(&["Percentage"], GREATER_THAN, vec![json!(0.9)]),
            ]),
            windows()
        ));
    }

    #[test]
    fn scope_without_candidates_does_not_match() {
        let scoped = group(0, &["Windows"], vec![cond(&["Name"], NOT_EQUALS, vec![json!("x")])]);
        assert!(!matches(&scoped, json!({})));
        assert!(!matches(&scoped, json!({ "Windows": [] })));
        assert!(matches(&scoped, windows()));
        // An empty scoped group still matches everything, like any empty group.
        assert!(matches(&group(0, &["Windows"], vec![]), json!({})));
    }

    #[test]
    fn nested_scopes_resolve_relative_to_their_parent() {
        let tags = json!({
            "Windows": [
                { "Name": "code", "Tabs": [{ "Title": "main.rs", "Pinned": true }] },
                { "Name": "firefox", "Tabs": [{ "Title": "docs", "Pinned": false }] },
            ]
        });
        let filter = |window: &str, title: &str| group(0, &["Windows"], vec![
            cond(&["Name"], EQUALS, vec![json!(window)]),
            group(0, &["Tabs"], vec![
                cond(&["Title"], EQUALS, vec![json!(title)]),
                cond(&["Pinned"], EQUALS, vec![json!(true)]),
            ]),
        ]);
        assert!(matches(&filter("code", "main.rs"), tags.clone()));
        assert!(!matches(&filter("firefox", "main.rs"), tags.clone()));
        assert!(!matches(&filter("firefox", "docs"), tags));
    }
}
