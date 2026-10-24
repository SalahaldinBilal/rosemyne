//! Windows renumbers `\\.\DISPLAYn` on replugs and updates, so saved monitor ids
//! come from the hardware instead: model, EDID serial and GPU connector.

#[cfg(target_os = "windows")]
mod windows;

use serde::Serialize;
use tauri::AppHandle;

use crate::screen_manager::window::WindowBounds;

const HARDWARE_ID_PREFIX: &str = "hw:";

#[derive(Debug, Clone, PartialEq)]
struct HardwareId {
    model: String,
    serial: Option<String>,
    port: String,
}

impl HardwareId {
    fn encode(&self) -> String {
        format!(
            "{HARDWARE_ID_PREFIX}{}:{}:{}",
            self.model,
            self.serial.as_deref().unwrap_or(""),
            self.port
        )
    }

    fn parse(id: &str) -> Option<Self> {
        let mut parts = id.strip_prefix(HARDWARE_ID_PREFIX)?.splitn(3, ':');
        let model = parts.next()?.to_string();
        let serial = parts.next()?;
        let port = parts.next()?.to_string();

        Some(Self {
            model,
            serial: (!serial.is_empty()).then(|| serial.to_string()),
            port,
        })
    }
}

struct HardwareIdentity {
    gdi_name: String,
    friendly_name: Option<String>,
    id: HardwareId,
    connector: String,
}

#[cfg(target_os = "windows")]
use self::windows::hardware_identities;

#[cfg(not(target_os = "windows"))]
fn hardware_identities() -> Vec<HardwareIdentity> {
    Vec::new()
}

struct MonitorKey {
    legacy_id: String,
    hardware: Option<HardwareId>,
}

struct ConnectedMonitor {
    monitor: tauri::Monitor,
    id: String,
    name: String,
    connector: Option<String>,
    key: MonitorKey,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    id: String,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    /// Saved ids (from older versions, or another port) that currently resolve to this monitor.
    matched_ids: Vec<String>,
}

pub fn bounds(monitor: &tauri::Monitor) -> WindowBounds {
    let position = monitor.position();
    let size = monitor.size();

    WindowBounds {
        left: position.x,
        top: position.y,
        right: position.x + size.width as i32,
        bottom: position.y + size.height as i32,
        z_order: 0,
    }
}

pub fn list(app_handle: &AppHandle, saved_ids: &[String]) -> Result<Vec<MonitorInfo>, String> {
    let monitors = connected(app_handle)?;
    let keys: Vec<&MonitorKey> = monitors.iter().map(|monitor| &monitor.key).collect();

    let mut infos: Vec<MonitorInfo> = monitors
        .iter()
        .map(|connected| MonitorInfo {
            id: connected.id.clone(),
            name: connected.name.clone(),
            x: connected.monitor.position().x,
            y: connected.monitor.position().y,
            width: connected.monitor.size().width,
            height: connected.monitor.size().height,
            matched_ids: Vec::new(),
        })
        .collect();

    for saved_id in saved_ids {
        let Some(index) = resolve(&keys, saved_id) else {
            continue;
        };
        let info = &mut infos[index];
        if info.id != *saved_id && !info.matched_ids.contains(saved_id) {
            info.matched_ids.push(saved_id.clone());
        }
    }

    Ok(infos)
}

pub fn find(app_handle: &AppHandle, id: &str) -> Option<tauri::Monitor> {
    let mut monitors = match connected(app_handle) {
        Ok(monitors) => monitors,
        Err(error) => {
            eprintln!("Failed to list monitors: {}", error);
            return None;
        }
    };

    let keys: Vec<&MonitorKey> = monitors.iter().map(|monitor| &monitor.key).collect();
    let index = resolve(&keys, id)?;
    Some(monitors.swap_remove(index).monitor)
}

