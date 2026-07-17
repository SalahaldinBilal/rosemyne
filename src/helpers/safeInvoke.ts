import { DateTimePatterns, Dimensions, FilterGroup, GeneralSettings, HistoryCursor, HistoryPage, HistorySort, ImageHistoryData, MigrationSummary, MonitorInfo, RecordingStatus, ShortcutBinding, SoundKind, SoundSetting, SoundSettings, TagMetadata, TagValueSuggestion, VideoCodec } from "@core/types";
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
  'query_history': Command<{ filter: FilterGroup, sort: HistorySort, cursor: HistoryCursor | null, limit: number }, HistoryPage>,
  'get_tag_metadata': Command<undefined, TagMetadata>,
  'suggest_tag_values': Command<{ path: string[], query: string }, TagValueSuggestion[]>,
  'import_file': Command<{ path: string }, ImageHistoryData>,
  'delete_screenshot': Command<{ fileName: string }>,
  'copy_screenshot_to_clipboard': Command<{ fileName: string }>,
  'copy_file_to_clipboard': Command<{ fileName: string }>,
  'copy_text_to_clipboard': Command<{ text: string }>,
  'show_in_folder': Command<{ fileName: string }>,
  'open_file': Command<{ fileName: string }>,
  'move_mouse_by': Command<{ x?: number, y?: number }>,
  'get_system_datetime_patterns': Command<undefined, DateTimePatterns | null>,
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
  'migrate_from_sharex': Command<{ sharexPath: string, dryRun: boolean }, MigrationSummary>,
  'get_sound_settings': Command<undefined, SoundSettings>,
  'set_sound_enabled': Command<{ kind: SoundKind, enabled: boolean }>,
  'set_sound_volume': Command<{ kind: SoundKind, volume: number }>,
  'set_custom_sound': Command<{ kind: SoundKind, path: string }, SoundSetting>,
  'reset_custom_sound': Command<{ kind: SoundKind }, SoundSetting>,
  'preview_sound': Command<{ kind: SoundKind }>,
};

// `hide_and_save_screenshot` is intentionally absent: it takes a raw binary
// body, which this JSON-typed wrapper can't express , see helpers/saveScreenshot.ts.
