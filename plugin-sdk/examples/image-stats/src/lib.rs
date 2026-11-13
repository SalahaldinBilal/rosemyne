use rosemyne_plugin::{export_hooks, host, json, CaptureSaved, HookResult, ToastKind};

fn orientation(width: u32, height: u32) -> &'static str {
    match width.cmp(&height) {
        std::cmp::Ordering::Greater => "landscape",
        std::cmp::Ordering::Less => "portrait",
        std::cmp::Ordering::Equal => "square",
    }
}

fn saved(input: CaptureSaved) -> HookResult<()> {
    let capture = input.capture;
    let (Some(width), Some(height)) = (capture.width, capture.height) else {
        return Ok(());
    };

    let megapixels = (f64::from(width) * f64::from(height) / 10_000.0).round() / 100.0;
    host::set_tags(Some(&json!({
        "Megapixels": megapixels,
        "Orientation": orientation(width, height),
    })))?;

    if host::setting::<bool>("notify")?.unwrap_or(false) {
        host::toast(ToastKind::Success, &format!("Tagged {} ({megapixels} MP)", capture.file_name))?;
    }
    Ok(())
}

export_hooks! {
    on_capture_saved => saved,
}
