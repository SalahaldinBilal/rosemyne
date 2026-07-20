use std::{
    ffi::OsString,
    os::{raw::c_void, windows::ffi::OsStringExt},
};

use image::RgbaImage;
use windows::Win32::{
    Foundation::{CloseHandle, HANDLE, HWND, LPARAM, RECT},
    Graphics::{
        Dwm::{DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute},
        Gdi::{
            BITMAPINFO, BITMAPINFOHEADER, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC,
            DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDIBits, GetWindowDC, HBITMAP, HDC,
            ReleaseDC, SRCCOPY, SelectObject,
        },
    },
    System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    },
    UI::WindowsAndMessaging::{
        AdjustWindowRectEx, EnumChildWindows, EnumWindows, GWL_EXSTYLE, GWL_STYLE, GetClassNameW,
        GetDesktopWindow, GetWindowLongPtrW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible, WINDOW_EX_STYLE, WINDOW_STYLE,
    },
};

use crate::{
    dimensions::{impls::DimensionsWithOrder, traits::DimensionsTrait},
    screen_manager::window::{WindowBounds, WindowInfo, calculate_visible_bounds},
    screenshot_window::windows::OFFSCREEN_HIDE_OFFSET,
};

use super::capture_trait::CaptureManager;

const CLASS_IGNORE_LIST: [&'static str; 1] = ["Progman"];

pub struct WindowsCaptureManager;

impl CaptureManager for WindowsCaptureManager {
    fn capture(dims: &WindowBounds) -> Result<RgbaImage, Box<dyn std::error::Error>> {
        unsafe {
            let hwnd = GetDesktopWindow();

            let hdc_screen = GetWindowDC(Some(hwnd));
            let hdc_compat = CreateCompatibleDC(Some(hdc_screen));
            let width = dims.width();
            let height = dims.height();

            let hbmp = CreateCompatibleBitmap(hdc_screen, width, height);
            let hbmp_old = SelectObject(hdc_compat, hbmp.into());

            let blit_result = BitBlt(
                hdc_compat,
                0,
                0,
                width,
                height,
                Some(hdc_screen),
                dims.left,
                dims.top,
                SRCCOPY,
            );

            SelectObject(hdc_compat, hbmp_old);

            if let Err(err) = blit_result {
                release_capture_resources(hbmp, hdc_compat);
                ReleaseDC(Some(hwnd), hdc_screen);
                return Err(format!("BitBlt failed: {}", err).into());
            }

            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biSizeImage: width as u32 * height as u32 * 4,
                    biCompression: 0,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut data: Vec<u8> = vec![0; bmi.bmiHeader.biSizeImage as usize];

            let lines_copied = GetDIBits(
                hdc_compat,
                hbmp,
                0,
                height as u32,
                Some(data.as_mut_ptr().cast()),
                &mut bmi,
                DIB_RGB_COLORS,
            );

            release_capture_resources(hbmp, hdc_compat);
            ReleaseDC(Some(hwnd), hdc_screen);

            if lines_copied == 0 {
                return Err("GetDIBits failed to copy any scanlines".into());
            }

            let image = RgbaImage::from_raw(width as u32, height as u32, bgra_to_rgba(data))
                .ok_or("Captured pixel buffer did not match the requested dimensions")?;

            Ok(image)
        }
    }

    fn get_visible_windows(normalization_base: &WindowBounds) -> Vec<WindowInfo> {
        let mut windows = Vec::<HWND>::with_capacity(50);
        enumerate_windows(|id| {
            if id.is_invalid() {
                return true;
            }

            windows.push(id);

            true
        });

        let mut z_order: u32 = 30000;

        let windows = windows
            .iter()
            .filter_map(|handle| {
                let handle = *handle;

                let visible = unsafe { IsWindowVisible(handle).as_bool() };

                if !visible {
                    return None;
                };

                let cloaked = is_window_cloaked(handle);

                if cloaked {
                    return None;
                }

                let length = unsafe { GetWindowTextLengthW(handle) };

                if length <= 0 {
                    return None;
                }

                let length = usize::try_from(length).ok()? + 1;

                let mut name = vec![0; length];
                let name_result = unsafe { GetWindowTextW(handle, name.as_mut_slice()) };

                if name_result == 0 {
                    return None;
                }

                let mut class_name = vec![0; 512];
                unsafe {
                    GetClassNameW(handle, &mut class_name);
                }
                let class_name = String::from_utf16(
                    &class_name[..class_name
                        .iter()
                        .position(|&x| x == 0)
                        .unwrap_or(class_name.len())],
                )
                .ok()?;

                if CLASS_IGNORE_LIST.contains(&class_name.as_str()) {
                    return None;
                }

                let rect = get_window_rect_without_drop_shadow(handle).ok()?;
                let rect = WindowBounds::from(rect);

                if rect.left == rect.right
                    || rect.top == rect.bottom
                    || rect.left <= OFFSCREEN_HIDE_OFFSET
                    || rect.top <= OFFSCREEN_HIDE_OFFSET
                    || (rect.right - rect.left) <= 0
                    || (rect.bottom - rect.top) <= 0
                {
                    return None;
                }

                let mut rect = rect.to_normalized_ordered_dimensions(normalization_base)?;

                let name = String::from_utf16(&name).ok()?;
                let name = name.trim_end_matches(char::from(0));

                let mut children: Vec<DimensionsWithOrder> = vec![];

                let process_name = get_process_name_from_hwnd(handle).ok()?;

                enumerate_child_windows(&handle, |child_handle| {
                    if child_handle.is_invalid() {
                        return true;
                    }

                    if !unsafe { IsWindowVisible(child_handle) }.as_bool()
                        || is_window_cloaked(child_handle)
                    {
                        return true;
                    }

                    let child_rect = match get_window_rect_without_drop_shadow(child_handle) {
                        Ok(rect) => rect,
                        Err(_) => return true,
                    };
                    let mut child_rect = match WindowBounds::from(child_rect)
                        .to_normalized_ordered_dimensions(normalization_base)
                    {
                        Some(child) => child,
                        None => return true,
                    };

                    if !child_rect.dims_equal(&rect)
                        && rect.intersection_area(&child_rect) > 0
                        && children
                            .iter()
                            .find(|dimensions| dimensions.dims_equal(&child_rect))
                            .is_none()
                    {
                        child_rect.z_order = z_order;
                        children.push(child_rect);
                        z_order -= 1;
                    }

                    true
                });

                rect.z_order = z_order;
                z_order -= 1;
                Some(WindowInfo::new(name.into(), process_name, rect, children))
            })
            .collect();

        calculate_visible_bounds(windows)
    }
}

fn get_window_rect_without_drop_shadow(hwnd: HWND) -> Result<RECT, String> {
    unsafe {
        // Try getting extended frame bounds using DWM (for windows with Aero/DWM effects)
        let mut extended_frame_bounds = RECT::default();
        let hr = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut extended_frame_bounds as *mut _ as _,
            std::mem::size_of::<RECT>() as u32,
        );

        if hr.is_ok() {
            // DWM successfully provided extended frame bounds, use these
            return Ok(extended_frame_bounds);
        } else {
            let mut adjusted_rect = RECT::default();
            if GetWindowRect(hwnd, &mut adjusted_rect).is_err() {
                return Err("GetWindowRect failed".into());
            }

            // DWM failed (likely on older Windows versions or if DWM is disabled)
            // Fallback to AdjustWindowRectEx

            // Get window styles and extended styles
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;

            if let Err(err) = AdjustWindowRectEx(
                &mut adjusted_rect,
                WINDOW_STYLE(style),
                false,
                WINDOW_EX_STYLE(ex_style),
            ) {
                eprintln!("AdjustWindowRectEx failed, frame bounds may be off: {err}");
            }

            Ok(adjusted_rect)
        }
    }
}

