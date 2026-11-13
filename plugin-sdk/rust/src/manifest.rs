use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::tree as ui;

pub use crate::API_VERSION;

pub const MANIFEST_FILE: &str = "plugin.json";
pub const WASM_FILE: &str = "plugin.wasm";
pub const ICON_FILE: &str = "icon.png";
pub const PACKAGE_EXTENSION: &str = "rosemyne-plugin";

pub const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
pub const MAX_WASM_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_ICON_BYTES: u64 = 256 * 1024;

pub fn check_wasm(bytes: &[u8]) -> Result<(), String> {
    if bytes.starts_with(b"\0asm") {
        Ok(())
    } else {
        Err(format!("{WASM_FILE} is not a WebAssembly module"))
    }
}

pub const HOOK_CAPTURE_SAVED: &str = "on_capture_saved";
pub const HOOK_EDIT_IMAGE: &str = "edit_image";
pub const HOOK_UPLOAD: &str = "upload";
pub const HOOK_UI_RENDER: &str = "ui_render";
pub const HOOK_UI_EVENT: &str = "ui_event";
pub const HOOK_CARD_ACTION: &str = "card_action";

const KNOWN_HOOKS: &[&str] = &[
    HOOK_CAPTURE_SAVED,
    HOOK_EDIT_IMAGE,
    HOOK_UPLOAD,
    HOOK_UI_RENDER,
    HOOK_UI_EVENT,
    HOOK_CARD_ACTION,
];

const RESERVED_TAG_KEYS: &[&str] = &["Windows", "Timestamp"];

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Permissions {
    pub captures_read: bool,
    pub captures_edit: bool,
    pub tags_read: bool,
    pub tags_write: bool,
    pub clipboard_write: bool,
    pub toast: bool,
    pub network: Vec<String>,
}

