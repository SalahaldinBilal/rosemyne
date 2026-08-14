use std::ffi::c_void;

use image::RgbaImage;
use windows::Win32::{
    Foundation::HWND,
    Graphics::Gdi::{
        BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC,
        DeleteObject, GetDC, GetDIBits, GetObjectW, HBITMAP, HDC, ReleaseDC,
    },
    System::Registry::{
        HKEY, HKEY_CURRENT_USER, KEY_READ, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ, RegCloseKey,
        RegEnumValueW, RegGetValueW, RegOpenKeyExW,
    },
    UI::WindowsAndMessaging::{
        CURSOR_SHOWING, CURSORINFO, DestroyCursor, GetCursorInfo, GetIconInfo, HCURSOR, HICON,
        ICONINFO, IDC_APPSTARTING, IDC_ARROW, IDC_CROSS, IDC_HAND, IDC_HELP, IDC_IBEAM, IDC_NO,
        IDC_PERSON, IDC_PIN, IDC_SIZEALL, IDC_SIZENESW, IDC_SIZENS, IDC_SIZENWSE, IDC_SIZEWE,
        IDC_UPARROW, IDC_WAIT, IMAGE_CURSOR, LR_DEFAULTSIZE, LR_LOADFROMFILE, LoadCursorW,
        LoadImageW,
    },
};
use windows_core::{PCWSTR, PWSTR, w};

use super::{CursorSnapshot, RenderedCursor};

pub fn snapshot_cursor() -> Option<CursorSnapshot> {
    unsafe {
        let mut info = CURSORINFO {
            cbSize: std::mem::size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };

        if GetCursorInfo(&mut info).is_err()
            || info.flags.0 & CURSOR_SHOWING.0 == 0
            || info.hCursor.is_invalid()
        {
            return None;
        }

        let mut snapshot = snapshot_from_handle(info.hCursor.0 as usize)?;
        snapshot.screen_x = info.ptScreenPos.x;
        snapshot.screen_y = info.ptScreenPos.y;

        Some(snapshot)
    }
}

/// The scheme the user actually configured, so custom entries and slots with no
/// `IDC_*` constant of their own are covered without a hardcoded list.
pub fn render_scheme_cursors() -> Vec<(String, String, RenderedCursor)> {
    scheme_entries()
        .into_iter()
        .filter_map(|(id, path)| {
            let (cursor, owned) = load_scheme_cursor(&id, &path)?;
            let rendered = snapshot_from_handle(cursor.0 as usize).and_then(render_cursor);

            if owned && let Err(err) = unsafe { DestroyCursor(cursor) } {
                eprintln!("DestroyCursor failed for the {id} cursor: {err}");
            }

            Some((slot_label(&id), id, rendered?))
        })
        .map(|(name, id, rendered)| (id, name, rendered))
        .collect()
}

/// An empty value means the slot is left at the Windows default rather than a file.
fn load_scheme_cursor(id: &str, path: &str) -> Option<(HCURSOR, bool)> {
    if !path.is_empty() {
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let loaded = unsafe {
            LoadImageW(
                None,
                PCWSTR(wide.as_ptr()),
                IMAGE_CURSOR,
                0,
                0,
                LR_LOADFROMFILE | LR_DEFAULTSIZE,
            )
        };

        match loaded {
            Ok(handle) => return Some((HCURSOR(handle.0), true)),
            Err(err) => eprintln!("LoadImageW failed for the {id} cursor at {path}: {err}"),
        }
    }

    let fallback = default_slot(id)?;
    unsafe { LoadCursorW(None, fallback) }.ok().map(|cursor| (cursor, false))
}

fn default_slot(id: &str) -> Option<PCWSTR> {
    Some(match id {
        "arrow" => IDC_ARROW,
        "ibeam" => IDC_IBEAM,
        "hand" => IDC_HAND,
        "wait" => IDC_WAIT,
        "appstarting" => IDC_APPSTARTING,
        "crosshair" => IDC_CROSS,
        "help" => IDC_HELP,
        "no" => IDC_NO,
        "sizeall" => IDC_SIZEALL,
        "sizens" => IDC_SIZENS,
        "sizewe" => IDC_SIZEWE,
        "sizenwse" => IDC_SIZENWSE,
        "sizenesw" => IDC_SIZENESW,
        "uparrow" => IDC_UPARROW,
        "person" => IDC_PERSON,
        "pin" => IDC_PIN,
        "nwpen" => IDC_NWPEN,
        _ => return None,
    })
}

/// Not in the windows crate, but the OEM id the Pen slot has always used.
const IDC_NWPEN: PCWSTR = PCWSTR(32631u16 as _);

/// Arrow first: it's the default pick and the one most people mean by "the cursor".
const SLOT_ORDER: [&str; 17] = [
    "arrow", "ibeam", "hand", "wait", "appstarting", "crosshair", "help", "no", "sizeall",
    "sizens", "sizewe", "sizenwse", "sizenesw", "uparrow", "nwpen", "person", "pin",
];

