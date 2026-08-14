use std::ffi::c_void;

use image::RgbaImage;
use windows::Win32::{
    Foundation::HWND,
    Graphics::Gdi::{
        BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC,
        DeleteObject, GetDC, GetDIBits, GetObjectW, HBITMAP, HDC, ReleaseDC,
    },
    UI::WindowsAndMessaging::{CURSOR_SHOWING, CURSORINFO, GetCursorInfo, GetIconInfo, HICON, ICONINFO},
};

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

        let mut icon_info = ICONINFO::default();
        if let Err(err) = GetIconInfo(HICON(info.hCursor.0), &mut icon_info) {
            eprintln!("GetIconInfo failed for the current cursor: {err}");
            return None;
        }

        let size = cursor_size(&icon_info);
        release_icon_bitmaps(&icon_info);
        let (width, height) = size?;

        Some(CursorSnapshot {
            handle: info.hCursor.0 as usize,
            width,
            height,
            hotspot_x: icon_info.xHotspot as i32,
            hotspot_y: icon_info.yHotspot as i32,
            screen_x: info.ptScreenPos.x,
            screen_y: info.ptScreenPos.y,
        })
    }
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
        let white = mask.get((count + index) * 4).is_some_and(|channel| *channel != 0);
        let luminance = if white { 255 } else { 0 };

        pixels.extend_from_slice(&[luminance, luminance, luminance, mask_alpha(mask, index)]);
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
