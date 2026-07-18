use std::collections::HashSet;

use rusqlite::types::Value as SqlValue;
use serde_json::Value;

use super::filter::{
    CONTAINS, ENDS_WITH, EQUALS, FUZZY, FilterNode, GREATER_OR_EQUAL, GREATER_THAN, LESS_OR_EQUAL,
    LESS_THAN, NOT_CONTAINS, NOT_EQUALS, RELATION_OR, STARTS_WITH, marker_scalar,
};

/// SQL prefilter compiled from a filter tree, evaluated against `history AS h`
/// via `tag_index` subqueries. The expression matches a superset of the rows
/// the tree matches; when `exact` it matches exactly and the `filter_match`
/// residual can be skipped entirely.
pub struct CompiledFilter {
    pub expr: String,
    pub params: Vec<SqlValue>,
    pub exact: bool,
}

pub fn compile(node: &FilterNode) -> CompiledFilter {
    match node {
        FilterNode::Group { relation, children } => {
            if children.is_empty() {
                return literal("1", true);
            }
            let parts: Vec<CompiledFilter> = children.iter().map(compile).collect();
            let joiner = if *relation == RELATION_OR { " OR " } else { " AND " };
            CompiledFilter {
                expr: format!(
                    "({})",
                    parts.iter().map(|p| p.expr.as_str()).collect::<Vec<_>>().join(joiner)
                ),
                exact: parts.iter().all(|p| p.exact),
                params: parts.into_iter().flat_map(|p| p.params).collect(),
            }
        }
        FilterNode::Condition { path, operation, values } => {
            compile_condition(path, *operation, values)
        }
    }
}

fn compile_condition(path: &[String], operation: u8, values: &[Value]) -> CompiledFilter {
    if path.is_empty() || values.is_empty() {
        return literal("1", true);
    }
    if !is_known_operation(operation) {
        return literal("1", false);
    }
    // Virtual `$file` paths are backed by always-present table columns, so
    // every operation except fuzzy compiles exactly , including notEquals.
    if let Some((column, kind)) = file_column(path) {
        return match kind {
            FileColumnKind::Text => compile_file_text_condition(column, operation, values),
            FileColumnKind::Number => compile_file_number_condition(column, operation, values),
        };
    }
    // A missing key satisfies notEquals, which the index (present values only)
    // can't see; defer to the evaluator.
    if operation == NOT_EQUALS {
        return literal("1", false);
    }

    let path_key = serde_json::to_string(path).expect("path is serializable");
    let mut preds: Vec<String> = Vec::new();
    let mut params = vec![SqlValue::Text(path_key)];
    let mut exact = true;

    for value in values {
        match operation {
            EQUALS => match value {
                Value::String(s) => {
                    preds.push("(kind = 's' AND value_text = ?)".into());
                    params.push(SqlValue::Text(s.clone()));
                }
                Value::Number(n) => {
                    if let Some(f) = n.as_f64() {
                        preds.push("(kind = 'n' AND value_num = ?)".into());
                        params.push(SqlValue::Real(f));
                    }
                }
                Value::Bool(b) => {
                    preds.push("(kind = 'b' AND value_num = ?)".into());
                    params.push(SqlValue::Real(if *b { 1.0 } else { 0.0 }));
                }
                _ => {}
            },
            GREATER_THAN | GREATER_OR_EQUAL | LESS_THAN | LESS_OR_EQUAL => {
                if let Value::Number(n) = value {
                    if let Some(f) = n.as_f64() {
                        let op = match operation {
                            GREATER_THAN => ">",
                            GREATER_OR_EQUAL => ">=",
                            LESS_THAN => "<",
                            _ => "<=",
                        };
                        preds.push(format!("(kind = 'n' AND value_num {op} ?)"));
                        params.push(SqlValue::Real(f));
                    }
                }
            }
            CONTAINS => {
                if let Value::String(s) = value {
                    if s.is_empty() {
                        preds.push("kind = 's'".into());
                    } else {
                        preds.push("(kind = 's' AND instr(value_text, ?) > 0)".into());
                        params.push(SqlValue::Text(s.clone()));
                    }
                }
            }
            NOT_CONTAINS => {
                // `!x.contains("")` is always false, so empty patterns drop out.
                if let Value::String(s) = value {
                    if !s.is_empty() {
                        preds.push("(kind = 's' AND instr(value_text, ?) = 0)".into());
                        params.push(SqlValue::Text(s.clone()));
                    }
                }
            }
            STARTS_WITH => {
                if let Value::String(s) = value {
                    if s.is_empty() {
                        preds.push("kind = 's'".into());
                    } else {
                        preds.push("(kind = 's' AND substr(value_text, 1, ?) = ?)".into());
                        params.push(SqlValue::Integer(s.chars().count() as i64));
                        params.push(SqlValue::Text(s.clone()));
                    }
                }
            }
            ENDS_WITH => {
                if let Value::String(s) = value {
                    if s.is_empty() {
                        preds.push("kind = 's'".into());
                    } else {
                        let chars = s.chars().count() as i64;
                        preds.push(
                            "(kind = 's' AND length(value_text) >= ? AND substr(value_text, -?) = ?)"
                                .into(),
                        );
                        params.push(SqlValue::Integer(chars));
                        params.push(SqlValue::Integer(chars));
                        params.push(SqlValue::Text(s.clone()));
                    }
                }
            }
            FUZZY => {
                // Subsequence matching isn't indexable: narrow to rows with a
                // string at the path and let the residual decide.
                if let Value::String(s) = value {
                    preds.push("kind = 's'".into());
                    if !s.is_empty() {
                        exact = false;
                    }
                }
            }
            _ => unreachable!("known operations are handled above"),
        }
    }

    // Every value was a type the operation can never match.
    if preds.is_empty() {
        return literal("0", true);
    }

    CompiledFilter {
        expr: format!(
            "h.id IN (SELECT history_id FROM tag_index WHERE path = ? AND ({}))",
            preds.join(" OR ")
        ),
        params,
        exact,
    }
}