fn slot_rank(id: &str) -> usize {
    SLOT_ORDER.iter().position(|slot| *slot == id).unwrap_or(SLOT_ORDER.len())
}

fn slot_label(id: &str) -> String {
    match id {
        "arrow" => "Arrow",
        "ibeam" => "I-beam",
        "hand" => "Hand",
        "wait" => "Busy",
        "appstarting" => "Working",
        "crosshair" => "Crosshair",
        "help" => "Help",
        "no" => "Unavailable",
        "sizeall" => "Move",
        "sizens" => "Resize vertical",
        "sizewe" => "Resize horizontal",
        "sizenwse" => "Resize diagonal",
        "sizenesw" => "Resize counter-diagonal",
        "uparrow" => "Up arrow",
        "person" => "Person",
        "pin" => "Location",
        "nwpen" => "Pen",
        other => other,
    }
    .to_string()
}

/// Value name (lowercased as the id) plus its expanded file path, empty when unset.
fn scheme_entries() -> Vec<(String, String)> {
    let mut key = HKEY::default();

    let opened = unsafe {
        RegOpenKeyExW(HKEY_CURRENT_USER, w!("Control Panel\\Cursors"), None, KEY_READ, &mut key)
    };

    if opened.is_err() {
        eprintln!("RegOpenKeyExW failed for the cursor scheme: {opened:?}");
        return Vec::new();
    }

    let mut entries = Vec::new();

    for index in 0.. {
        let mut name = [0u16; 256];
        let mut length = name.len() as u32;

        let read = unsafe {
            RegEnumValueW(key, index, Some(PWSTR(name.as_mut_ptr())), &mut length, None, None, None, None)
        };

        if read.is_err() {
            break;
        }

        let value = String::from_utf16_lossy(&name[..length as usize]);
        // The unnamed default holds the scheme's display name, not a cursor.
        if value.is_empty() || value.eq_ignore_ascii_case("Scheme Source") {
            continue;
        }

        let path = scheme_value(key, &name[..length as usize + 1]);
        entries.push((value.to_ascii_lowercase(), path));
    }

    let _ = unsafe { RegCloseKey(key) };

    // Registry order is alphabetical, which buries Arrow; anything unrecognized keeps its place at the end.
    entries.sort_by_key(|(id, _)| slot_rank(id));
    entries
}

fn scheme_value(key: HKEY, name: &[u16]) -> String {
    let mut size = 0u32;
    let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;

    let measured = unsafe {
        RegGetValueW(key, None, PCWSTR(name.as_ptr()), flags, None, None, Some(&mut size))
    };

    if measured.is_err() || size == 0 {
        return String::new();
    }

    let mut buffer = vec![0u16; size as usize / 2 + 1];
    let read = unsafe {
        RegGetValueW(
            key,
            None,
            PCWSTR(name.as_ptr()),
            flags,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };

    if read.is_err() {
        return String::new();
    }

    let end = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}

fn snapshot_from_handle(handle: usize) -> Option<CursorSnapshot> {
    let mut icon_info = ICONINFO::default();

    if let Err(err) = unsafe { GetIconInfo(HICON(handle as *mut c_void), &mut icon_info) } {
        eprintln!("GetIconInfo failed for a cursor: {err}");
        return None;
    }

    let size = cursor_size(&icon_info);
    release_icon_bitmaps(&icon_info);
    let (width, height) = size?;

    Some(CursorSnapshot {
        handle,
        width,
        height,
        hotspot_x: icon_info.xHotspot as i32,
        hotspot_y: icon_info.yHotspot as i32,
        screen_x: 0,
        screen_y: 0,
    })
}

/// A monochrome cursor's mask stacks its AND and XOR halves, so the real height is half of it.
fn cursor_size(icon_info: &ICONINFO) -> Option<(i32, i32)> {
    let (bitmap, monochrome) = if icon_info.hbmColor.is_invalid() {
        (icon_info.hbmMask, true)
    } else {
        (icon_info.hbmColor, false)
    };

    let mut described = BITMAP::default();
    let written = unsafe {
        GetObjectW(
            bitmap.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut described as *mut _ as *mut c_void),
        )
    };

    if written == 0 || described.bmWidth <= 0 || described.bmHeight <= 0 {
        return None;
    }

    let height = if monochrome {
        described.bmHeight / 2
    } else {
        described.bmHeight
    };

    (height > 0).then_some((described.bmWidth, height))
}

pub fn render_cursor(snapshot: CursorSnapshot) -> Option<RenderedCursor> {
    let mut icon_info = ICONINFO::default();

    if let Err(err) = unsafe { GetIconInfo(HICON(snapshot.handle as *mut c_void), &mut icon_info) } {
        eprintln!("GetIconInfo failed while rendering the cursor: {err}");
        return None;
    }

    let image = compose(&icon_info, snapshot.width, snapshot.height);
    release_icon_bitmaps(&icon_info);

    Some(crop_to_visible(image?, snapshot.hotspot_x, snapshot.hotspot_y))
}

