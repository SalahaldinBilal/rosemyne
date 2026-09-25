use super::ContextMenuStatus;
use crate::HttpClientHandler;

pub fn status() -> ContextMenuStatus {
    ContextMenuStatus {
        supported: false,
        enabled: false,
        note: None,
        windows11: None,
    }
}

pub async fn set_enabled(_http: &HttpClientHandler, _enabled: bool) -> Result<(), String> {
    Err("Context menu entries aren't supported on this platform yet".into())
}

pub async fn refresh(_http: &HttpClientHandler) {}

pub fn unregister() {}
