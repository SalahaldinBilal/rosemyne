# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.6] - 2026-07-22

### Added

- Screenshots, videos, and files in the history list now have an "Edit Tags" option in their right-click menu, letting you add, edit, or remove tags , including nested/structured ones , directly from the item. Newly added tags immediately become available in the filter panel.

### Changed

- Window snap-to-select in the screenshot overlay now tracks the cursor continuously , including the instant the overlay opens , and always highlights the nearest window instead of only updating when the cursor is directly over one.

## [0.1.5] - 2026-07-22

### Fixed

- The capture overlay could occasionally show up behind other always-on-top windows instead of above them.

## [0.1.4] - 2026-07-20

### Added

- The window that was focused before taking a screenshot is now refocused again once the capture overlay closes.

### Fixed

- The capture overlay's window borders/highlight boxes could be wrong on the very first screenshot taken after launching the app.
- Pressing Escape (and other keyboard input) in the capture overlay could fail to register until the mouse was clicked first.
- The capture overlay and other Rosemyne windows (recording HUD/border, capture preview) could be dragged or resized by external window-management tools like AltSnap.

## [0.1.3] - 2026-07-20

### Fixed

- Long file names in the screenshot/video preview modal no longer overflow past the close button.
- Improved window detection reliability so captured window/tag data and the window snap-to-select are less likely to intermittently miss windows.
- The capture preview popup no longer briefly flashes the previous screenshot before showing the new one.

## [0.1.2] - 2026-07-18

### Added

- A capture preview popup now shows a small preview of each screenshot/recording after it's saved (or after upload, if auto-upload is enabled), configurable in Settings → "Capture Preview" (position, monitor, margins, max size, auto-dismiss, and click actions).
- Overlay tool defaults (fill/border color, thickness, text size/font, blur/pixelate intensity) can now be customized in Settings → "Overlay Defaults" and persist across restarts.
- Dragging a screenshot, video, or file out of the history list now drags the actual file, so it can be dropped directly into other apps.
- Added a file size filter option to the history filters.
- Large imported ShareX videos that are missing a thumbnail now get one generated automatically after import.

### Changed

- The history list no longer shows action buttons on hover; the copy button now sits next to the file name, and uploading/deleting have moved into the right-click menu, with re-uploading an already-uploaded image asking for confirmation.
- Reworked the Updates settings page layout.
- The screenshot selection cursor now shows a crosshair while dragging a region.
- Video thumbnails are now saved at full WebP quality.

### Fixed

- ShareX migration now respects the "Save path template" setting instead of dumping everything into one folder.
- Right-clicking a placed overlay tool to open its options no longer closes the whole screenshot overlay.
- Pressing Escape or right-clicking while dragging a selection now cancels just the selection instead of closing the overlay.

## [0.1.1] - 2026-07-17

### Changed

- Increased the default main window size for better readability.
- The app no longer pops its main window open when launched automatically at startup; it stays in the tray until opened manually.

### Fixed

- Typing in a filter value field no longer loses focus after every keystroke.
- The filter value suggestions dropdown could overflow past the window edges for long values, and would close unexpectedly when scrolled or clicked.
- The screenshot overlay is now always-on-top, so it reliably appears above other topmost windows and fullscreen apps/games.

## [0.1.0] - 2026-07-17

- Initial release
