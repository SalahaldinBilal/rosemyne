import type { clickOutside } from '../directives';
import { Dimensions } from './screenshot';

export * from './componentProps'
export * from './screenshot'
export * from './request'

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      draggable?: boolean;
      clickOutside?: ReturnType<Parameters<typeof clickOutside>[1]>;
    }
  }
}

export enum ResizeDirection {
  TopLeft,
  Top,
  TopRight,
  Left,
  Right,
  BottomLeft,
  Bottom,
  BottomRight,
}

export type Position = Pick<Dimensions, 'x' | 'y'>;
export type Size = Pick<Dimensions, 'width' | 'height'>;

export enum Tools {
  Screenshot,
  Move,
  BoxOverlay,
  TextOverlay,
  BlurOverlay,
  PixelateOverly,
  DrawOverlay,
  EraseOverlay
}


export type ShortcutKey = {
  key: string,
  char: string,
}

export type ShortcutKeys = {
  keys: Array<ShortcutKey>,
}

export type ShortcutBinding = {
  id: string,
  method: ShortcutMethod,
  keys: ShortcutKeys,
}

export type CaptureTarget =
  | { type: "monitor", data: { id: string } }
  | { type: "region", data: { x: number, y: number, width: number, height: number } };

export type ShortcutMethod =
  | { type: "screenshot" }
  | { type: "instantCapture", data: CaptureTarget }
  | { type: "record" };

export type MonitorInfo = {
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
}

export type VideoCodec = "h264" | "h265";

export type ScreenshotImageFormat =
  | "png" | "webp" | "jpeg" | "gif" | "bmp" | "ico" | "tiff" | "tga"
  | "pnm" | "avif" | "qoi" | "hdr" | "openExr" | "farbfeld";

export type GeneralSettings = {
  saveDirectory: string | null,
  uploadPath: string | null,
  fileNameTemplate: string | null,
  copyToClipboardOnCapture: boolean,
  autostart: boolean,
  recordAudio: boolean,
  recordFps: number,
  recordCodec: VideoCodec,
  screenshotFormat: ScreenshotImageFormat,
  hasCompletedOnboarding: boolean,
  checkForUpdatesOnStartup: boolean,
}

// Windows' own custom-format-picture token syntax (`yyyy`, `MM`, `dd`, `HH`,
// `mm`, `tt`, ...); Linux's strftime pictures get translated into the same
// syntax Rust-side, so this is the one shape the frontend ever has to parse.
export type DateTimePatterns = {
  shortDate: string,
  time: string,
}

export type SoundKind = "capture" | "taskSuccess";

export type SoundSetting = {
  enabled: boolean,
  customFile: string | null,
  volume: number,
}

export type SoundSettings = {
  capture: SoundSetting,
  taskSuccess: SoundSetting,
}

export type MigrationSummary = {
  imported: number,
  skippedNonImage: number,
  missingFile: number,
  errors: number,
  total: number,
  dryRun: boolean,
}

export type MigrationProgress = {
  current: number,
  total: number,
  currentFile: string,
}

export type RgbaColor = {
  red: number,
  green: number,
  blue: number,
  alpha: number,
}