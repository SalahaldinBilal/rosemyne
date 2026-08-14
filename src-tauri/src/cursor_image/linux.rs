use super::{CursorSnapshot, RenderedCursor};

pub fn snapshot_cursor() -> Option<CursorSnapshot> {
    None
}

pub fn render_cursor(_snapshot: CursorSnapshot) -> Option<RenderedCursor> {
    None
}

pub fn render_scheme_cursors() -> Vec<(String, String, RenderedCursor)> {
    Vec::new()
}
