pub mod capture_trait;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "windows")]
pub type CapManager = windows::WindowsCaptureManager;
#[cfg(target_os = "linux")]
pub type CapManager = linux::LinuxCaptureManager;

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
compile_error!(
    "Rosemyne has no capture backend for this platform , only Windows is implemented (Linux is a stub)."
);