fn is_window_cloaked(hwnd: HWND) -> bool {
    let mut cloaked_val = u32::default();

    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked_val as *mut _ as _,
            std::mem::size_of::<u32>() as u32,
        )
        .map_or(false, |_| cloaked_val != 0)
    }
}

/// Frees the compatible bitmap/DC pair `capture` creates. A failure here
/// can't be acted on (the handles are already being abandoned either way),
/// so it's logged rather than propagated.
fn release_capture_resources(hbmp: HBITMAP, hdc_compat: HDC) {
    if !unsafe { DeleteObject(hbmp.into()) }.as_bool() {
        eprintln!("DeleteObject failed while releasing the capture bitmap");
    }
    if !unsafe { DeleteDC(hdc_compat) }.as_bool() {
        eprintln!("DeleteDC failed while releasing the capture device context");
    }
}

fn bgra_to_rgba(mut buffer: Vec<u8>) -> Vec<u8> {
    for src in buffer.chunks_exact_mut(4) {
        src.swap(0, 2);
    }

    buffer
}

pub fn enumerate_windows<F>(mut callback: F)
where
    F: FnMut(HWND) -> bool,
{
    let mut trait_obj: &mut dyn FnMut(HWND) -> bool = &mut callback;
    let closure_pointer_pointer: *mut c_void = unsafe { std::mem::transmute(&mut trait_obj) };

    let lparam = LPARAM(closure_pointer_pointer as isize);
    if let Err(err) = unsafe { EnumWindows(Some(enumerate_callback), lparam) } {
        eprintln!("EnumWindows failed: {err}");
    }
}

