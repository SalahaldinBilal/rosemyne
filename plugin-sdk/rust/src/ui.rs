//! Builders for the view tree Rosemyne draws with its own components.

use serde::Serialize;
use serde_json::{json, Map, Value};

/// One node of a view. Unknown types are skipped by the app and unknown props ignored.
#[derive(Debug, Clone, Serialize)]
#[serde(transparent)]
pub struct Node(Map<String, Value>);

impl Node {
    pub fn new(node_type: &str) -> Self {
        let mut props = Map::new();
        props.insert("type".into(), json!(node_type));
        Self(props)
    }

    pub fn prop(mut self, name: &str, value: impl Serialize) -> Self {
        self.0.insert(name.into(), json!(value));
        self
    }

    pub fn id(self, id: &str) -> Self {
        self.prop("id", id)
    }

    pub fn hint(self, hint: &str) -> Self {
        self.prop("hint", hint)
    }

    pub fn value(self, value: impl Serialize) -> Self {
        self.prop("value", value)
    }

    pub fn children(self, children: Vec<Node>) -> Self {
        self.prop("children", children)
    }

    /// `normal`, `muted`, `warn` or `danger` on a label, `neutral`, `accent`, `ok`, `warn` or `danger` on a badge.
    pub fn tone(self, tone: &str) -> Self {
        self.prop("tone", tone)
    }

    /// `primary`, `secondary`, `ghost`, `danger`, `danger-solid` or `warn`, on a button.
    pub fn variant(self, variant: &str) -> Self {
        self.prop("variant", variant)
    }

    pub fn disabled(self, disabled: bool) -> Self {
        self.prop("disabled", disabled)
    }
}

fn input(node_type: &str, id: &str, label: &str) -> Node {
    Node::new(node_type).id(id).prop("label", label)
}

fn items(choices: &[(&str, &str)]) -> Vec<Value> {
    choices.iter().map(|(value, label)| json!({ "value": value, "label": label })).collect()
}

pub fn group(title: &str, children: Vec<Node>) -> Node {
    Node::new("group").prop("title", title).children(children)
}

/// A row with several controls side by side.
pub fn inline(label: &str, children: Vec<Node>) -> Node {
    Node::new("inline").prop("label", label).children(children)
}

pub fn toggle(id: &str, label: &str, value: bool) -> Node {
    input("toggle", id, label).value(value)
}

/// `choices` are `(value, label)` pairs.
pub fn select(id: &str, label: &str, choices: &[(&str, &str)], value: &str) -> Node {
    input("select", id, label).prop("items", items(choices)).value(value)
}

pub fn segmented(id: &str, label: &str, choices: &[(&str, &str)], value: &str) -> Node {
    input("segmented", id, label).prop("items", items(choices)).value(value)
}

/// Add `min`, `max`, `step` and `unit` with `prop`.
pub fn number(id: &str, label: &str, value: f64) -> Node {
    input("number", id, label).value(value)
}

pub fn duration(id: &str, label: &str, value_ms: u64) -> Node {
    input("duration", id, label).value(value_ms)
}

pub fn file_size(id: &str, label: &str, value_bytes: u64) -> Node {
    input("fileSize", id, label).value(value_bytes)
}

pub fn dimension(id: &str, label: &str, width: u32, height: u32) -> Node {
    input("dimension", id, label).value(json!({ "width": width, "height": height }))
}

/// Add `placeholder`, `maxLength` and `secret` with `prop`.
pub fn text(id: &str, label: &str, value: &str) -> Node {
    input("text", id, label).value(value)
}

/// `variables` are `(name, description)` pairs offered as `${name}`.
pub fn template(id: &str, label: &str, variables: &[(&str, &str)], value: &str) -> Node {
    let variables: Vec<Value> = variables
        .iter()
        .map(|(name, description)| json!({ "name": name, "description": description }))
        .collect();
    input("template", id, label).prop("variables", variables).value(value)
}

pub fn button(id: &str, label: &str) -> Node {
    Node::new("button").id(id).prop("label", label)
}

pub fn label(text: &str) -> Node {
    Node::new("label").prop("text", text)
}

pub fn badge(text: &str) -> Node {
    Node::new("badge").prop("text", text)
}

/// `fraction` is 0 to 1.
pub fn progress(fraction: f64) -> Node {
    Node::new("progress").value(fraction)
}

pub fn progress_indeterminate() -> Node {
    Node::new("progress").prop("indeterminate", true)
}

pub fn empty_state(title: &str, text: &str) -> Node {
    Node::new("emptyState").prop("title", title).prop("text", text)
}

/// `url` must be https. The app asks before opening it.
pub fn link(label: &str, url: &str) -> Node {
    Node::new("link").prop("label", label).prop("url", url)
}

/// Shows an image stored with `host::asset_put`.
pub fn image(asset: &str) -> Node {
    Node::new("image").prop("asset", asset)
}
