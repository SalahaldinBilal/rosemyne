use windows::Win32::Devices::Display::{
    DISPLAYCONFIG_ADAPTER_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_ADAPTER_NAME,
    DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
    DISPLAYCONFIG_DEVICE_INFO_HEADER, DISPLAYCONFIG_DEVICE_INFO_TYPE, DISPLAYCONFIG_MODE_INFO,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EXTERNAL,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_USB_TUNNEL, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DVI,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HD15, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_WIRED,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_LVDS,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED,
    DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SOURCE_DEVICE_NAME, DISPLAYCONFIG_TARGET_DEVICE_NAME,
    DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY, DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes,
    QDC_ONLY_ACTIVE_PATHS, QueryDisplayConfig,
};
use windows::Win32::Foundation::{ERROR_SUCCESS, LUID};
use windows::Win32::System::Registry::{HKEY_LOCAL_MACHINE, RRF_RT_REG_BINARY, RegGetValueW};
use windows_core::HSTRING;

use super::{HardwareId, HardwareIdentity};

pub(super) fn hardware_identities() -> Vec<HardwareIdentity> {
    active_paths()
        .iter()
        .filter_map(identity_for_path)
        .collect()
}

fn active_paths() -> Vec<DISPLAYCONFIG_PATH_INFO> {
    let mut num_paths: u32 = 0;
    let mut num_modes: u32 = 0;

    unsafe {
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut num_paths, &mut num_modes)
            != ERROR_SUCCESS
        {
            return Vec::new();
        }

        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); num_paths as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); num_modes as usize];

        if QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut num_paths,
            paths.as_mut_ptr(),
            &mut num_modes,
            modes.as_mut_ptr(),
            None,
        ) != ERROR_SUCCESS
        {
            return Vec::new();
        }

        paths.truncate(num_paths as usize);
        paths
    }
}

fn identity_for_path(path: &DISPLAYCONFIG_PATH_INFO) -> Option<HardwareIdentity> {
    let source: DISPLAYCONFIG_SOURCE_DEVICE_NAME = device_info(
        DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
        path.sourceInfo.adapterId,
        path.sourceInfo.id,
    )?;
    let target: DISPLAYCONFIG_TARGET_DEVICE_NAME = device_info(
        DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
        path.targetInfo.adapterId,
        path.targetInfo.id,
    )?;
    let adapter: DISPLAYCONFIG_ADAPTER_NAME = device_info(
        DISPLAYCONFIG_DEVICE_INFO_GET_ADAPTER_NAME,
        path.targetInfo.adapterId,
        0,
    )?;

    let gdi_name = wchars_to_string(&source.viewGdiDeviceName);
    let device_path = wchars_to_string(&target.monitorDevicePath);
    let adapter_path = wchars_to_string(&adapter.adapterDevicePath);
    let model = device_path.split('#').nth(1).unwrap_or_default().to_string();

    if gdi_name.is_empty() || model.is_empty() || adapter_path.is_empty() {
        return None;
    }

    let friendly_name = wchars_to_string(&target.monitorFriendlyDeviceName);

    Some(HardwareIdentity {
        gdi_name,
        friendly_name: (!friendly_name.is_empty()).then_some(friendly_name),
        id: HardwareId {
            model,
            serial: edid_serial(&device_path),
            port: port_key(&adapter_path, path.targetInfo.id),
        },
        connector: connector_label(target.outputTechnology, target.connectorInstance),
    })
}

/// `T` must be a DisplayConfig packet that starts with a `DISPLAYCONFIG_DEVICE_INFO_HEADER`.
fn device_info<T: Default>(kind: DISPLAYCONFIG_DEVICE_INFO_TYPE, adapter_id: LUID, id: u32) -> Option<T> {
    let mut info = T::default();
    let header = (&mut info as *mut T).cast::<DISPLAYCONFIG_DEVICE_INFO_HEADER>();

    unsafe {
        (*header).r#type = kind;
        (*header).size = std::mem::size_of::<T>() as u32;
        (*header).adapterId = adapter_id;
        (*header).id = id;

        (DisplayConfigGetDeviceInfo(header) == 0).then_some(info)
    }
}

/// The GPU's PCI device path plus the driver's target id identify one physical connector.
fn port_key(adapter_path: &str, target_id: u32) -> String {
    // FNV-1a by hand, std's hasher output isn't guaranteed stable across Rust versions.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in format!("{}/{target_id}", adapter_path.to_ascii_lowercase()).bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn connector_label(technology: DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY, instance: u32) -> String {
    let kind = match technology {
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HD15 => "VGA",
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DVI => "DVI",
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI => "HDMI",
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EXTERNAL => "DisplayPort",
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_USB_TUNNEL => "USB-C",
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST => "Wireless",
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_WIRED => "USB",
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL => "Virtual",
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_LVDS
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL => "Built-in",
        _ => "Output",
    };

    if instance > 0 {
        format!("{kind} {instance}")
    } else {
        kind.to_string()
    }
}