enum FileColumnKind {
    Text,
    Number,
}

fn file_column(path: &[String]) -> Option<(&'static str, FileColumnKind)> {
    if path.len() != 2 || path[0] != "$file" {
        return None;
    }
    match path[1].as_str() {
        "Name" => Some(("h.file_name", FileColumnKind::Text)),
        "Path" => Some(("h.file_path", FileColumnKind::Text)),
        "Type" => Some(("h.type", FileColumnKind::Text)),
        "DateTime" => Some(("h.date_time_ms", FileColumnKind::Number)),
        "Size" => Some(("h.file_size", FileColumnKind::Number)),
        _ => None,
    }
}

/// Conditions on a numeric `$file` column (`DateTime`, `Size`): treated as
/// always present, same as `DateTime` , `file_size` can in rare cases (a
/// failed `stat` when saving a recording) be NULL, which would make a
/// `notEquals` compiled here diverge from the reference evaluator (which
/// treats a missing key as satisfying `notEquals`) for that one row. Accepted
/// as a known, narrow edge case rather than special-cased.
fn compile_file_number_condition(column: &str, operation: u8, values: &[Value]) -> CompiledFilter {
    let mut preds: Vec<String> = Vec::new();
    let mut params: Vec<SqlValue> = Vec::new();

    for value in values {
        let Value::Number(n) = value else { continue };
        let Some(f) = n.as_f64() else { continue };
        let op = match operation {
            EQUALS => "=",
            NOT_EQUALS => "<>",
            GREATER_THAN => ">",
            GREATER_OR_EQUAL => ">=",
            LESS_THAN => "<",
            LESS_OR_EQUAL => "<=",
            _ => continue,
        };
        preds.push(format!("{column} {op} ?"));
        params.push(SqlValue::Real(f));
    }

    if preds.is_empty() {
        return literal("0", true);
    }

    CompiledFilter {
        expr: format!("({})", preds.join(" OR ")),
        params,
        exact: true,
    }
}

