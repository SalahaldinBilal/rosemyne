use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow, WindowFromPoint,
};

use crate::{MouseHandler, screen_manager::window::WindowBounds};

use super::error::ScrollCaptureError;
use super::scroll_trait::ScrollInputManager;

/// Delivers via real, system-level wheel input (`mouse_rs`) rather than
/// posting to a hit-tested window handle, wheel input routes by keyboard
/// focus, not whatever's under a point, so `focus_target` gives the target
/// real focus first.
pub struct WindowsScrollInputManager;

impl ScrollInputManager for WindowsScrollInputManager {
    fn focus_target(region: &WindowBounds) -> Result<(), ScrollCaptureError> {
        let center_x = region.left + (region.right - region.left) / 2;
        let center_y = region.top + (region.bottom - region.top) / 2;

        unsafe {
            let target = WindowFromPoint(POINT { x: center_x, y: center_y });
            if target.is_invalid() {
                return Err(ScrollCaptureError::Failed(
                    "No window found under the selected region".into(),
                ));
            }

            if !force_foreground(target) {
                eprintln!(
                    "Failed to focus the scrolling capture target; scroll input may miss it"
                );
            }
        }

        Ok(())
    }

    fn scroll_step(amount: i32, mouse: &MouseHandler) -> Result<(), ScrollCaptureError> {
        // One call for the whole step, a compliant receiver accumulates
        // delta regardless of how many events it arrives in, so splitting
        // this into individual notch-sized calls has no effect.
        mouse
            .wheel(amount)
            .map_err(|err| ScrollCaptureError::Failed(format!("Failed to send the wheel scroll: {err}")))
    }
}

/// `SetForegroundWindow` alone routinely fails outside the foreground process
/// (Windows' "foreground lock"), attaching this thread's input queue to the
/// current foreground thread borrows its permission to change it instead.
unsafe fn force_foreground(target: HWND) -> bool {
    unsafe {
        if SetForegroundWindow(target).as_bool() {
            return true;
        }

        let foreground = GetForegroundWindow();
        if foreground.is_invalid() {
            return SetForegroundWindow(target).as_bool();
        }

        let current_thread = GetCurrentThreadId();
        let foreground_thread = GetWindowThreadProcessId(foreground, None);

        if foreground_thread == 0 || foreground_thread == current_thread {
            return SetForegroundWindow(target).as_bool();
        }

        let attached = AttachThreadInput(current_thread, foreground_thread, true).as_bool();
        let result = SetForegroundWindow(target).as_bool();
        if attached {
            let _ = AttachThreadInput(current_thread, foreground_thread, false);
        }
        result
    }
}
