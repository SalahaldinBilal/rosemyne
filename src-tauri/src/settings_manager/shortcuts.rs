use std::{error::Error, fmt::Display};

use global_hotkey::{
    HotKeyState,
    hotkey::{HotKey, HotKeyParseError},
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{
    Error as PluginError, GlobalShortcutExt, Shortcut, ShortcutEvent,
};

use crate::{
    HistoryStoreHandler, ScreenshotManagerHandler, ScreenshotWindowHandler, SettingsHandler,
    screen_manager::commands::{open_record_overlay, take_screenshot},
};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ShortcutKey {
    pub key: String,
    pub char: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ShortcutKeys {
    keys: Vec<ShortcutKey>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ShortcutBinding {
    pub id: String,
    pub method: ShortcutMethod,
    pub keys: ShortcutKeys,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum ShortcutMethod {
    Screenshot,
    InstantCapture(CaptureTarget),
    /// Toggles screen recording: opens the region-select overlay when idle,
    /// stops and saves the active recording otherwise.
    Record,
}

/// Where an instant (no-overlay) capture grabs its pixels from.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum CaptureTarget {
    Monitor { id: String },
    Region {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    },
}

#[derive(Debug)]
pub enum ShortcutError {
    HotKeyParseError(HotKeyParseError),
    PluginError(PluginError),
}

impl Display for ShortcutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::HotKeyParseError(error) => {
                f.write_str(&format!("ShortcutError::IoError: {}", error))
            }
            Self::PluginError(error) => {
                f.write_str(&format!("ShortcutError::SerdeError: {}", error))
            }
        }
    }
}

impl Error for ShortcutError {}

impl Serialize for ShortcutError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            ShortcutError::HotKeyParseError(error) => serializer.serialize_newtype_variant(
                "ShortcutError",
                0,
                "hotKeyParseError",
                &error.to_string(),
            ),
            ShortcutError::PluginError(error) => serializer.serialize_newtype_variant(
                "ShortcutError",
                0,
                "pluginError",
                &error.to_string(),
            ),
        }
    }
}

impl From<HotKeyParseError> for ShortcutError {
    fn from(value: HotKeyParseError) -> Self {
        Self::HotKeyParseError(value)
    }
}

impl From<PluginError> for ShortcutError {
    fn from(value: PluginError) -> Self {
        Self::PluginError(value)
    }
}

impl Display for ShortcutKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let keys: Vec<_> = self.keys.iter().map(|k| k.key.as_str()).collect();
        write!(f, "{}", keys.join("+"))
    }
}

impl TryInto<HotKey> for ShortcutKeys {
    type Error = HotKeyParseError;

    fn try_into(self) -> Result<HotKey, Self::Error> {
        HotKey::try_from(self.to_string())
    }
}

impl ShortcutBinding {
    pub fn register(&self, app_handle: &AppHandle) -> Result<(), ShortcutError> {
        let hotkey: HotKey = self.keys.clone().try_into()?;

        Ok(app_handle.global_shortcut().register(hotkey)?)
    }

    pub fn unregister(&self, app_handle: &AppHandle) -> Result<(), ShortcutError> {
        let hotkey: HotKey = self.keys.clone().try_into()?;

        Ok(app_handle.global_shortcut().unregister(hotkey)?)
    }

    pub fn is_registered(&self, app_handle: &AppHandle) -> Result<bool, ShortcutError> {
        let hotkey: HotKey = self.keys.clone().try_into()?;

        Ok(app_handle.global_shortcut().is_registered(hotkey))
    }

    pub fn matches(&self, shortcut: &HotKey) -> Result<bool, ShortcutError> {
        let hotkey: HotKey = self.keys.clone().try_into()?;

        Ok(hotkey.matches(shortcut.mods, shortcut.key))
    }
}

pub fn shortcut_handler(app_handle: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != HotKeyState::Pressed {
        return;
    }

    let app_handle = app_handle.clone();
    let shortcut = *shortcut;

    tauri::async_runtime::spawn(async move {
        let settings = app_handle.state::<SettingsHandler>();
        let settings = settings.read().await;
        let matching_method = settings
            .get_shortcuts()
            .iter()
            .find(|existing| existing.matches(&shortcut).unwrap_or(false))
            .map(|existing| existing.method.clone());
        drop(settings);

        let method = match matching_method {
            Some(method) => method,
            None => {
                println!("Unknown shortcut {:#?}", shortcut);
                return;
            }
        };

        let capture_target = match method {
            ShortcutMethod::Screenshot => None,
            ShortcutMethod::InstantCapture(target) => Some(target),
            ShortcutMethod::Record => {
                if crate::recording::commands::is_recording(&app_handle).await {
                    if let Err(err) =
                        crate::recording::commands::finish_recording(&app_handle).await
                    {
                        eprintln!("Failed to stop the recording: {}", err);
                    }
                } else {
                    let window_handler = app_handle.state::<ScreenshotWindowHandler>();
                    let _ = open_record_overlay(window_handler.inner(), &app_handle).await;
                }
                return;
            }
        };

        let window_handler = app_handle.state::<ScreenshotWindowHandler>();
        let screenshot_manager = app_handle.state::<ScreenshotManagerHandler>();
        let history_store = app_handle.state::<HistoryStoreHandler>();
        let settings_handler = app_handle.state::<SettingsHandler>();
        let _ = take_screenshot(
            window_handler.inner(),
            screenshot_manager.inner(),
            history_store.inner(),
            settings_handler.inner(),
            &app_handle,
            capture_target,
        )
        .await;
    });
}