/// Conditions on a text `$file` column: exactly one string candidate, always present.
fn compile_file_text_condition(column: &str, operation: u8, values: &[Value]) -> CompiledFilter {
    let mut preds: Vec<String> = Vec::new();
    let mut params: Vec<SqlValue> = Vec::new();
    let mut exact = true;

    for value in values {
        match operation {
            // notEquals with a non-string filter is `string !== other` , true.
            NOT_EQUALS => match value {
                Value::String(s) => {
                    preds.push(format!("{column} <> ?"));
                    params.push(SqlValue::Text(s.clone()));
                }
                _ => preds.push("1".into()),
            },
            EQUALS => {
                if let Value::String(s) = value {
                    preds.push(format!("{column} = ?"));
                    params.push(SqlValue::Text(s.clone()));
                }
            }
            CONTAINS => {
                if let Value::String(s) = value {
                    if s.is_empty() {
                        preds.push("1".into());
                    } else {
                        preds.push(format!("instr({column}, ?) > 0"));
                        params.push(SqlValue::Text(s.clone()));
                    }
                }
            }
            NOT_CONTAINS => {
                if let Value::String(s) = value {
                    if !s.is_empty() {
                        preds.push(format!("instr({column}, ?) = 0"));
                        params.push(SqlValue::Text(s.clone()));
                    }
                }
            }
            STARTS_WITH => {
                if let Value::String(s) = value {
                    if s.is_empty() {
                        preds.push("1".into());
                    } else {
                        preds.push(format!("substr({column}, 1, ?) = ?"));
                        params.push(SqlValue::Integer(s.chars().count() as i64));
                        params.push(SqlValue::Text(s.clone()));
                    }
                }
            }
            ENDS_WITH => {
                if let Value::String(s) = value {
                    if s.is_empty() {
                        preds.push("1".into());
                    } else {
                        let chars = s.chars().count() as i64;
                        preds.push(format!("(length({column}) >= ? AND substr({column}, -?) = ?)"));
                        params.push(SqlValue::Integer(chars));
                        params.push(SqlValue::Integer(chars));
                        params.push(SqlValue::Text(s.clone()));
                    }
                }
            }
            FUZZY => {
                if let Value::String(s) = value {
                    preds.push("1".into());
                    if !s.is_empty() {
                        exact = false;
                    }
                }
            }
            // Range operations need a number candidate; a column is a string.
            _ => {}
        }
    }

    if preds.is_empty() {
        return literal("0", true);
    }

    CompiledFilter {
        expr: format!("({})", preds.join(" OR ")),
        params,
        exact,
    }
}

fn is_known_operation(operation: u8) -> bool {
    matches!(
        operation,
        EQUALS
            | GREATER_THAN
            | GREATER_OR_EQUAL
            | LESS_THAN
            | LESS_OR_EQUAL
            | CONTAINS
            | NOT_CONTAINS
            | STARTS_WITH
            | ENDS_WITH
            | FUZZY
    )
}

fn literal(expr: &str, exact: bool) -> CompiledFilter {
    CompiledFilter { expr: expr.into(), params: Vec::new(), exact }
}

pub struct IndexEntry {
    pub path: String,
    pub kind: &'static str,
    pub text: Option<String>,
    pub num: Option<f64>,
}

/// Flattens tags into `tag_index` rows, mirroring `resolve_path`: arrays are
/// transparent, objects extend the path, nulls vanish, and `Time`/`DateTime`
/// markers (see `marker_scalar`) collapse to a numeric leaf at the current
/// path. Unlike `collect_scalars` (which feeds suggestions) this keeps
/// booleans, since `equals` can match them.
pub fn collect_index_entries(tags: &Value) -> Vec<IndexEntry> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut path = Vec::new();
    walk(tags, &mut path, &mut out, &mut seen);
    out
}

