# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.6] - 2026-08-17

### Changed

- Saving an annotated capture no longer freezes while the final image is composited. The render now runs in a background worker, so the overlay closes right away and the save finishes behind it; if the worker can't start, it falls back to rendering in the page as before.
- Placing a blur or pixelate overlay no longer gets slower the more of them are already on the capture. Each one now re-renders only when something actually underneath it changes, instead of every time an overlay is placed anywhere.

### Fixed

- The annotation toolbox could end up behind placed overlays, so after a few items were added they drew over the toolbar. It now always stays on top, and a selected item's resize handles no longer cover menus or toasts either.
- Triggering a capture twice in quick succession (a double-pressed shortcut, or a double-clicked button) started two captures at once. A second trigger within 150ms of the first is now ignored.
- Saving a capture before its preview had finished loading silently discarded the screenshot. It now waits for the preview, and reports an error if it never loads.
- A save that completed after a new capture had already begun could tear down the new capture's overlay.

## [0.2.5] - 2026-08-14

### Added

- **Undo/redo while annotating**: every editing action (placing, moving, resizing and deleting overlays, attribute edits, draw/erase strokes, clearing the drawing) now goes into one shared history that Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) and new Undo/Redo toolbar buttons step through. Works in the capture overlay, saved-image editing and the scrolling-capture review alike.
- **Image overlay tool**: stamp images onto a capture, with adjustable opacity. Images come from a new persistent library under Settings → Overlay Defaults (added images are copied as WebP, so moving or deleting the original file doesn't break them), and the toolbar can also pick a one-off image just for the current capture.
- **Line and Arrow tools** for annotating, with configurable color, thickness and arrow head size; their starting values are customizable under Settings → Overlay Defaults like the other tools.
- Settings → General has a new "Include the mouse cursor in screenshots" option. The cursor is placed on the capture as a regular image overlay, so it can still be moved, resized or removed before saving. Settings → Overlay Defaults picks what gets placed: the cursor exactly as it looked at capture time, or a fixed choice from the system's installed cursors.

### Changed

- Double-clicking a placed overlay now opens its settings menu, same as right-clicking it.
- Resize handles now shrink on small overlay items instead of overlapping each other, so tiny items like a placed cursor stay resizable.

## [0.2.4] - 2026-08-10

### Added

- The history toolbar now shows how many images, videos and files are in the listing, reflecting the active filter when one is applied.
- Settings → General has a new "Minimum selection size" option (default 15 × 15): a region drag smaller than that on either axis is treated as a click and captures the window under the cursor instead, so a slight wobble while clicking no longer loses the window. Set it to 0 to always keep the drawn region.

### Changed

- Editing a saved image no longer opens with a crop selection drawn around the whole image; the crop box and its handles only appear once the Crop tool has been used to drag one out. Saving without cropping still keeps the full image.

## [0.2.3] - 2026-08-04

### Added

- Text filter conditions now have a case-sensitivity toggle next to the operation picker. It applies to every text field, tag values as well as File Name, Path and Type, and to every text operation: equals, contains, starts/ends with and fuzzy.

### Changed

- Text filters now match case-insensitively by default, so searching `chrome` finds `Chrome`. Matching is Unicode-aware, `ÉCOLE` matches `école` and `ПРИВЕТ` matches `привет`, not just plain ASCII. Filters saved before this update load as case-insensitive; switch the new toggle on and save again to get exact-case matching back.
- The filter panel's dropdowns and value fields now blend into the background like the sorting dropdown, instead of each sitting in its own outlined box.

## [0.2.2] - 2026-08-03

### Added

- Settings → Sounds has a new per-sound "Play for instant captures" option, so instant-capture shortcuts (and the auto-upload that follows them) can stay silent while normal captures keep playing their sound. (thanks @iAverages)

### Fixed

- Taking a screenshot while a fullscreen game had the cursor confined to its own window left the pointer trapped in that area, making the region selector unusable. The overlay now releases the lock while it's open; the game re-establishes it once it's focused again. (thanks @iAverages)

## [0.2.1] - 2026-08-02

### Added

- Filters can now be grouped: a group can be scoped to one element of an array tag (e.g. one window) at a time, so conditions like "the same window is both Firefox and covers more than half the screen" are expressible, instead of only matching across different elements independently.
- Filter trees can now be saved by name and reloaded from a new bar above the Filters panel.
- Settings → General has a new "Trim the window border when snapping" option: Windows 11 draws a 1px border blended with whatever is behind a window, so snap-to-window captures used to include a ring of the background. Now trimmed by default; can be turned off to keep the border.

### Changed

- Reworked the history filter UI: sorting and the filter toggle now sit in a compact toolbar above the list, and the filter panel itself is collapsed by default.
- Window snap-to-select no longer offers invisible windows that ignore interaction.

## [0.2.0] - 2026-07-24

### Added

- **Scrolling capture**: pick a region and Rosemyne scrolls it, capturing as it goes, then stitches the frames into one tall image. Available from the main window and as its own shortcut. It stops once scrolling stops changing the content, or early from the on-screen status bar.
- The stitched result opens for review before saving: re-stitch with different settings without recapturing, drop individual frames, then save directly or continue into the annotation tools.
- Settings → Scrolling Capture for frame delay, scroll amount and a maximum frame count, all also adjustable per capture from the region selector.
- **Editing saved images**: re-open any image from the history list in the annotation editor, via its right-click menu or the preview window. Always saved as a new image and uploaded as usual, leaving the original untouched.

### Changed

- Number inputs no longer silently snap back while you type an out-of-range value; the field is outlined in red with a message, and only reverts if you leave it without a valid one.
- Placing a box, text, blur or pixelate overlay now needs a small drag, so a plain click no longer leaves a near-invisible speck.

### Fixed

- Overlays could jump above or below each other while annotating. They now always stack in the order they were added, matching the saved image. An overlay buried under a larger one still surfaces its resize handles.
- File name templates no longer leave a dangling separator when a variable is empty: with the default `${process}_${random:10}`, a capture with no window information now produces `abc123` instead of `_abc123`.

## [0.1.7] - 2026-07-23

### Added

- The Updates settings page now has a "View full changelog" button to read every past release's notes, not just the pending update's.

### Fixed

- The tag editor now shows Duration and Date/Time tags (e.g. every screenshot's "Timestamp", every recording's "Duration") with proper duration/date-time pickers.

## [0.1.6] - 2026-07-22

### Added

- Screenshots, videos, and files in the history list now have an "Edit Tags" option in their right-click menu, letting you add, edit, or remove tags, including nested/structured ones, directly from the item. Newly added tags immediately become available in the filter panel.

### Changed

- Window snap-to-select in the screenshot overlay now tracks the cursor continuously, including the instant the overlay opens, and always highlights the nearest window instead of only updating when the cursor is directly over one.

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
