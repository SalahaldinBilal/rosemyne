use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE,
    REG_SZ, RRF_RT_REG_DWORD, RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegEnumKeyExW,
    RegGetValueW, RegOpenKeyExW, RegSetValueExW,
};
use windows_core::{HSTRING, PCWSTR, PWSTR};

/// Creates `subkey` under HKCU if needed and sets a string value (`None` = the default value).
pub fn set_string(subkey: &str, name: Option<&str>, value: &str) -> Result<(), String> {
    let mut key = HKEY::default();
    let created = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(subkey),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
    };
    if created.is_err() {
        return Err(format!("Failed to create registry key {subkey}: {created:?}"));
    }

    let data: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = unsafe { std::slice::from_raw_parts(data.as_ptr().cast::<u8>(), data.len() * 2) };
    let name = name.map(HSTRING::from);
    let written = unsafe {
        RegSetValueExW(
            key,
            name.as_ref().map_or(PCWSTR::null(), |name| PCWSTR(name.as_ptr())),
            None,
            REG_SZ,
            Some(bytes),
        )
    };
    let _ = unsafe { RegCloseKey(key) };

    if written.is_err() {
        return Err(format!("Failed to write registry key {subkey}: {written:?}"));
    }
    Ok(())
}

/// Deletes an HKCU key and everything under it; a missing key is fine.
pub fn delete_tree(subkey: &str) {
    let _ = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(subkey)) };
}

pub fn key_exists(subkey: &str) -> bool {
    let mut key = HKEY::default();
    let opened =
        unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(subkey), None, KEY_READ, &mut key) };
    if opened.is_err() {
        return false;
    }
    let _ = unsafe { RegCloseKey(key) };
    true
}

pub fn subkeys(subkey: &str) -> Vec<String> {
    let mut key = HKEY::default();
    let opened =
        unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(subkey), None, KEY_READ, &mut key) };
    if opened.is_err() {
        return Vec::new();
    }

    let mut names = Vec::new();
    for index in 0.. {
        let mut name = [0u16; 256];
        let mut length = name.len() as u32;
        let read = unsafe {
            RegEnumKeyExW(key, index, Some(PWSTR(name.as_mut_ptr())), &mut length, None, None, None, None)
        };
        if read.is_err() {
            break;
        }
        names.push(String::from_utf16_lossy(&name[..length as usize]));
    }

    let _ = unsafe { RegCloseKey(key) };
    names
}

pub fn machine_dword(subkey: &str, name: &str) -> Option<u32> {
    let mut data = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let read = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            &HSTRING::from(subkey),
            &HSTRING::from(name),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut data as *mut u32).cast()),
            Some(&mut size),
        )
    };
    read.is_ok().then_some(data)
}
