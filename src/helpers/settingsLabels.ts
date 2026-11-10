import { BitrateMode, ScreenshotImageFormat, VideoCodec } from "@core/types";

export const CODEC_LABELS: Record<VideoCodec, string> = {
  h264: "H.264",
  h265: "H.265 (HEVC)",
};

export const BITRATE_MODE_LABELS: Record<BitrateMode, string> = {
  variable: "Variable",
  constant: "Constant",
};

export const BITRATE_MODE_ITEMS = (Object.keys(BITRATE_MODE_LABELS) as BitrateMode[])
  .map(mode => ({ id: mode, value: mode, label: BITRATE_MODE_LABELS[mode] }));

export const SCREENSHOT_FORMAT_LABELS: Record<ScreenshotImageFormat, string> = {
  png: "PNG",
  webp: "WebP",
  jpeg: "JPEG",
  gif: "GIF",
  bmp: "BMP",
  ico: "ICO",
  tiff: "TIFF",
  tga: "TGA",
  pnm: "PNM (PPM)",
  avif: "AVIF",
  qoi: "QOI",
  hdr: "Radiance HDR",
  openExr: "OpenEXR",
  farbfeld: "Farbfeld",
};

export const SCREENSHOT_FORMATS = Object.keys(SCREENSHOT_FORMAT_LABELS) as ScreenshotImageFormat[];