impl Permissions {
    fn granted(&self) -> Vec<&'static str> {
        [
            (self.captures_read, "capturesRead"),
            (self.captures_edit, "capturesEdit"),
            (self.tags_read, "tagsRead"),
            (self.tags_write, "tagsWrite"),
            (self.clipboard_write, "clipboardWrite"),
            (self.toast, "toast"),
        ]
        .into_iter()
        .filter_map(|(on, name)| on.then_some(name))
        .collect()
    }

    /// What `self` asks for that `old` did not have: permission names and network hosts.
    pub fn added_since(&self, old: &Permissions) -> (Vec<String>, Vec<String>) {
        let had = old.granted();
        let permissions = self
            .granted()
            .into_iter()
            .filter(|name| !had.contains(name))
            .map(str::to_owned)
            .collect();
        let hosts = self
            .network
            .iter()
            .filter(|host| !old.network.contains(host))
            .cloned()
            .collect();
        (permissions, hosts)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestUploader {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardAction {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub api_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub min_app_version: Option<String>,
    #[serde(default)]
    pub tag_key: Option<String>,
    #[serde(default)]
    pub permissions: Permissions,
    #[serde(default)]
    pub hooks: Vec<String>,
    #[serde(default)]
    pub uploaders: Vec<ManifestUploader>,
    #[serde(default)]
    pub card_actions: Vec<CardAction>,
    #[serde(default)]
    pub settings: Vec<Value>,
}

impl PluginManifest {
    pub fn parse(raw: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(raw).map_err(|err| format!("plugin.json is not valid: {err}"))
    }

    /// The name a packed plugin gets: `<id>-<version>.rosemyne-plugin`.
    pub fn package_file_name(&self) -> String {
        format!("{}-{}.{PACKAGE_EXTENSION}", self.id, self.version)
    }

    pub fn has_hook(&self, hook: &str) -> bool {
        self.hooks.iter().any(|name| name == hook)
    }

    /// Default of a static setting, as declared in the manifest.
    pub fn setting_default(&self, id: &str) -> Option<Value> {
        ui::find_node(&self.settings, id).and_then(|node| node.get("value").cloned())
    }

    pub fn has_setting(&self, id: &str) -> bool {
        ui::find_node(&self.settings, id).is_some()
    }

    /// Every rule, plus `minAppVersion` against the app that is about to load the plugin.
    pub fn validate(&self, app_version: &str) -> Result<(), String> {
        self.validate_shape()?;

        if let Some(min) = &self.min_app_version {
            let min = semver::Version::parse(min)
                .map_err(|_| format!("minAppVersion \"{min}\" is not a valid version"))?;
            let app = semver::Version::parse(app_version)
                .map_err(|_| format!("App version \"{app_version}\" is not a valid version"))?;
            if app < min {
                return Err(format!("Needs Rosemyne {min} or newer"));
            }
        }
        Ok(())
    }

    /// The rules that don't depend on which app loads the plugin.
    pub fn validate_shape(&self) -> Result<(), String> {
        if self.api_version != API_VERSION {
            return Err(format!(
                "This plugin is made for plugin API {}, this version of Rosemyne supports API {API_VERSION}",
                self.api_version
            ));
        }

        if !is_valid_id(&self.id) {
            return Err(format!(
                "Plugin id \"{}\" is not valid. Use 3 to 64 lowercase letters, digits, dots and dashes",
                self.id
            ));
        }

        let name = self.name.trim();
        if name.is_empty() || name.chars().count() > 64 {
            return Err("The plugin name must be 1 to 64 characters".into());
        }

        semver::Version::parse(&self.version)
            .map_err(|_| format!("Plugin version \"{}\" is not a valid version", self.version))?;

        if let Some(min) = &self.min_app_version {
            semver::Version::parse(min).map_err(|_| format!("minAppVersion \"{min}\" is not a valid version"))?;
        }

        match &self.tag_key {
            Some(key) => validate_tag_key(key)?,
            None if self.permissions.tags_write => {
                return Err("A plugin that writes tags must set tagKey".into());
            }
            None => {}
        }

        for host in &self.permissions.network {
            validate_network_entry(host)?;
        }

        for hook in &self.hooks {
            if !KNOWN_HOOKS.contains(&hook.as_str()) {
                return Err(format!("Unknown hook \"{hook}\""));
            }
        }

        if !self.uploaders.is_empty() && !self.has_hook(HOOK_UPLOAD) {
            return Err("A plugin with uploaders must list the upload hook".into());
        }
        if !self.card_actions.is_empty() && !self.has_hook(HOOK_CARD_ACTION) {
            return Err("A plugin with card actions must list the card_action hook".into());
        }
        if self.has_hook(HOOK_EDIT_IMAGE) && !self.permissions.captures_edit {
            return Err("The edit_image hook needs the capturesEdit permission".into());
        }

        for uploader in &self.uploaders {
            validate_item_id("Uploader", &uploader.id)?;
            validate_label("Uploader name", &uploader.name)?;
        }
        for action in &self.card_actions {
            validate_item_id("Card action", &action.id)?;
            validate_label("Card action label", &action.label)?;
            for item_type in &action.types {
                if !matches!(item_type.as_str(), "image" | "video" | "file") {
                    return Err(format!("Unknown card type \"{item_type}\""));
                }
            }
        }

        ui::validate_tree(&self.settings, true).map_err(|err| format!("settings: {err}"))
    }
}

fn is_valid_id(id: &str) -> bool {
    (3..=64).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-')
        && !id.starts_with(['.', '-'])
        && !id.ends_with(['.', '-'])
        && !id.contains("..")
}

fn validate_item_id(what: &str, id: &str) -> Result<(), String> {
    let valid = (1..=64).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if valid { Ok(()) } else { Err(format!("{what} id \"{id}\" is not valid")) }
}

fn validate_label(what: &str, label: &str) -> Result<(), String> {
    let length = label.trim().chars().count();
    if (1..=64).contains(&length) { Ok(()) } else { Err(format!("{what} must be 1 to 64 characters")) }
}

fn validate_tag_key(key: &str) -> Result<(), String> {
    let valid = !key.trim().is_empty()
        && key == key.trim()
        && key.chars().count() <= 32
        && key.chars().all(|c| c.is_alphanumeric() || c == ' ');
    if !valid {
        return Err(format!(
            "tagKey \"{key}\" is not valid. Use up to 32 letters, digits and spaces"
        ));
    }
    if RESERVED_TAG_KEYS.iter().any(|reserved| reserved.eq_ignore_ascii_case(key)) {
        return Err(format!("tagKey \"{key}\" is reserved"));
    }
    Ok(())
}

fn validate_network_entry(entry: &str) -> Result<(), String> {
    let host = entry.strip_prefix("*.").unwrap_or(entry);
    let labels_ok = !host.is_empty()
        && host.len() <= 253
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                && !label.starts_with('-')
                && !label.ends_with('-')
        });
    let is_ip = host.parse::<std::net::Ipv4Addr>().is_ok();

    if labels_ok && !is_ip {
        Ok(())
    } else {
        Err(format!(
            "Network entry \"{entry}\" is not valid. Use a lowercase hostname like api.example.com or *.example.com"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(json: Value) -> PluginManifest {
        let mut base = serde_json::json!({
            "apiVersion": 1,
            "id": "com.example.test",
            "name": "Test",
            "version": "1.0.0",
        });
        base.as_object_mut().unwrap().extend(json.as_object().unwrap().clone());
        serde_json::from_value(base).unwrap()
    }

    #[test]
    fn a_plain_manifest_is_accepted() {
        assert!(manifest(serde_json::json!({})).validate("0.3.3").is_ok());
    }

    #[test]
    fn ids_that_could_escape_the_plugins_folder_are_refused() {
        for id in ["../evil", "a/b", "a\\b", "..", "Com.Example", "ab", ".hidden", "a..b"] {
            let result = manifest(serde_json::json!({ "id": id })).validate("0.3.3");
            assert!(result.is_err(), "{id} should be refused");
        }
    }

    #[test]
    fn reserved_and_system_tag_keys_are_refused() {
        for key in ["$file", "Windows", "windows", "Timestamp", " Padded", ""] {
            let result = manifest(serde_json::json!({
                "tagKey": key,
                "permissions": { "tagsWrite": true },
            }))
            .validate("0.3.3");
            assert!(result.is_err(), "{key:?} should be refused");
        }
    }

    #[test]
    fn writing_tags_needs_a_tag_key() {
        let result = manifest(serde_json::json!({ "permissions": { "tagsWrite": true } })).validate("0.3.3");
        assert!(result.is_err());
    }

    #[test]
    fn network_entries_must_be_bare_hostnames() {
        for entry in [
            "https://api.example.com",
            "api.example.com/upload",
            "api.example.com:8443",
            "127.0.0.1",
            "localhost",
            "*",
            "*.com.",
            "API.example.com",
            "a.*.example.com",
        ] {
            let result = manifest(serde_json::json!({ "permissions": { "network": [entry] } })).validate("0.3.3");
            assert!(result.is_err(), "{entry} should be refused");
        }

        let ok = manifest(serde_json::json!({
            "permissions": { "network": ["api.example.com", "*.cdn.example.com"] },
        }))
        .validate("0.3.3");
        assert!(ok.is_ok());
    }

    #[test]
    fn uploaders_and_card_actions_need_their_hooks() {
        let uploader = manifest(serde_json::json!({ "uploaders": [{ "id": "main", "name": "Main" }] }));
        assert!(uploader.validate("0.3.3").is_err());

        let action = manifest(serde_json::json!({ "cardActions": [{ "id": "a", "label": "A" }] }));
        assert!(action.validate("0.3.3").is_err());
    }

    #[test]
    fn a_plugin_for_a_newer_app_is_refused() {
        let result = manifest(serde_json::json!({ "minAppVersion": "9.0.0" })).validate("0.3.3");
        assert_eq!(result.unwrap_err(), "Needs Rosemyne 9.0.0 or newer");
    }

    #[test]
    fn an_update_reports_only_what_is_new() {
        let old = Permissions { captures_read: true, network: vec!["a.example.com".into()], ..Default::default() };
        let new = Permissions {
            captures_read: true,
            tags_read: true,
            network: vec!["a.example.com".into(), "b.example.com".into()],
            ..Default::default()
        };
        let (permissions, hosts) = new.added_since(&old);
        assert_eq!(permissions, vec!["tagsRead"]);
        assert_eq!(hosts, vec!["b.example.com"]);
    }
}
