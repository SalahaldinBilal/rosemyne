use std::sync::atomic::{AtomicIsize, Ordering};
use tauri::{AppHandle, PhysicalPosition, PhysicalSize, Runtime, Webview, WebviewWindow};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{MONITOR_DEFAULTTONEAREST, MonitorFromRect};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE, GetDpiForMonitor, MDT_EFFECTIVE_DPI,
    SetThreadDpiAwarenessContext,
};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller3;
use webview2_windows_core::Interface;
use windows::Win32::UI::WindowsAndMessaging::{
    ClipCursor, GW_CHILD, GWL_EXSTYLE, GetForegroundWindow, GetWindow, GetWindowLongPtrW,
    GetWindowThreadProcessId, IsWindow, STYLESTRUCT, SWP_NOACTIVATE, SWP_NOZORDER,
    SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, WM_DPICHANGED, WM_STYLECHANGING,
    WS_EX_TOOLWINDOW,
};

use super::{base_window_builder, manager_trait::ScreenshotWindowManager};
use crate::{
    ScreenshotWebview, capture_overlay::disable_window_dragging,
    screen_manager::window::WindowBounds,
};

/// Offset used to move the screenshotter window off-screen instead of hiding it
/// (avoids a hide/show flicker); also used to recognize windows parked there by
/// other apps using the same trick, so they're excluded from capture.
pub const OFFSCREEN_HIDE_OFFSET: i32 = -32000;

pub struct WindowsScreenshotWindowManager;

impl ScreenshotWindowManager for WindowsScreenshotWindowManager {
    fn create<R: Runtime>(
        app_handle: &AppHandle<R>,
        bounds: &WindowBounds,
    ) -> tauri::Result<WebviewWindow<R>> {
        // Per-monitor v1, not v2: only v2 top-levels fan WM_DPICHANGED_AFTERPARENT out to the
        // WebView2 child (another process, can't be subclassed) on every park/unpark crossing.
        let old_dpi_context =
            unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE) };

        let window = base_window_builder(app_handle, bounds)
            .position(
                bounds.left as f64 + OFFSCREEN_HIDE_OFFSET as f64,
                bounds.top as f64 + OFFSCREEN_HIDE_OFFSET as f64,
            )
            .build();

        unsafe {
            SetThreadDpiAwarenessContext(old_dpi_context);
        }

        let window = window?;

        mark_as_tool_window(&window);
        pin_webview_scale(&window, shown_scale(bounds));
        apply_physical_bounds(&window, bounds);
        disable_window_dragging(&window);
        window.set_ignore_cursor_events(true).ok();

        // The builder's `.position(...)` isn't reliably applied yet at this point; re-assert it.
        window
            .set_position(PhysicalPosition::new(
                bounds.left + OFFSCREEN_HIDE_OFFSET,
                bounds.top + OFFSCREEN_HIDE_OFFSET,
            ))
            .ok();

        Ok(window)
    }

    fn show<R: Runtime>(webview: &ScreenshotWebview<R>) {
        remember_previous_focus(&webview.window);

        // Everything visible-affecting happens while still parked; the move is the reveal.
        apply_physical_bounds(&webview.window, &webview.position);
        webview.window.set_ignore_cursor_events(false).ok();

        let _ = webview.window.set_always_on_top(false);
        let _ = webview.window.set_always_on_top(true);

        webview
            .window
            .set_position(PhysicalPosition::new(
                webview.position.left,
                webview.position.top,
            ))
            .ok();

        resync_webview_bounds(
            &webview.window,
            webview.position.width(),
            webview.position.height(),
        );

        let window = webview.window.clone();
        if let Err(error) = webview.window.run_on_main_thread(move || {
            force_focus(&window);
            release_cursor_clip();
        }) {
            eprintln!("Failed to schedule screenshot overlay focus: {error}");
            release_cursor_clip();
        }
    }

    fn hide<R: Runtime>(webview: &ScreenshotWebview<R>) {
        webview
            .window
            .set_position(PhysicalPosition::new(
                webview.position.left + OFFSCREEN_HIDE_OFFSET,
                webview.position.top + OFFSCREEN_HIDE_OFFSET,
            ))
            .ok();

        webview.window.set_ignore_cursor_events(true).ok();
        restore_previous_focus();
    }
}

static PREVIOUS_FOCUS: AtomicIsize = AtomicIsize::new(0);

fn remember_previous_focus<R: Runtime>(window: &WebviewWindow<R>) {
    let Ok(raw_hwnd) = window.hwnd() else { return };
    let our_hwnd = HWND(raw_hwnd.0 as _);

    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.0.is_null() || foreground == our_hwnd {
            return;
        }

        PREVIOUS_FOCUS.store(foreground.0 as isize, Ordering::SeqCst);
    }
}

