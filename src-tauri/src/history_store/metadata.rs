use std::collections::HashMap;

use serde::Serialize;
use serde_json::{Map, Value, json};

use super::filter::marker_scalar;

/// Mirrors `{ schema: TagValueTypeMap }` on the frontend; value suggestions
/// are served on demand by `suggest_tag_values` rather than shipped here.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagMetadata {
    pub schema: Value,
}

/// path-key (JSON-stringified path) -> serialized-value -> (original value, count).
pub type ValueCounts = HashMap<String, HashMap<String, (Value, u64)>>;

#[derive(Default)]
pub struct MetadataBuilder {
    schema: Map<String, Value>,
    counts: ValueCounts,
}

impl MetadataBuilder {
    pub fn add(&mut self, tags: &Value) {
        merge_schema(tags, &mut self.schema);
        for (path_key, scalar) in collect_scalars(tags) {
            let serialized = scalar.to_string();
            let entry = self
                .counts
                .entry(path_key)
                .or_default()
                .entry(serialized)
                .or_insert_with(|| (scalar, 0));
            entry.1 += 1;
        }
    }

    pub fn into_parts(self) -> (Map<String, Value>, ValueCounts) {
        (self.schema, self.counts)
    }
}

/// Port of `getTagMap`: accumulates the type shape of every tag path into `out`.
pub fn merge_schema(tags: &Value, out: &mut Map<String, Value>) {
    if let Value::Object(map) = tags {
        merge_tag_map(map, out);
    }
}

/// Port of the `tagValueIndex` walk: returns each scalar value (numbers/strings;
/// booleans and nulls skipped) paired with its JSON-stringified path. Arrays
/// don't extend the path.
pub fn collect_scalars(tags: &Value) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    let mut path = Vec::new();
    walk_scalars(tags, &mut path, &mut out);
    out
}

fn walk_scalars(value: &Value, path: &mut Vec<String>, out: &mut Vec<(String, Value)>) {
    match value {
        Value::Array(items) => {
            for item in items {
                walk_scalars(item, path, out);
            }
        }
        Value::Object(map) => {
            if let Some((_, inner)) = marker_scalar(value) {
                out.push((serde_json::to_string(path).expect("path is serializable"), inner.clone()));
                return;
            }
            for (key, inner) in map {
                path.push(key.clone());
                walk_scalars(inner, path, out);
                path.pop();
            }
        }
        Value::Null | Value::Bool(_) => {}
        scalar => out.push((serde_json::to_string(path).expect("path is serializable"), scalar.clone())),
    }
}

fn merge_tag_map(tags: &Map<String, Value>, out: &mut Map<String, Value>) {
    for (key, value) in tags {
        if let Some((kind, _)) = marker_scalar(value) {
            if !out.contains_key(key) {
                out.insert(key.clone(), json!({ "type": kind, "isArray": false }));
            }
            continue;
        }

        match value {
            Value::Null => continue,
            Value::Array(items) => {
                for item in items {
                    if let Some((kind, _)) = marker_scalar(item) {
                        if !out.contains_key(key) {
                            out.insert(key.clone(), json!({ "type": kind, "isArray": true }));
                        }
                    } else if let Value::Object(inner) = item {
                        let mut nested = take_nested(out, key);
                        merge_tag_map(inner, &mut nested);
                        out.insert(key.clone(), json!({ "type": nested, "isArray": true }));
                    } else if !out.contains_key(key) {
                        out.insert(key.clone(), json!({ "type": scalar_type(item), "isArray": true }));
                    }
                }
            }
            Value::Object(inner) => {
                let mut nested = take_nested(out, key);
                merge_tag_map(inner, &mut nested);
                out.insert(key.clone(), json!({ "type": nested, "isArray": false }));
            }
            scalar => {
                if !out.contains_key(key) {
                    out.insert(key.clone(), json!({ "type": scalar_type(scalar), "isArray": false }));
                }
            }
        }
    }
}

fn take_nested(out: &Map<String, Value>, key: &str) -> Map<String, Value> {
    match out.get(key) {
        Some(Value::Object(entry)) => match entry.get("type") {
            Some(Value::Object(nested)) => nested.clone(),
            _ => Map::new(),
        },
        _ => Map::new(),
    }
}

fn scalar_type(value: &Value) -> &'static str {
    match value {
        Value::Number(_) => "number",
        Value::Bool(_) => "boolean",
        _ => "string",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_captures_nested_and_arrays() {
        let mut builder = MetadataBuilder::default();
        builder.add(&json!({
            "ProcessName": "firefox",
            "Timestamp": 1500,
            "Windows": [{ "Window Name": "a", "Screenshot Percentage": 0.5 }]
        }));
        let (schema, _) = builder.into_parts();

        assert_eq!(schema["ProcessName"], json!({ "type": "string", "isArray": false }));
        assert_eq!(schema["Timestamp"], json!({ "type": "number", "isArray": false }));
        assert_eq!(schema["Windows"]["isArray"], json!(true));
        assert_eq!(schema["Windows"]["type"]["Window Name"], json!({ "type": "string", "isArray": false }));
    }

    #[test]
    fn value_counts_by_path() {
        let mut builder = MetadataBuilder::default();
        builder.add(&json!({ "ProcessName": "firefox" }));
        builder.add(&json!({ "ProcessName": "firefox" }));
        builder.add(&json!({ "ProcessName": "chrome" }));
        let (_, counts) = builder.into_parts();

        let by_process = &counts["[\"ProcessName\"]"];
        assert_eq!(by_process["\"firefox\""], (json!("firefox"), 2));
        assert_eq!(by_process["\"chrome\""], (json!("chrome"), 1));
    }

    #[test]
    fn array_paths_do_not_include_index() {
        let mut builder = MetadataBuilder::default();
        builder.add(&json!({ "Windows": [{ "Window Name": "a" }, { "Window Name": "b" }] }));
        let (_, counts) = builder.into_parts();

        assert_eq!(counts["[\"Windows\",\"Window Name\"]"].len(), 2);
    }

    #[test]
    fn collect_scalars_skips_booleans_and_nulls() {
        let scalars = collect_scalars(&json!({ "a": "x", "b": true, "c": null, "d": 3 }));
        let keys: Vec<&str> = scalars.iter().map(|(path, _)| path.as_str()).collect();
        assert!(keys.contains(&"[\"a\"]"));
        assert!(keys.contains(&"[\"d\"]"));
        assert!(!keys.iter().any(|k| k.contains("\"b\"") || k.contains("\"c\"")));
    }

    #[test]
    fn time_and_date_time_markers_get_their_own_schema_type() {
        let mut builder = MetadataBuilder::default();
        builder.add(&json!({ "Duration": { "$time": 5000 }, "CapturedAt": { "$dateTime": 1_737_000_000_000i64 } }));
        let (schema, counts) = builder.into_parts();

        assert_eq!(schema["Duration"], json!({ "type": "time", "isArray": false }));
        assert_eq!(schema["CapturedAt"], json!({ "type": "dateTime", "isArray": false }));
        // The marker unwraps to its inner millisecond number for value counting.
        assert_eq!(counts["[\"Duration\"]"]["5000"], (json!(5000), 1));
    }
}
