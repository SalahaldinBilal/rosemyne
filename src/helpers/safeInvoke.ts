import { CapturePreviewSettings, CursorImageInfo, DateTimePatterns, Dimensions, FilterGroup, GeneralSettings, HistoryCursor, HistoryPage, HistorySort, ImageEditSession, ImageHistoryData, MigrationSummary, MonitorInfo, OverlayDefaultOverrides, OverlayImage, RecordingStatus, RestitchResult, SavedFilter, ScrollCaptureOverrides, ScrollCaptureSession, ScrollingCaptureSettings, ShortcutBinding, SoundKind, SoundSetting, SoundSettings, StitchParams, SystemCursorInfo, TagMetadata, TagValue, TagValueSuggestion, VideoCodec } from "@core/types";
import { SavedUploader, UploaderOptions, UploaderValidation, UploadResult } from "@core/types/request";
import { invoke, InvokeOptions } from "@tauri-apps/api/core";

export async function safeInvoke<T extends keyof Commands>(cmd: T, ...[args, options]: SafeInvokeArgs<Commands[T]["parameters"]>): Promise<Commands[T]["return"]> {
  return await invoke(cmd, args, options);
}

type SafeInvokeArgs<T> =
  undefined extends T ? [args?: T, options?: InvokeOptions] : [args: T, options?: InvokeOptions];

type Command<P extends object | undefined = undefined, R = undefined> = { parameters: P, return: R }

type Commands = {
  'full_screenshot': Command,
  'add_shortcut': Command<{ newShortcut: ShortcutBinding }>,
  'remove_shortcut': Command<{ id: string }>,
  'get_shortcuts': Command<undefined, Array<ShortcutBinding>>,
  'list_monitors': Command<undefined, Array<MonitorInfo>>,
  'start_region_pick': Command,
  'finish_region_pick': Command<{ region: { x: number, y: number, width: number, height: number } | null }>,
  'hide_screenshot_window': Command<{ id?: number } | undefined>,
  'record_screen': Command,
  'start_recording': Command<{ region: Dimensions, id?: number, withAudio?: boolean }, RecordingStatus>,
  'stop_recording': Command,
  'cancel_recording': Command,
  'get_recording_status': Command<undefined, RecordingStatus | null>,
  'get_available_video_codecs': Command<undefined, VideoCodec[]>,
  'scrolling_capture_screen': Command,
  'start_scrolling_capture': Command<{ region: Dimensions, id?: number, overrides: ScrollCaptureOverrides }>,
  'stop_scrolling_capture': Command,
  'cancel_scrolling_capture': Command,
  'get_scrolling_capture_settings': Command<undefined, ScrollingCaptureSettings>,
  'set_scrolling_capture_settings': Command<{ scrollingCapture: ScrollingCaptureSettings }>,
  'get_scroll_capture_session': Command<undefined, ScrollCaptureSession | null>,
  'restitch_scroll_capture': Command<{ sessionId: number, params: StitchParams, excludedFrames: number[] }, RestitchResult>,
  'cancel_scroll_capture_review': Command<{ sessionId: number }>,
  'finish_scroll_capture_review': Command<{ sessionId: number }>,
  'query_history': Command<{ filter: FilterGroup, sort: HistorySort, cursor: HistoryCursor | null, limit: number }, HistoryPage>,
  'get_tag_metadata': Command<undefined, TagMetadata>,
  'get_saved_filters': Command<undefined, SavedFilter[]>,
  'save_filter': Command<{ name: string, filter: FilterGroup }>,
  'delete_saved_filter': Command<{ name: string }>,
  'get_drag_icon': Command<{ fileName: string }, string | null>,
  'list_videos_missing_thumbnail': Command<{ minSizeBytes: number }, string[]>,
  'suggest_tag_values': Command<{ path: string[], query: string }, TagValueSuggestion[]>,
  'update_history_tags': Command<{ fileName: string, tags: { [key: string]: TagValue } | null }, ImageHistoryData>,
  'import_file': Command<{ path: string }, ImageHistoryData | null>,
  'delete_screenshot': Command<{ fileName: string }>,
  'begin_image_edit': Command<{ fileName: string }, ImageEditSession>,
  'cancel_image_edit': Command<{ imageId: number }>,
  'copy_screenshot_to_clipboard': Command<{ fileName: string }>,
  'copy_file_to_clipboard': Command<{ fileName: string }>,
  'copy_text_to_clipboard': Command<{ text: string }>,
  'show_in_folder': Command<{ fileName: string }>,
  'open_file': Command<{ fileName: string }>,
  'move_mouse_by': Command<{ x?: number, y?: number }>,
  'get_system_datetime_patterns': Command<undefined, DateTimePatterns | null>,
  'was_launched_via_autostart': Command<undefined, boolean>,
  'fetch_changelog': Command<undefined, string>,
  'is_uploader_valid': Command<{ uploader: UploaderOptions }, UploaderValidation>,
  'upload_image': Command<{ fileName: string, uploaderId?: string }, UploadResult>,
  'test_uploader': Command<{ uploader: UploaderOptions }, UploadResult>,
  'get_uploaders': Command<undefined, Array<SavedUploader>>,
  'save_uploader': Command<{ uploader: SavedUploader }>,
  'delete_uploader': Command<{ id: string }>,
  'get_default_uploader': Command<undefined, string | null>,
  'set_default_uploader': Command<{ id: string | null }>,
  'get_general_settings': Command<undefined, GeneralSettings>,
  'set_general_settings': Command<{ general: GeneralSettings }>,
  'get_overlay_defaults': Command<undefined, OverlayDefaultOverrides>,
  'set_overlay_defaults': Command<{ overlayDefaults: OverlayDefaultOverrides }>,
  'get_overlay_images': Command<undefined, OverlayImage[]>,
  'add_overlay_image': Command<{ path: string }, OverlayImage>,
  'remove_overlay_image': Command<{ name: string }>,
  'rename_overlay_image': Command<{ name: string, newName: string }, OverlayImage>,
  'get_cursor_image': Command<undefined, CursorImageInfo | null>,
  'get_system_cursors': Command<undefined, SystemCursorInfo[]>,
  'get_capture_preview_settings': Command<undefined, CapturePreviewSettings>,
  'set_capture_preview_settings': Command<{ capturePreview: CapturePreviewSettings }>,
  'show_capture_preview_window': Command<{ width: number, height: number }>,
  'hide_capture_preview_window': Command,
  'migrate_from_sharex': Command<{ sharexPath: string, dryRun: boolean }, MigrationSummary>,
  'get_sound_settings': Command<undefined, SoundSettings>,
  'set_sound_enabled': Command<{ kind: SoundKind, enabled: boolean }>,
  'set_instant_capture_sound_enabled': Command<{ kind: SoundKind, enabled: boolean }>,
  'set_sound_volume': Command<{ kind: SoundKind, volume: number }>,
  'set_custom_sound': Command<{ kind: SoundKind, path: string }, SoundSetting>,
  'reset_custom_sound': Command<{ kind: SoundKind }, SoundSetting>,
  'preview_sound': Command<{ kind: SoundKind }>,
};

// `hide_and_save_screenshot` is intentionally absent: it takes a raw binary
// body, which this JSON-typed wrapper can't express, see helpers/saveScreenshot.ts.
