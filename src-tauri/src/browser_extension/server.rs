use super::temp_root;
use crate::history_store::store::sanitize_file_name;
use crate::{file_clipboard, import_path};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::AppHandle;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const POLL_INTERVAL: Duration = Duration::from_millis(200);

struct Reply {
    status: u16,
    content_type: &'static str,
    body: String,
}

impl Reply {
    fn text(status: u16, body: impl Into<String>) -> Self {
        Self { status, content_type: "text/plain; charset=utf-8", body: body.into() }
    }

    fn json(body: String) -> Self {
        Self { status: 200, content_type: "application/json", body }
    }

    fn from_result(result: Result<(), String>) -> Self {
        match result {
            Ok(()) => Self::json(r#"{"ok":true}"#.to_string()),
            Err(error) => Self::text(500, error),
        }
    }
}

pub(super) fn serve(server: Server, port: u16, stop: Arc<AtomicBool>, app_handle: AppHandle) {
    while !stop.load(Ordering::SeqCst) {
        match server.recv_timeout(POLL_INTERVAL) {
            Ok(Some(request)) => {
                let app_handle = app_handle.clone();
                std::thread::spawn(move || handle(request, port, &app_handle));
            }
            Ok(None) => {}
            Err(err) => {
                eprintln!("Browser extension server stopped: {err}");
                break;
            }
        }
    }
}

fn header_value(request: &Request, name: &'static str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(name))
        .map(|header| header.value.as_str().to_string())
}

fn is_local_host(host: &str, port: u16) -> bool {
    host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}")
}

fn is_extension_origin(origin: &str) -> bool {
    origin.starts_with("chrome-extension://") || origin.starts_with("moz-extension://")
}

fn file_name_from_query(query: &str) -> Option<String> {
    url::form_urlencoded::parse(query.as_bytes())
        .find(|(key, _)| key == "name")
        .map(|(_, value)| sanitize_file_name(&value))
}

fn handle(mut request: Request, port: u16, app_handle: &AppHandle) {
    let origin = header_value(&request, "Origin");
    let host = header_value(&request, "Host");
    let method = request.method().clone();
    let url = request.url().to_string();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));

    let host_ok = host.as_deref().is_some_and(|host| is_local_host(host, port));
    let origin_ok = origin.as_deref().is_none_or(is_extension_origin);
    let from_extension = origin.is_some() && origin_ok;

    let reply = if !host_ok || !origin_ok {
        Reply::text(403, "Forbidden")
    } else {
        match (&method, path) {
            (Method::Options, _) => Reply::text(204, ""),
            (Method::Get, "/ping") => Reply::json(
                serde_json::json!({ "app": "rosemyne", "version": env!("CARGO_PKG_VERSION") })
                    .to_string(),
            ),
            (Method::Post, "/copy" | "/upload") if !from_extension => Reply::text(403, "Forbidden"),
            (Method::Post, "/copy") => Reply::from_result(
                receive(&mut request, query).and_then(|path| file_clipboard::copy_file(&path)),
            ),
            (Method::Post, "/upload") => Reply::from_result(
                receive(&mut request, query).and_then(|path| import(app_handle, &path)),
            ),
            _ => Reply::text(404, "Not found"),
        }
    };

    respond(request, reply, origin.filter(|_| from_extension));
}

fn receive(request: &mut Request, query: &str) -> Result<PathBuf, String> {
    let name = file_name_from_query(query).ok_or("Missing the file name")?;
    let dir = temp_root().join(format!("{:016x}", rand::random::<u64>()));
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;

    let path = dir.join(name);
    let mut file = std::fs::File::create(&path).map_err(|err| err.to_string())?;
    std::io::copy(request.as_reader(), &mut file).map_err(|err| err.to_string())?;
    Ok(path)
}

fn import(app_handle: &AppHandle, path: &Path) -> Result<(), String> {
    let result = tauri::async_runtime::block_on(import_path(app_handle, path.to_path_buf()));
    if let Some(dir) = path.parent() {
        let _ = std::fs::remove_dir_all(dir);
    }
    result.map(|_| ())
}

fn respond(request: Request, reply: Reply, allowed_origin: Option<String>) {
    let mut headers = vec![("Content-Type", reply.content_type.to_string())];
    if let Some(origin) = allowed_origin {
        headers.extend([
            ("Access-Control-Allow-Origin", origin),
            ("Access-Control-Allow-Methods", "GET, POST".to_string()),
            ("Access-Control-Allow-Headers", "Content-Type".to_string()),
            ("Access-Control-Allow-Private-Network", "true".to_string()),
            ("Vary", "Origin".to_string()),
        ]);
    }

    let mut response =
        Response::from_data(reply.body.into_bytes()).with_status_code(StatusCode(reply.status));
    for (name, value) in headers {
        if let Ok(header) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(header);
        }
    }

    if let Err(err) = request.respond(response) {
        eprintln!("Failed to answer the browser extension: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_extension_origins_are_accepted() {
        assert!(is_extension_origin("chrome-extension://abcdefghijklmnopabcdefghijklmnop"));
        assert!(is_extension_origin("moz-extension://4f1c2b6e-7d0a-4c55-9a1e-0d2f6a1b9c33"));
        assert!(!is_extension_origin("https://example.com"));
        assert!(!is_extension_origin("http://127.0.0.1:41873"));
        assert!(!is_extension_origin("null"));
    }

    #[test]
    fn host_header_must_name_the_loopback_port() {
        assert!(is_local_host("127.0.0.1:41873", 41873));
        assert!(is_local_host("localhost:41873", 41873));
        assert!(!is_local_host("evil.example:41873", 41873));
        assert!(!is_local_host("127.0.0.1:37619", 41873));
    }

    #[test]
    fn file_names_cannot_leave_the_temp_folder() {
        let name = file_name_from_query("name=..%2F..%2FWindows%2Fevil.exe").unwrap();
        assert!(!name.contains(['/', '\\']));
        assert_eq!(Path::new(&name).components().count(), 1);

        assert_eq!(file_name_from_query("name=cat%20video.mp4").unwrap(), "cat video.mp4");
        assert!(file_name_from_query("other=1").is_none());
    }
}
