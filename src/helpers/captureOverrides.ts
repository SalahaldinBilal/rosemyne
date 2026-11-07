import { CaptureOverrides, ShortcutMethod } from "@core/types";

export type OverrideKey = keyof CaptureOverrides;

export function emptyOverrides(): CaptureOverrides {
  return {
    copyToClipboard: null,
    showCapturePreview: null,
    captureSound: null,
    uploadSound: null,
    upload: null,
    fileNameTemplate: null,
    savePathTemplate: null,
    screenshotFormat: null,
    includeCursor: null,
    recordAudio: null,
    recordFps: null,
    recordCodec: null,
    scrollMaxFrames: null,
    scrollFrameDelayMs: null,
    scrollDistance: null,
  };
}

const SAVED_FILE_KEYS: readonly OverrideKey[] = ["copyToClipboard", "showCapturePreview", "uploadSound", "upload", "savePathTemplate", "fileNameTemplate"];

// Recordings and scrolling captures don't play the capture sound.
export const OVERRIDE_KEYS: Record<ShortcutMethod["type"], readonly OverrideKey[]> = {
  screenshot: [...SAVED_FILE_KEYS, "captureSound", "screenshotFormat", "includeCursor"],
  instantCapture: [...SAVED_FILE_KEYS, "captureSound", "screenshotFormat"],
  record: [...SAVED_FILE_KEYS, "recordAudio", "recordFps", "recordCodec"],
  scrollingCapture: [...SAVED_FILE_KEYS, "screenshotFormat", "scrollFrameDelayMs", "scrollDistance", "scrollMaxFrames"],
};

export function keepOverrides(overrides: CaptureOverrides, keys: readonly OverrideKey[]): CaptureOverrides {
  const kept = emptyOverrides();
  for (const key of keys) Object.assign(kept, { [key]: overrides[key] });
  return kept;
}

export function overrideCount(overrides: CaptureOverrides | undefined): number {
  if (!overrides) return 0;
  return Object.values(overrides).filter(value => value !== null && value !== undefined).length;
}
