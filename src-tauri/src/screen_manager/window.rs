use crate::dimensions::traits::IntoDimensions;
use serde::{Deserialize, Serialize};
use std::cmp::{max, min};
use std::collections::HashMap;

use crate::dimensions::{
    impls::{Dimensions, DimensionsWithOrder},
    traits::DimensionsTrait,
};
use crate::screen_manager::screenshot_manager::TagValue;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub z_order: i32,
}

impl WindowBounds {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }

    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }

    /// Will return none if any of the resulting dimensions are negative
    pub fn to_normalized_ordered_dimensions(
        &self,
        base: &WindowBounds,
    ) -> Option<DimensionsWithOrder> {
        let dims = self.to_normalized_dimensions(base)?;

        Some(DimensionsWithOrder {
            x: dims.x,
            y: dims.y,
            width: dims.width,
            height: dims.height,
            z_order: u32::try_from(self.z_order).ok()?,
        })
    }

    /// Will return none if any of the resulting dimensions are negative
    pub fn to_normalized_dimensions(&self, base: &WindowBounds) -> Option<Dimensions> {
        let left = u32::try_from(self.left - base.left).ok()?;
        let right = u32::try_from(self.right - base.left).ok()?;
        let top = u32::try_from(self.top - base.top).ok()?;
        let bottom = u32::try_from(self.bottom - base.top).ok()?;

        Some(Dimensions {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub name: String,
    pub process_name: String,
    /// The snap/crop box, with any composited border stripped. What the frontend selects.
    pub dimensions: DimensionsWithOrder,
    /// The full composited frame the window actually paints over, kept out of the
    /// frontend payload. Occlusion and coverage must use this, not `dimensions`, or
    /// the stripped border becomes a gap every window behind this one shows through.
    #[serde(skip)]
    pub frame: DimensionsWithOrder,
    pub sub_dimensions: Vec<DimensionsWithOrder>,
    pub visible_percentage: f64,
    pub visible_bounds: Vec<Dimensions>,
}

impl WindowInfo {
    pub fn new(
        name: String,
        process_name: String,
        dimensions: DimensionsWithOrder,
        frame: DimensionsWithOrder,
        sub_dimensions: Vec<DimensionsWithOrder>,
    ) -> Self {
        Self {
            name,
            process_name,
            dimensions,
            frame,
            sub_dimensions,
            visible_percentage: 0.0,
            visible_bounds: Vec::new(),
        }
    }
}

pub fn calculate_visible_bounds(windows: Vec<WindowInfo>) -> Vec<WindowInfo> {
    let mut windows: Vec<WindowInfo> = windows;

    let result: Vec<_> = windows
        .iter()
        .rev()
        .enumerate()
        .map(|(i, current_window)| {
            let total_area = (current_window.frame.width * current_window.frame.height) as f64;
            let mut bounds: Vec<Dimensions> = vec![current_window.frame.clone().into_dimensions()];

            for other_window in windows.iter().rev().skip(i + 1) {
                bounds = bounds
                    .into_iter()
                    .flat_map(|bound| subtract_intersection(&bound, &other_window.frame))
                    .collect();
            }

            let bounds_area: u32 = bounds.iter().map(|b| b.width * b.height).sum();

            (bounds_area as f64 / total_area, bounds)
        })
        .rev()
        .collect();

    for (i, (percentage, bounds)) in result.into_iter().enumerate() {
        windows[i].visible_percentage = percentage;
        windows[i].visible_bounds = bounds;
    }

    windows
}

/// Per-window "Window Name"/"Process Name"/"Screenshot Percentage" tag maps
/// for the windows whose visible area intersects the captured region, the
/// shape stored under the `Windows` tag of saved captures.
pub fn window_coverage_tags(
    windows: &[WindowInfo],
    region: &Dimensions,
) -> Vec<HashMap<String, TagValue>> {
    let total_area = region.width * region.height;
    if total_area == 0 {
        return Vec::new();
    }

    windows
        .iter()
        .filter_map(|window| {
            if window.visible_percentage == 0.0 {
                return None;
            }

            let taken_area: u32 = window
                .visible_bounds
                .iter()
                .map(|bounds| bounds.intersection_area(region))
                .sum();

            if taken_area == 0 {
                return None;
            }

            let mut value: HashMap<String, TagValue> = HashMap::new();
            value.insert(
                "Window Name".to_owned(),
                TagValue::String(window.name.clone()),
            );
            value.insert(
                "Process Name".to_owned(),
                TagValue::String(window.process_name.clone()),
            );
            value.insert(
                "Screenshot Percentage".to_owned(),
                TagValue::Float(taken_area as f64 / total_area as f64),
            );

            Some(value)
        })
        .collect()
}

fn subtract_intersection<D1, D2>(window1: &D1, window2: &D2) -> Vec<Dimensions>
where
    D1: DimensionsTrait + Clone,
    D2: DimensionsTrait + Clone,
{
    let mut result = Vec::new();

    let x_overlap_start = max(window1.x(), window2.x());
    let x_overlap_end = min(window1.x() + window1.width(), window2.x() + window2.width());
    let y_overlap_start = max(window1.y(), window2.y());
    let y_overlap_end = min(
        window1.y() + window1.height(),
        window2.y() + window2.height(),
    );

    if x_overlap_start < x_overlap_end && y_overlap_start < y_overlap_end {
        if window1.x() < x_overlap_start {
            result.push(Dimensions {
                x: window1.x(),
                y: window1.y(),
                width: (x_overlap_start - window1.x()) as u32,
                height: window1.height(),
            });
        }
        if window1.x() + window1.width() > x_overlap_end {
            result.push(Dimensions {
                x: x_overlap_end,
                y: window1.y(),
                width: (window1.x() + window1.width() - x_overlap_end) as u32,
                height: window1.height(),
            });
        }
        if window1.y() < y_overlap_start {
            result.push(Dimensions {
                x: max(window1.x(), x_overlap_start),
                y: window1.y(),
                width: min(
                    window1.width(),
                    (x_overlap_end - max(window1.x(), x_overlap_start)) as u32,
                ),
                height: (y_overlap_start - window1.y()) as u32,
            });
        }
        if window1.y() + window1.height() > y_overlap_end {
            result.push(Dimensions {
                x: max(window1.x(), x_overlap_start),
                y: y_overlap_end,
                width: min(
                    window1.width(),
                    (x_overlap_end - max(window1.x(), x_overlap_start)) as u32,
                ),
                height: (window1.y() + window1.height() - y_overlap_end) as u32,
            });
        }
    } else {
        result.push(window1.clone().into_dimensions());
    }

    result
}