fn restore_previous_focus() {
    let raw = PREVIOUS_FOCUS.swap(0, Ordering::SeqCst);
    if raw == 0 {
        return;
    }

    let hwnd = HWND(raw as _);
    unsafe {
        if IsWindow(Some(hwnd)).as_bool() {
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

/// `.set_focus()` (`SetForegroundWindow`) is silently ignored by Windows when
/// the calling process isn't already the foreground one, exactly the case
/// here, since the overlay is normally raised by a global hotkey while some
/// other app is focused. Without this, the window can appear on top yet
/// never actually receive keyboard input, so Esc/right-click-to-cancel (and
/// arrow-key nudging) don't work until the user clicks it themselves.
/// Briefly attaching this thread's input queue to the current foreground
/// thread is the standard workaround: while attached, Windows treats the two
/// as one input context and the foreground-lock restriction doesn't apply.
fn force_focus<R: Runtime>(window: &WebviewWindow<R>) {
    let Ok(raw_hwnd) = window.hwnd() else {
        focus_window_and_webview(window);
        return;
    };
    let target_hwnd = HWND(raw_hwnd.0 as _);

    unsafe {
        let foreground_hwnd = GetForegroundWindow();
        if foreground_hwnd.0.is_null() || foreground_hwnd == target_hwnd {
            focus_window_and_webview(window);
            return;
        }

        let foreground_thread = GetWindowThreadProcessId(foreground_hwnd, None);
        let current_thread = GetCurrentThreadId();

        if foreground_thread == 0 || foreground_thread == current_thread {
            let _ = SetForegroundWindow(target_hwnd);
            focus_window_and_webview(window);
            return;
        }

        let _ = AttachThreadInput(current_thread, foreground_thread, true);
        let _ = SetForegroundWindow(target_hwnd);
        focus_window_and_webview(window);
        let _ = AttachThreadInput(current_thread, foreground_thread, false);
    }
}

/// Fullscreen games commonly confine the cursor. Once the screenshot overlay owns the
/// foreground, that old clip is no longer valid and would make the selector's
/// pointer unusable. Clearing it is process-independent. When the game regains
/// focus after the overlay closes, it can establish its preferred clip again.
fn release_cursor_clip() {
    unsafe {
        let _ = ClipCursor(None);
    }
}

// `WebviewWindow::set_focus` only focuses the top-level window; the embedded WebView2 control needs its own separate focus call to actually receive keyboard input.
fn focus_window_and_webview<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.set_focus();
    let _ = AsRef::<Webview<R>>::as_ref(window).set_focus();
}

/// Chromium/Firefox track native-window occlusion and stop rendering when they
/// think they're fully covered, behind the live-desktop pick/record overlay
/// that pauses pages and blanks hardware-overlay video (e.g. YouTube goes
/// black). Both trackers skip WS_EX_TOOLWINDOW windows, so mark the overlay
/// as one; its only other effect is Alt-Tab exclusion, fine for an overlay.
/// tao rewrites GWL_EXSTYLE wholesale from its own flags on every window-state
/// change (the set_ignore_cursor_events toggles around show/hide do exactly
/// that), which would strip a bit set only once, so a subclass re-injects it
/// into every incoming style change instead.
fn mark_as_tool_window<R: Runtime>(window: &WebviewWindow<R>) {
    let Ok(hwnd) = window.hwnd() else { return };
    let hwnd = HWND(hwnd.0 as _);

    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(tool_window_subclass_proc), 1, 0);
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_TOOLWINDOW.0 as isize);
    }
}

unsafe extern "system" fn tool_window_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> LRESULT {
    if msg == WM_STYLECHANGING && wparam.0 as i32 == GWL_EXSTYLE.0 {
        let style = lparam.0 as *mut STYLESTRUCT;
        if !style.is_null() {
            unsafe { (*style).styleNew |= WS_EX_TOOLWINDOW.0 };
        }
    }

    // Parking crosses a DPI boundary; tao's rescale would race the first paint (flicker).
    if msg == WM_DPICHANGED {
        return LRESULT(0);
    }

    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Re-assert the physical bounds and the zoom that maps CSS pixels 1:1 to screen pixels.
fn apply_physical_bounds<R: Runtime>(window: &WebviewWindow<R>, bounds: &WindowBounds) {
    window
        .set_size(PhysicalSize::new(
            bounds.width() as u32,
            bounds.height() as u32,
        ))
        .ok();

    let _ = window.set_zoom(1.0 / shown_scale(bounds));
}

/// Scale of the monitor Windows associates the shown window with (largest overlap).
fn shown_scale(bounds: &WindowBounds) -> f64 {
    let rect = RECT {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
    };

    unsafe {
        let monitor = MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST);
        let (mut dpi_x, mut dpi_y) = (0u32, 0u32);
        if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y).is_ok() && dpi_x > 0
        {
            return dpi_x as f64 / 96.0;
        }
    }

    1.0
}

/// Park/unpark DPI changes still shrink the webview's inner HWNDs; re-assert them or the page clips.
fn resync_webview_bounds<R: Runtime>(window: &WebviewWindow<R>, width: i32, height: i32) {
    let Ok(raw_hwnd) = window.hwnd() else { return };
    let parent = raw_hwnd.0 as isize;

    let _ = window.with_webview(move |webview| unsafe {
        if let Ok(child) = GetWindow(HWND(parent as _), GW_CHILD) {
            let _ = SetWindowPos(child, None, 0, 0, width, height, SWP_NOZORDER | SWP_NOACTIVATE);
        }

        let _ = webview.controller().SetBounds(webview2_windows::Win32::Foundation::RECT {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
        });
    });
}

/// Freeze WebView2's scale so park/unpark DPI changes never re-rasterize mid-show (flicker).
fn pin_webview_scale<R: Runtime>(window: &WebviewWindow<R>, scale: f64) {
    let _ = window.with_webview(move |webview| unsafe {
        if let Ok(controller) = webview.controller().cast::<ICoreWebView2Controller3>() {
            let _ = controller.SetShouldDetectMonitorScaleChanges(false);
            let _ = controller.SetRasterizationScale(scale);
        }
    });
}