/// Reads the EDID Windows caches under the monitor's device key, from its device interface path.
fn edid_serial(device_path: &str) -> Option<String> {
    let mut parts = device_path.split('#');
    let enumerator = parts.next()?.trim_start_matches(r"\\?\");
    let model = parts.next()?;
    let instance = parts.next()?;

    let subkey = format!(
        r"SYSTEM\CurrentControlSet\Enum\{enumerator}\{model}\{instance}\Device Parameters"
    );
    serial_from_edid(&machine_binary(&subkey, "EDID")?)
}

fn serial_from_edid(edid: &[u8]) -> Option<String> {
    const HEADER: [u8; 8] = [0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00];
    const SERIAL_DESCRIPTOR: [u8; 4] = [0x00, 0x00, 0x00, 0xFF];

    if edid.len() < 128 || edid[..8] != HEADER {
        return None;
    }

    let text_serial = edid[54..126]
        .chunks_exact(18)
        .find(|descriptor| descriptor[..4] == SERIAL_DESCRIPTOR)
        .map(|descriptor| {
            descriptor[5..]
                .iter()
                .take_while(|&&byte| byte != 0x0A)
                .filter(|byte| byte.is_ascii_alphanumeric())
                .map(|&byte| byte as char)
                .collect::<String>()
        })
        .filter(|serial| !serial.is_empty());

    text_serial.or_else(|| {
        let number = u32::from_le_bytes([edid[12], edid[13], edid[14], edid[15]]);
        (number != 0).then(|| format!("{number:08X}"))
    })
}

fn machine_binary(subkey: &str, name: &str) -> Option<Vec<u8>> {
    let subkey = HSTRING::from(subkey);
    let name = HSTRING::from(name);
    let mut size = 0u32;

    let measured = unsafe {
        RegGetValueW(HKEY_LOCAL_MACHINE, &subkey, &name, RRF_RT_REG_BINARY, None, None, Some(&mut size))
    };
    if measured.is_err() || size == 0 {
        return None;
    }

    let mut data = vec![0u8; size as usize];
    let read = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            &subkey,
            &name,
            RRF_RT_REG_BINARY,
            None,
            Some(data.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if read.is_err() {
        return None;
    }

    data.truncate(size as usize);
    Some(data)
}

fn wchars_to_string(chars: &[u16]) -> String {
    let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
    String::from_utf16_lossy(&chars[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edid_with(numeric_serial: u32, text_serial: Option<&str>) -> Vec<u8> {
        let mut edid = vec![0u8; 128];
        edid[..8].copy_from_slice(&[0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00]);
        edid[12..16].copy_from_slice(&numeric_serial.to_le_bytes());

        if let Some(text) = text_serial {
            let descriptor = &mut edid[72..90];
            descriptor[..4].copy_from_slice(&[0x00, 0x00, 0x00, 0xFF]);
            descriptor[5..].fill(0x20);
            descriptor[5..5 + text.len()].copy_from_slice(text.as_bytes());
            descriptor[5 + text.len()] = 0x0A;
        }

        edid
    }

    #[test]
    fn prefers_the_text_serial() {
        assert_eq!(serial_from_edid(&edid_with(0x1234, Some("CN0ABC12"))), Some("CN0ABC12".into()));
    }

    #[test]
    fn falls_back_to_the_numeric_serial() {
        assert_eq!(serial_from_edid(&edid_with(0x4C3B5A31, None)), Some("4C3B5A31".into()));
    }

    #[test]
    fn zero_serial_is_no_serial() {
        assert_eq!(serial_from_edid(&edid_with(0, None)), None);
    }

    #[test]
    fn rejects_bad_edid() {
        assert_eq!(serial_from_edid(&[0u8; 128]), None);
        assert_eq!(serial_from_edid(&[0u8; 10]), None);
    }

    #[test]
    fn port_key_is_stable() {
        let path = r"\\?\PCI#VEN_10DE&DEV_2684#4&1&0&0019#{5b45201d-f2f2-4f3b-85bb-30ff1f953599}";
        assert_eq!(port_key(path, 4352), port_key(&path.to_lowercase(), 4352));
        assert_ne!(port_key(path, 4352), port_key(path, 4353));
    }
}
