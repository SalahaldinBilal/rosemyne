use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows::Win32::Foundation::{GlobalFree, HANDLE, POINT};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock};
use windows::Win32::System::Ole::{CF_HDROP, CF_UNICODETEXT};
use windows::Win32::UI::Shell::DROPFILES;

/// Writes a CF_HDROP list , the same payload Explorer puts up on Ctrl+C.
pub fn copy_file(path: &Path) -> Result<(), String> {
    let mut list: Vec<u16> = path.as_os_str().encode_wide().collect();
    if list.contains(&0) {
        return Err("The file path contains a NUL character".into());
    }
    // Each path is NUL-terminated; a second NUL ends the list.
    list.extend([0, 0]);

    let header = DROPFILES {
        pFiles: std::mem::size_of::<DROPFILES>() as u32,
        pt: POINT { x: 0, y: 0 },
        fNC: false.into(),
        fWide: true.into(),
    };

    let mut payload = Vec::with_capacity(std::mem::size_of::<DROPFILES>() + list.len() * 2);
    payload.extend_from_slice(unsafe {
        std::slice::from_raw_parts(
            (&header as *const DROPFILES).cast::<u8>(),
            std::mem::size_of::<DROPFILES>(),
        )
    });
    payload.extend_from_slice(unsafe {
        std::slice::from_raw_parts(list.as_ptr().cast::<u8>(), list.len() * 2)
    });

    set_clipboard(CF_HDROP.0 as u32, &payload)
}

/// Writes plain text (CF_UNICODETEXT).
pub fn copy_text(text: &str) -> Result<(), String> {
    let wide: Vec<u16> = text
        .encode_utf16()
        .filter(|&unit| unit != 0)
        .chain([0])
        .collect();

    let bytes = unsafe { std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2) };
    set_clipboard(CF_UNICODETEXT.0 as u32, bytes)
}

/// Copies `payload` into a global allocation and hands it to the clipboard,
/// which owns the allocation from the moment SetClipboardData succeeds.
fn set_clipboard(format: u32, payload: &[u8]) -> Result<(), String> {
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, payload.len())
            .map_err(|err| format!("Failed to allocate clipboard memory: {err}"))?;

        let base = GlobalLock(memory);
        if base.is_null() {
            let _ = GlobalFree(Some(memory));
            return Err("Failed to lock the clipboard memory".into());
        }
        std::ptr::copy_nonoverlapping(payload.as_ptr(), base as *mut u8, payload.len());
        let _ = GlobalUnlock(memory);

        if let Err(err) = open_clipboard_with_retries() {
            let _ = GlobalFree(Some(memory));
            return Err(err);
        }

        let result = EmptyClipboard()
            .map_err(|err| format!("Failed to clear the clipboard: {err}"))
            .and_then(|_| {
                SetClipboardData(format, Some(HANDLE(memory.0)))
                    .map(|_| ())
                    .map_err(|err| format!("Failed to set the clipboard data: {err}"))
            });

        let _ = CloseClipboard();

        // On success the system owns the allocation; free it only on failure.
        if result.is_err() {
            let _ = GlobalFree(Some(memory));
        }

        result
    }
}

/// Whichever app holds the clipboard open blocks everyone else; retry briefly.
fn open_clipboard_with_retries() -> Result<(), String> {
    let mut last_error = String::new();

    for _ in 0..10 {
        match unsafe { OpenClipboard(None) } {
            Ok(()) => return Ok(()),
            Err(err) => last_error = err.to_string(),
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    Err(format!("Failed to open the clipboard: {last_error}"))
}
