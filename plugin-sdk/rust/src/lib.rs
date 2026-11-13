//! SDK for Rosemyne plugins, plugin API 1.
//!
//! Inside a plugin (built for wasm): write one function per hook, list them in
//! [`export_hooks!`], and call into Rosemyne through [`host`].
//!
//! On the build machine: the `rosemyne-plugin-pack` command builds a plugin and writes its
//! `.rosemyne-plugin` file, using the package rules in [`manifest`] and [`tree`]. The
//! Rosemyne app checks packages with those same rules.

#[cfg(target_family = "wasm")]
pub mod host;
#[cfg(not(target_family = "wasm"))]
pub mod manifest;
#[cfg(all(feature = "pack", not(target_family = "wasm")))]
pub mod pack;
#[cfg(not(target_family = "wasm"))]
pub mod tree;
pub mod ui;

use serde::{Deserialize, Serialize};
pub use serde_json::{json, Value};

pub const API_VERSION: u32 = 1;

pub type HookResult<T> = Result<T, String>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub file_name: String,
    /// `image`, `video` or `file`.
    #[serde(rename = "type")]
    pub kind: String,
    pub date_time_ms: i64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_size: Option<u64>,
    pub url: Option<String>,
    /// Only present with the `tagsRead` permission.
    pub tags: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CaptureSaved {
    pub capture: Capture,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EditImage {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    pub uploader_id: String,
    pub capture: Capture,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletion_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UiRender {
    /// `settings`, or `modal:<actionId>`.
    pub view: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UiEvent {
    pub view: String,
    pub id: String,
    /// `change` or `click`.
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub value: Value,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ToastKind {
    #[default]
    Info,
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct Toast {
    pub kind: ToastKind,
    pub text: String,
}

impl Toast {
    pub fn new(kind: ToastKind, text: impl Into<String>) -> Self {
        Self { kind, text: text.into() }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tree: Option<Vec<ui::Node>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toast: Option<Toast>,
    /// Closes the modal the event came from.
    pub close: bool,
    /// Asks for `ui_render` again after this long while the view stays open. 500 ms at least.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_after_ms: Option<u64>,
}

impl UiResponse {
    pub fn tree(tree: Vec<ui::Node>) -> Self {
        Self { tree: Some(tree), ..Self::default() }
    }

    pub fn close() -> Self {
        Self { close: true, ..Self::default() }
    }

    pub fn with_toast(mut self, kind: ToastKind, text: impl Into<String>) -> Self {
        self.toast = Some(Toast::new(kind, text));
        self
    }

    pub fn refresh_after(mut self, ms: u64) -> Self {
        self.refresh_after_ms = Some(ms);
        self
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardActionRequest {
    pub action_id: String,
    pub capture: Capture,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModalAction {
    pub id: String,
    pub label: String,
    /// `primary`, `secondary` or `danger-solid`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
}

impl ModalAction {
    pub fn new(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self { id: id.into(), label: label.into(), variant: None }
    }

    pub fn variant(mut self, variant: impl Into<String>) -> Self {
        self.variant = Some(variant.into());
        self
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Modal {
    pub title: String,
    pub tree: Vec<ui::Node>,
    pub actions: Vec<ModalAction>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CardActionResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modal: Option<Modal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toast: Option<Toast>,
}

impl CardActionResponse {
    pub fn modal(title: impl Into<String>, tree: Vec<ui::Node>, actions: Vec<ModalAction>) -> Self {
        Self { modal: Some(Modal { title: title.into(), tree, actions }), toast: None }
    }

    pub fn toast(kind: ToastKind, text: impl Into<String>) -> Self {
        Self { modal: None, toast: Some(Toast::new(kind, text)) }
    }
}

/// Exports hooks to Rosemyne. Each name must also be listed under `hooks` in `plugin.json`.
///
/// ```ignore
/// export_hooks! {
///     on_capture_saved => saved,
///     upload => upload,
/// }
/// ```
#[macro_export]
macro_rules! export_hooks {
    ($($hook:ident => $handler:path),* $(,)?) => {
        $(
            #[no_mangle]
            pub extern "C" fn $hook() -> i32 {
                $crate::__private::$hook($handler)
            }
        )*
    };
}

#[cfg(target_family = "wasm")]
#[doc(hidden)]
pub mod __private {
    use extism_pdk::Memory;
    use serde::{de::DeserializeOwned, Serialize};

    use super::*;

    fn fail(message: &str) -> i32 {
        if let Ok(memory) = Memory::from_bytes(message) {
            unsafe { extism_pdk::extism::error_set(memory.offset()) };
        }
        1
    }

    fn run<I: DeserializeOwned, O: Serialize>(handler: fn(I) -> HookResult<O>) -> i32 {
        let result = extism_pdk::input::<Vec<u8>>()
            .map_err(|err| err.to_string())
            .and_then(|input| serde_json::from_slice::<I>(&input).map_err(|err| format!("Unexpected hook input: {err}")))
            .and_then(handler)
            .and_then(|output| serde_json::to_vec(&output).map_err(|err| err.to_string()))
            .and_then(|output| Memory::from_bytes(output).map_err(|err| err.to_string()));

        match result {
            Ok(memory) => {
                memory.set_output();
                0
            }
            Err(message) => fail(&message),
        }
    }

    pub fn on_capture_saved(handler: fn(CaptureSaved) -> HookResult<()>) -> i32 {
        run(handler)
    }

    pub fn edit_image(handler: fn(EditImage) -> HookResult<()>) -> i32 {
        run(handler)
    }

    pub fn upload(handler: fn(UploadRequest) -> HookResult<UploadResult>) -> i32 {
        run(handler)
    }

    pub fn ui_render(handler: fn(UiRender) -> HookResult<UiResponse>) -> i32 {
        run(handler)
    }

    pub fn ui_event(handler: fn(UiEvent) -> HookResult<UiResponse>) -> i32 {
        run(handler)
    }

    pub fn card_action(handler: fn(CardActionRequest) -> HookResult<CardActionResponse>) -> i32 {
        run(handler)
    }
}
