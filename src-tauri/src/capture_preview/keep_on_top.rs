use std::sync::Mutex;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::time::{Duration, Instant};

use tauri::WebviewWindow;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows::Win32::UI::WindowsAndMessaging::{
    EVENT_OBJECT_REORDER, EVENT_SYSTEM_FOREGROUND, GW_HWNDPREV, GetWindow, GetWindowRect, HWND_TOPMOST, IsWindowVisible,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

const RAISE_BUDGET: u32 = 5;
const BUDGET_WINDOW: Duration = Duration::from_secs(1);

static PREVIEW_HWND: AtomicIsize = AtomicIsize::new(0);
static HOOKS: Mutex<Vec<isize>> = Mutex::new(Vec::new());
static BUDGET: Mutex<Option<(Instant, u32)>> = Mutex::new(None);

/// Must run on the main thread: out-of-context hooks are delivered through the installing thread's message loop.
pub fn start(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else { return };
    PREVIEW_HWND.store(hwnd.0 as isize, Ordering::SeqCst);

    let Ok(mut hooks) = HOOKS.lock() else { return };
    if !hooks.is_empty() {
        return;
    }

    for event in [EVENT_SYSTEM_FOREGROUND, EVENT_OBJECT_REORDER] {
        let hook = unsafe {
            SetWinEventHook(event, event, None, Some(on_win_event), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS)
        };
        if hook.0.is_null() {
            eprintln!("Failed to hook window event {:#x} for the capture preview", event);
        } else {
            hooks.push(hook.0 as isize);
        }
    }
}

/// Must run on the main thread, the same one that installed the hooks.
pub fn stop() {
    PREVIEW_HWND.store(0, Ordering::SeqCst);

    let Ok(mut hooks) = HOOKS.lock() else { return };
    for hook in hooks.drain(..) {
        unsafe {
            let _ = UnhookWinEvent(HWINEVENTHOOK(hook as _));
        }
    }
}

unsafe extern "system" fn on_win_event(_hook: HWINEVENTHOOK, _event: u32, _hwnd: HWND, _object: i32, _child: i32, _thread: u32, _time: u32) {
    let raw = PREVIEW_HWND.load(Ordering::SeqCst);
    if raw == 0 {
        return;
    }

    let hwnd = HWND(raw as _);
    if !unsafe { is_covered(hwnd) } || !take_budget() {
        return;
    }

    if let Err(err) = unsafe { SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) } {
        eprintln!("Failed to re-raise the capture preview: {}", err);
    }
}

unsafe fn is_covered(hwnd: HWND) -> bool {
    let mut own = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut own) }.is_err() {
        return false;
    }

    let mut above = unsafe { GetWindow(hwnd, GW_HWNDPREV) };
    while let Ok(other) = above {
        if other.0.is_null() {
            break;
        }
        if unsafe { IsWindowVisible(other) }.as_bool() {
            let mut rect = RECT::default();
            if unsafe { GetWindowRect(other, &mut rect) }.is_ok() && intersects(&own, &rect) {
                return true;
            }
        }
        above = unsafe { GetWindow(other, GW_HWNDPREV) };
    }
    false
}

fn intersects(a: &RECT, b: &RECT) -> bool {
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

fn take_budget() -> bool {
    let Ok(mut budget) = BUDGET.lock() else { return false };
    let now = Instant::now();

    match budget.as_mut() {
        Some((started, count)) if now.duration_since(*started) < BUDGET_WINDOW => {
            if *count >= RAISE_BUDGET {
                return false;
            }
            *count += 1;
            true
        }
        _ => {
            *budget = Some((now, 1));
            true
        }
    }
}
