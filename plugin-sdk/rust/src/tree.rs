use std::collections::HashSet;

use serde_json::Value;

pub const MAX_NODES: usize = 300;
pub const MAX_DEPTH: usize = 6;
pub const MAX_STRING: usize = 2000;
pub const MAX_SELECT_ITEMS: usize = 200;
pub const MAX_ID: usize = 64;

const CONTAINERS: &[&str] = &["group", "inline"];
const INPUTS: &[&str] = &[
    "toggle", "select", "segmented", "number", "duration", "fileSize", "dimension", "text", "template",
];

fn is_static_type(node_type: &str) -> bool {
    CONTAINERS.contains(&node_type) || INPUTS.contains(&node_type)
}

/// Checks a tree before it reaches the frontend. `static_only` is for the manifest's
/// settings, which may only hold containers and input controls, every input with an id.
pub fn validate_tree(nodes: &[Value], static_only: bool) -> Result<(), String> {
    let mut count = 0;
    let mut ids = HashSet::new();
    for node in nodes {
        validate_node(node, 1, static_only, &mut count, &mut ids)?;
    }
    Ok(())
}

fn validate_node(
    node: &Value,
    depth: usize,
    static_only: bool,
    count: &mut usize,
    ids: &mut HashSet<String>,
) -> Result<(), String> {
    let Value::Object(map) = node else {
        return Err("Every node must be an object".into());
    };

    *count += 1;
    if *count > MAX_NODES {
        return Err(format!("More than {MAX_NODES} nodes"));
    }
    if depth > MAX_DEPTH {
        return Err(format!("Nested deeper than {MAX_DEPTH} levels"));
    }

    let Some(node_type) = map.get("type").and_then(Value::as_str) else {
        return Err("A node has no type".into());
    };

    if static_only && !is_static_type(node_type) {
        return Err(format!("\"{node_type}\" nodes are not allowed in manifest settings"));
    }

    match map.get("id") {
        Some(Value::String(id)) => {
            if id.is_empty() || id.len() > MAX_ID {
                return Err(format!("Node id \"{id}\" must be 1 to {MAX_ID} characters"));
            }
            if !ids.insert(id.clone()) {
                return Err(format!("Node id \"{id}\" is used twice"));
            }
        }
        Some(_) => return Err("A node id must be a string".into()),
        None if static_only && INPUTS.contains(&node_type) => {
            return Err(format!("A \"{node_type}\" setting has no id"));
        }
        None => {}
    }

    for (key, value) in map {
        match key.as_str() {
            "children" => {
                let Value::Array(children) = value else {
                    return Err("children must be a list".into());
                };
                for child in children {
                    validate_node(child, depth + 1, static_only, count, ids)?;
                }
            }
            "items" | "variables" => {
                let Value::Array(items) = value else {
                    return Err(format!("{key} must be a list"));
                };
                if items.len() > MAX_SELECT_ITEMS {
                    return Err(format!("More than {MAX_SELECT_ITEMS} {key}"));
                }
                check_strings(value)?;
            }
            _ => check_strings(value)?,
        }
    }

    if node_type == "link" {
        let url = map.get("url").and_then(Value::as_str).unwrap_or_default();
        if !url.starts_with("https://") {
            return Err("A link must be an https URL".into());
        }
    }

    Ok(())
}

fn check_strings(value: &Value) -> Result<(), String> {
    match value {
        Value::String(text) if text.chars().count() > MAX_STRING => {
            Err(format!("A text is longer than {MAX_STRING} characters"))
        }
        Value::Array(items) => items.iter().try_for_each(check_strings),
        Value::Object(map) => map.values().try_for_each(check_strings),
        _ => Ok(()),
    }
}

pub fn find_node<'a>(nodes: &'a [Value], id: &str) -> Option<&'a Value> {
    nodes.iter().find_map(|node| {
        if node.get("id").and_then(Value::as_str) == Some(id) {
            return Some(node);
        }
        node.get("children")
            .and_then(Value::as_array)
            .and_then(|children| find_node(children, id))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_normal_settings_tree_passes() {
        let tree = json!([{ "type": "group", "title": "Account", "children": [
            { "type": "text", "id": "token", "label": "API token", "secret": true },
            { "type": "toggle", "id": "private", "label": "Private uploads", "value": false },
        ]}]);
        assert!(validate_tree(tree.as_array().unwrap(), true).is_ok());
    }

    #[test]
    fn too_many_nodes_are_refused() {
        let nodes: Vec<Value> = (0..=MAX_NODES).map(|_| json!({ "type": "label", "text": "x" })).collect();
        assert!(validate_tree(&nodes, false).is_err());
    }

    #[test]
    fn nesting_past_the_limit_is_refused() {
        let mut node = json!({ "type": "label", "text": "x" });
        for _ in 0..MAX_DEPTH {
            node = json!({ "type": "group", "children": [node] });
        }
        assert!(validate_tree(&[node], false).is_err());
    }

    #[test]
    fn oversized_text_is_refused_wherever_it_hides() {
        let long = "x".repeat(MAX_STRING + 1);
        let in_label = json!({ "type": "label", "text": long });
        let in_items = json!({ "type": "select", "id": "a", "items": [{ "value": "v", "label": long }] });
        assert!(validate_tree(&[in_label], false).is_err());
        assert!(validate_tree(&[in_items], false).is_err());
    }

    #[test]
    fn duplicate_ids_are_refused() {
        let tree = json!([
            { "type": "toggle", "id": "a", "label": "One" },
            { "type": "group", "children": [{ "type": "toggle", "id": "a", "label": "Two" }] },
        ]);
        assert!(validate_tree(tree.as_array().unwrap(), false).is_err());
    }

    #[test]
    fn manifest_settings_only_take_inputs_with_ids() {
        let button = json!([{ "type": "button", "id": "go", "label": "Go" }]);
        let no_id = json!([{ "type": "toggle", "label": "No id" }]);
        assert!(validate_tree(button.as_array().unwrap(), true).is_err());
        assert!(validate_tree(no_id.as_array().unwrap(), true).is_err());
    }

    #[test]
    fn links_must_be_https() {
        let http = json!({ "type": "link", "label": "Site", "url": "http://example.com" });
        let script = json!({ "type": "link", "label": "Site", "url": "javascript:alert(1)" });
        let https = json!({ "type": "link", "label": "Site", "url": "https://example.com" });
        assert!(validate_tree(&[http], false).is_err());
        assert!(validate_tree(&[script], false).is_err());
        assert!(validate_tree(&[https], false).is_ok());
    }
}