fn compose(icon_info: &ICONINFO, width: i32, height: i32) -> Option<RgbaImage> {
    let monochrome = icon_info.hbmColor.is_invalid();
    let mask_height = if monochrome { height * 2 } else { height };

    let hdc_screen = unsafe { GetDC(None) };
    let hdc = unsafe { CreateCompatibleDC(Some(hdc_screen)) };

    let mask = read_bitmap(hdc, icon_info.hbmMask, width, mask_height);
    let color = if monochrome {
        None
    } else {
        read_bitmap(hdc, icon_info.hbmColor, width, height)
    };

    unsafe {
        if !DeleteDC(hdc).as_bool() {
            eprintln!("DeleteDC failed while releasing the cursor device context");
        }
        ReleaseDC(Some(HWND::default()), hdc_screen);
    }

    let mask = mask?;
    let pixels = match color {
        Some(color) => from_color(&color, &mask),
        None => from_mask(&mask, (width * height) as usize),
    };

    RgbaImage::from_raw(width as u32, height as u32, pixels)
}

/// 32-bit cursors carry their own alpha; older ones leave it zero and rely on the AND mask.
fn from_color(color: &[u8], mask: &[u8]) -> Vec<u8> {
    let has_alpha = color.chunks_exact(4).any(|pixel| pixel[3] != 0);
    let mut pixels = Vec::with_capacity(color.len());

    for (index, pixel) in color.chunks_exact(4).enumerate() {
        let alpha = if has_alpha { pixel[3] } else { mask_alpha(mask, index) };
        pixels.extend_from_slice(&[pixel[2], pixel[1], pixel[0], alpha]);
    }

    pixels
}

fn from_mask(mask: &[u8], count: usize) -> Vec<u8> {
    let mut pixels = Vec::with_capacity(count * 4);

    for index in 0..count {
        // Below the AND half sits the XOR half: white paints white, black paints black.
        let paints = mask_alpha(mask, index) == 255;
        let white = mask.get((count + index) * 4).is_some_and(|channel| *channel != 0);

        // AND set with XOR set means "invert whatever is behind", which a still image
        // can't do, and it's the entire glyph on the stock I-beam and crosshair. Black
        // is the closest single choice, since they're most often over light content.
        let (luminance, alpha) = match (paints, white) {
            (true, white) => (if white { 255 } else { 0 }, 255),
            (false, true) => (0, 255),
            (false, false) => (0, 0),
        };

        pixels.extend_from_slice(&[luminance, luminance, luminance, alpha]);
    }

    pixels
}

/// The AND mask is 0 where the cursor paints and 1 where the screen shows through.
fn mask_alpha(mask: &[u8], index: usize) -> u8 {
    match mask.get(index * 4) {
        Some(0) => 255,
        _ => 0,
    }
}

/// Cursor bitmaps are padded out to a fixed size, so the placed overlay would be mostly empty.
fn crop_to_visible(image: RgbaImage, hotspot_x: i32, hotspot_y: i32) -> RenderedCursor {
    let (mut left, mut top, mut right, mut bottom) = (u32::MAX, u32::MAX, 0u32, 0u32);

    for (x, y, pixel) in image.enumerate_pixels() {
        if pixel.0[3] == 0 {
            continue;
        }

        left = left.min(x);
        top = top.min(y);
        right = right.max(x + 1);
        bottom = bottom.max(y + 1);
    }

    if left >= right || top >= bottom {
        return RenderedCursor { image, hotspot_x, hotspot_y };
    }

    RenderedCursor {
        image: image::imageops::crop_imm(&image, left, top, right - left, bottom - top).to_image(),
        hotspot_x: hotspot_x - left as i32,
        hotspot_y: hotspot_y - top as i32,
    }
}

fn read_bitmap(hdc: HDC, bitmap: HBITMAP, width: i32, height: i32) -> Option<Vec<u8>> {
    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut buffer = vec![0u8; (width * height * 4) as usize];
    let copied = unsafe {
        GetDIBits(
            hdc,
            bitmap,
            0,
            height as u32,
            Some(buffer.as_mut_ptr().cast()),
            &mut bmi,
            DIB_RGB_COLORS,
        )
    };

    if copied == 0 {
        eprintln!("GetDIBits copied no scanlines from a cursor bitmap");
        return None;
    }

    Some(buffer)
}

/// GetIconInfo hands back freshly created bitmaps; hbmColor is absent for monochrome cursors.
fn release_icon_bitmaps(icon_info: &ICONINFO) {
    for bitmap in [icon_info.hbmMask, icon_info.hbmColor] {
        if !bitmap.is_invalid() && !unsafe { DeleteObject(bitmap.into()) }.as_bool() {
            eprintln!("DeleteObject failed while releasing a cursor bitmap");
        }
    }
}
