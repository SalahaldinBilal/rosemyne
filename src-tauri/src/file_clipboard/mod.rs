//! Puts a file itself (not its pixels) on the OS clipboard, so it pastes as a
//! file into Explorer/file managers and chat apps. Used for videos and other
//! non-image history entries, and for recordings on save.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::{copy_file, copy_text};
#[cfg(target_os = "windows")]
pub use windows::{copy_file, copy_text};
