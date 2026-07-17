use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

/// Advertises the file as a `text/uri-list`, the cross-desktop paste-as-file format.
pub fn copy_file(path: &Path) -> Result<(), String> {
    let uri = url::Url::from_file_path(path)
        .map_err(|_| "The file path is not absolute".to_string())?;

    copy_via(
        ("wl-copy", &["--type", "text/uri-list"]),
        ("xclip", &["-selection", "clipboard", "-t", "text/uri-list"]),
        &format!("{uri}\r\n"),
    )
}

/// Writes plain text.
pub fn copy_text(text: &str) -> Result<(), String> {
    copy_via(("wl-copy", &[]), ("xclip", &["-selection", "clipboard"]), text)
}

/// Pipes the payload through wl-copy (Wayland) or xclip (X11), preferring the
/// one matching the session , both daemonize to own the selection for as long
/// as needed, which a short-lived write from this process can't do itself.
fn copy_via(wayland: (&str, &[&str]), x11: (&str, &[&str]), payload: &str) -> Result<(), String> {
    let candidates = if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        [wayland, x11]
    } else {
        [x11, wayland]
    };

    let mut last_error = String::new();
    for (program, args) in candidates {
        match pipe_to(program, args, payload) {
            Ok(()) => return Ok(()),
            Err(err) => last_error = err,
        }
    }

    Err(format!("Failed to copy to the clipboard: {last_error}"))
}

fn pipe_to(program: &str, args: &[&str], input: &str) -> Result<(), String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("{program}: {err}"))?;

    let write_result = child
        .stdin
        .take()
        .ok_or_else(|| format!("{program}: stdin unavailable"))
        .and_then(|mut stdin| {
            stdin
                .write_all(input.as_bytes())
                .map_err(|err| format!("{program}: {err}"))
        });

    let status = child.wait().map_err(|err| format!("{program}: {err}"))?;
    write_result?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("{program} exited with {status}"))
    }
}
