//! Resolves user-facing monitor names. `Monitor::name()` gives the GDI device
//! name (`\\.\DISPLAY1` on Windows); this maps those to the friendly product
//! name (e.g. "DELL U2720Q") via the DisplayConfig API. Returns pairs of
//! `(gdi_device_name, friendly_name)`; empty on failure or non-Windows.

#[cfg(target_os = "windows")]
pub fn friendly_monitor_names() -> Vec<(String, String)> {
    use windows::Win32::Devices::Display::{
        DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
        DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SOURCE_DEVICE_NAME,
        DISPLAYCONFIG_TARGET_DEVICE_NAME, DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes,
        QDC_ONLY_ACTIVE_PATHS, QueryDisplayConfig,
    };
    use windows::Win32::Foundation::ERROR_SUCCESS;

    let mut result = Vec::new();

    unsafe {
        let mut num_paths: u32 = 0;
        let mut num_modes: u32 = 0;

        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut num_paths, &mut num_modes)
            != ERROR_SUCCESS
        {
            return result;
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
            return result;
        }

        for path in paths.iter().take(num_paths as usize) {
            let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
            source.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
            source.header.size = std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
            source.header.adapterId = path.sourceInfo.adapterId;
            source.header.id = path.sourceInfo.id;

            if DisplayConfigGetDeviceInfo(&mut source.header) != 0 {
                continue;
            }

            let gdi_name = wchars_to_string(&source.viewGdiDeviceName);
            if gdi_name.is_empty() {
                continue;
            }

            let mut target = DISPLAYCONFIG_TARGET_DEVICE_NAME::default();
            target.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
            target.header.size = std::mem::size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32;
            target.header.adapterId = path.targetInfo.adapterId;
            target.header.id = path.targetInfo.id;

            if DisplayConfigGetDeviceInfo(&mut target.header) != 0 {
                continue;
            }

            let friendly = wchars_to_string(&target.monitorFriendlyDeviceName);
            if !friendly.is_empty() {
                result.push((gdi_name, friendly));
            }
        }
    }

    result
}

#[cfg(target_os = "windows")]
fn wchars_to_string(chars: &[u16]) -> String {
    let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
    String::from_utf16_lossy(&chars[..end])
}

#[cfg(not(target_os = "windows"))]
pub fn friendly_monitor_names() -> Vec<(String, String)> {
    Vec::new()
}