pub fn enumerate_child_windows<F>(parent: &HWND, mut callback: F)
where
    F: FnMut(HWND) -> bool,
{
    let mut trait_obj: &mut dyn FnMut(HWND) -> bool = &mut callback;
    let closure_pointer_pointer: *mut c_void = unsafe { std::mem::transmute(&mut trait_obj) };

    let lparam = LPARAM(closure_pointer_pointer as isize);
    let _ = unsafe { EnumChildWindows(Some(*parent), Some(enumerate_callback), lparam) };
}

unsafe extern "system" fn enumerate_callback(hwnd: HWND, lparam: LPARAM) -> windows_core::BOOL {
    let closure: &mut &mut dyn FnMut(HWND) -> bool =
        unsafe { std::mem::transmute(lparam.0 as *mut c_void) };
    if closure(hwnd) {
        windows::Win32::Foundation::TRUE
    } else {
        windows::Win32::Foundation::FALSE
    }
}

fn get_process_name_from_hwnd(hwnd: HWND) -> Result<String, String> {
    unsafe {
        let mut process_id: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));

        if process_id == 0 {
            return Err("Could not get process ID".to_string());
        }

        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(snapshot) => snapshot,
            Err(_) => return Err("Could not create snapshot".to_string()),
        };

        let mut process_entry: PROCESSENTRY32W = PROCESSENTRY32W::default();
        process_entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut process_entry).is_ok() {
            loop {
                if process_entry.th32ProcessID == process_id {
                    let process_name = OsString::from_wide(&process_entry.szExeFile)
                        .to_string_lossy()
                        .to_string()
                        .trim_end_matches(char::from(0))
                        .trim_end_matches(".exe")
                        .to_string();

                    close_snapshot_handle(snapshot);
                    return Ok(process_name);
                }

                if Process32NextW(snapshot, &mut process_entry).is_err() {
                    break;
                }
            }
        }

        close_snapshot_handle(snapshot);
        Err("Process not found".to_string())
    }
}

/// A failed close here leaks the snapshot handle for the process's lifetime ,
/// unfortunate, but not actionable, so it's logged rather than propagated.
fn close_snapshot_handle(snapshot: HANDLE) {
    if let Err(err) = unsafe { CloseHandle(snapshot) } {
        eprintln!("CloseHandle failed while closing the process snapshot: {err}");
    }
}

impl From<RECT> for WindowBounds {
    fn from(value: RECT) -> Self {
        Self {
            left: value.left,
            top: value.top,
            bottom: value.bottom,
            right: value.right,
            z_order: 0,
        }
    }
}
