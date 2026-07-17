pub mod commands;
pub mod error;
pub mod recorder_trait;

#[cfg(target_os = "windows")]
pub mod audio;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "windows")]
pub type Recorder = windows::WindowsRecorder;
#[cfg(target_os = "linux")]
pub type Recorder = linux::LinuxRecorder;