fn connected(app_handle: &AppHandle) -> Result<Vec<ConnectedMonitor>, String> {
    let monitors = app_handle.available_monitors().map_err(|error| error.to_string())?;
    let identities = hardware_identities();

    let mut connected: Vec<ConnectedMonitor> = monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| {
            let os_name = monitor.name().cloned();
            let identity = os_name
                .as_ref()
                .and_then(|gdi_name| identities.iter().find(|identity| &identity.gdi_name == gdi_name));

            // A Windows GDI device path (\\.\DISPLAY1) isn't a friendly name, "Display N" reads better.
            let name = identity
                .and_then(|identity| identity.friendly_name.clone())
                .or_else(|| {
                    os_name
                        .clone()
                        .filter(|name| !name.trim().is_empty() && !name.starts_with(r"\\.\"))
                })
                .unwrap_or_else(|| format!("Display {}", index + 1));

            let key = MonitorKey {
                legacy_id: os_name.unwrap_or_else(|| format!("monitor-{index}")),
                hardware: identity.map(|identity| identity.id.clone()),
            };

            ConnectedMonitor {
                id: key
                    .hardware
                    .as_ref()
                    .map_or_else(|| key.legacy_id.clone(), HardwareId::encode),
                name,
                connector: identity.map(|identity| identity.connector.clone()),
                key,
                monitor,
            }
        })
        .collect();

    label_identical_names(&mut connected);
    Ok(connected)
}

fn label_identical_names(monitors: &mut [ConnectedMonitor]) {
    let names: Vec<String> = monitors.iter().map(|monitor| monitor.name.clone()).collect();

    for monitor in monitors.iter_mut() {
        let shared = names.iter().filter(|name| **name == monitor.name).count() > 1;
        if let (true, Some(connector)) = (shared, &monitor.connector) {
            monitor.name = format!("{} ({connector})", monitor.name);
        }
    }
}

/// Model + serial, then model on the saved connector, then the model if only one is connected.
fn resolve(keys: &[&MonitorKey], id: &str) -> Option<usize> {
    let Some(wanted) = HardwareId::parse(id) else {
        return keys.iter().position(|key| key.legacy_id == id);
    };

    let same_model: Vec<(usize, &HardwareId)> = keys
        .iter()
        .enumerate()
        .filter_map(|(index, key)| key.hardware.as_ref().map(|hardware| (index, hardware)))
        .filter(|(_, hardware)| hardware.model == wanted.model)
        .collect();

    if wanted.serial.is_some() {
        let same_serial: Vec<(usize, &HardwareId)> = same_model
            .iter()
            .copied()
            .filter(|(_, hardware)| hardware.serial == wanted.serial)
            .collect();

        if let Some(index) = only(&same_serial).or_else(|| on_port(&same_serial, &wanted.port)) {
            return Some(index);
        }
    }

    on_port(&same_model, &wanted.port).or_else(|| only(&same_model))
}

fn only(candidates: &[(usize, &HardwareId)]) -> Option<usize> {
    match candidates {
        [(index, _)] => Some(*index),
        _ => None,
    }
}

fn on_port(candidates: &[(usize, &HardwareId)], port: &str) -> Option<usize> {
    candidates
        .iter()
        .find(|(_, hardware)| hardware.port == port)
        .map(|(index, _)| *index)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hardware(model: &str, serial: Option<&str>, port: &str) -> HardwareId {
        HardwareId {
            model: model.to_string(),
            serial: serial.map(str::to_string),
            port: port.to_string(),
        }
    }

    fn key(legacy_id: &str, hardware: Option<HardwareId>) -> MonitorKey {
        MonitorKey {
            legacy_id: legacy_id.to_string(),
            hardware,
        }
    }

    fn resolve_in(keys: &[MonitorKey], id: &str) -> Option<usize> {
        let refs: Vec<&MonitorKey> = keys.iter().collect();
        resolve(&refs, id)
    }

    #[test]
    fn id_round_trips() {
        let with_serial = hardware("DEL41A3", Some("4C3B5A31"), "00ff");
        let without_serial = hardware("DEL41A3", None, "00ff");

        assert_eq!(HardwareId::parse(&with_serial.encode()), Some(with_serial));
        assert_eq!(HardwareId::parse(&without_serial.encode()), Some(without_serial));
        assert_eq!(HardwareId::parse(r"\\.\DISPLAY1"), None);
    }

    #[test]
    fn serial_follows_the_monitor_to_another_port() {
        let saved = hardware("DEL41A3", Some("AAA"), "port-1").encode();
        let keys = [
            key(r"\\.\DISPLAY1", Some(hardware("DEL41A3", Some("BBB"), "port-1"))),
            key(r"\\.\DISPLAY2", Some(hardware("DEL41A3", Some("AAA"), "port-2"))),
        ];

        assert_eq!(resolve_in(&keys, &saved), Some(1));
    }

    #[test]
    fn identical_monitors_without_serial_resolve_by_port() {
        let saved = hardware("ACR0001", None, "port-2").encode();
        let keys = [
            key(r"\\.\DISPLAY3", Some(hardware("ACR0001", None, "port-1"))),
            key(r"\\.\DISPLAY1", Some(hardware("ACR0001", None, "port-2"))),
        ];

        assert_eq!(resolve_in(&keys, &saved), Some(1));
    }

    #[test]
    fn duplicate_serials_fall_back_to_port() {
        let saved = hardware("ACR0001", Some("01010101"), "port-2").encode();
        let keys = [
            key(r"\\.\DISPLAY1", Some(hardware("ACR0001", Some("01010101"), "port-1"))),
            key(r"\\.\DISPLAY2", Some(hardware("ACR0001", Some("01010101"), "port-2"))),
        ];

        assert_eq!(resolve_in(&keys, &saved), Some(1));
    }

    #[test]
    fn single_monitor_of_a_model_matches_on_any_port() {
        let saved = hardware("ACR0001", None, "port-1").encode();
        let keys = [
            key(r"\\.\DISPLAY1", Some(hardware("SAM0002", None, "port-1"))),
            key(r"\\.\DISPLAY2", Some(hardware("ACR0001", None, "port-9"))),
        ];

        assert_eq!(resolve_in(&keys, &saved), Some(1));
    }

    #[test]
    fn ambiguous_monitors_resolve_to_nothing() {
        let saved = hardware("ACR0001", None, "port-1").encode();
        let keys = [
            key(r"\\.\DISPLAY1", Some(hardware("ACR0001", None, "port-2"))),
            key(r"\\.\DISPLAY2", Some(hardware("ACR0001", None, "port-3"))),
        ];

        assert_eq!(resolve_in(&keys, &saved), None);
    }

    #[test]
    fn legacy_ids_match_the_os_name() {
        let keys = [
            key(r"\\.\DISPLAY1", Some(hardware("ACR0001", None, "port-1"))),
            key("DP-1", None),
        ];

        assert_eq!(resolve_in(&keys, r"\\.\DISPLAY1"), Some(0));
        assert_eq!(resolve_in(&keys, "DP-1"), Some(1));
        assert_eq!(resolve_in(&keys, r"\\.\DISPLAY5"), None);
    }
}