type SeenKey = (String, &'static str, Option<String>, Option<u64>);

fn walk(
    value: &Value,
    path: &mut Vec<String>,
    out: &mut Vec<IndexEntry>,
    seen: &mut HashSet<SeenKey>,
) {
    match value {
        Value::Array(items) => {
            for item in items {
                walk(item, path, out, seen);
            }
        }
        Value::Object(map) => {
            if let Some((_, inner)) = marker_scalar(value) {
                if let Value::Number(n) = inner {
                    push_entry(path, "n", None, n.as_f64(), out, seen);
                }
            } else {
                for (key, inner) in map {
                    path.push(key.clone());
                    walk(inner, path, out, seen);
                    path.pop();
                }
            }
        }
        Value::Null => {}
        Value::String(s) => push_entry(path, "s", Some(s.clone()), None, out, seen),
        Value::Number(n) => push_entry(path, "n", None, n.as_f64(), out, seen),
        Value::Bool(b) => push_entry(path, "b", None, Some(if *b { 1.0 } else { 0.0 }), out, seen),
    }
}

fn push_entry(
    path: &[String],
    kind: &'static str,
    text: Option<String>,
    num: Option<f64>,
    out: &mut Vec<IndexEntry>,
    seen: &mut HashSet<SeenKey>,
) {
    let path_key = serde_json::to_string(path).expect("path is serializable");
    if seen.insert((path_key.clone(), kind, text.clone(), num.map(f64::to_bits))) {
        out.push(IndexEntry { path: path_key, kind, text, num });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn condition(path: &[&str], operation: u8, values: Vec<Value>) -> FilterNode {
        FilterNode::Condition {
            path: path.iter().map(|s| s.to_string()).collect(),
            operation,
            values,
        }
    }

    #[test]
    fn empty_group_is_exact_true() {
        let compiled = compile(&FilterNode::Group { relation: 0, children: vec![] });
        assert_eq!(compiled.expr, "1");
        assert!(compiled.exact);
    }

    #[test]
    fn equals_compiles_to_index_subquery() {
        let compiled = compile(&condition(&["ProcessName"], EQUALS, vec![json!("firefox")]));
        assert!(compiled.expr.contains("h.id IN (SELECT history_id FROM tag_index"));
        assert!(compiled.expr.contains("value_text = ?"));
        assert_eq!(compiled.params.len(), 2);
        assert!(compiled.exact);
    }

    #[test]
    fn not_equals_falls_back_to_residual() {
        let compiled = compile(&condition(&["a"], NOT_EQUALS, vec![json!("x")]));
        assert_eq!(compiled.expr, "1");
        assert!(!compiled.exact);
    }

    #[test]
    fn unmatchable_values_compile_to_false() {
        let compiled = compile(&condition(&["a"], EQUALS, vec![json!(null)]));
        assert_eq!(compiled.expr, "0");
        assert!(compiled.exact);

        let compiled = compile(&condition(&["a"], GREATER_THAN, vec![json!("nan")]));
        assert_eq!(compiled.expr, "0");
        assert!(compiled.exact);
    }

    #[test]
    fn fuzzy_is_inexact_unless_empty() {
        assert!(!compile(&condition(&["a"], FUZZY, vec![json!("ff")])).exact);
        assert!(compile(&condition(&["a"], FUZZY, vec![json!("")])).exact);
    }

    #[test]
    fn group_exactness_requires_all_children_exact() {
        let group = FilterNode::Group {
            relation: RELATION_OR,
            children: vec![
                condition(&["a"], EQUALS, vec![json!("x")]),
                condition(&["b"], NOT_EQUALS, vec![json!("y")]),
            ],
        };
        let compiled = compile(&group);
        assert!(compiled.expr.starts_with('('));
        assert!(compiled.expr.contains(" OR "));
        assert!(!compiled.exact);
    }

    #[test]
    fn index_entries_include_bools_and_flatten_arrays() {
        let entries = collect_index_entries(&json!({
            "Focused": true,
            "Missing": null,
            "Windows": [
                { "Window Name": "a", "Screenshot Percentage": 0.5 },
                { "Window Name": "a" },
            ],
        }));

        let find = |path: &str| entries.iter().filter(|e| e.path == path).collect::<Vec<_>>();
        assert_eq!(find("[\"Focused\"]")[0].kind, "b");
        assert_eq!(find("[\"Focused\"]")[0].num, Some(1.0));
        assert!(find("[\"Missing\"]").is_empty());
        // Duplicate window names dedupe to one row.
        assert_eq!(find("[\"Windows\",\"Window Name\"]").len(), 1);
        assert_eq!(find("[\"Windows\",\"Screenshot Percentage\"]")[0].kind, "n");
    }

    #[test]
    fn time_and_date_time_markers_index_as_a_single_numeric_entry() {
        let entries = collect_index_entries(&json!({
            "Duration": { "$time": 5000 },
            "CapturedAt": { "$dateTime": 1_737_000_000_000i64 },
        }));

        let find = |path: &str| entries.iter().filter(|e| e.path == path).collect::<Vec<_>>();
        assert_eq!(find("[\"Duration\"]").len(), 1);
        assert_eq!(find("[\"Duration\"]")[0].kind, "n");
        assert_eq!(find("[\"Duration\"]")[0].num, Some(5000.0));
        // No entry at the marker's inner key , it's a leaf, not a nested path.
        assert!(find("[\"Duration\",\"$time\"]").is_empty());
        assert_eq!(find("[\"CapturedAt\"]")[0].num, Some(1_737_000_000_000.0));
    }
}
