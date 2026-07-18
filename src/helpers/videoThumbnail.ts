import { saveVideoThumbnail } from "./saveVideoThumbnail";

// Videos above this size never mount a <video> card while their thumbnail is
// missing , they show a placeholder until lazy generation finishes. Also the
// cutoff for which imported videos are worth proactively backfilling a
// thumbnail for after a bulk import (small ones already preview fine as a
// <video> fallback).
export const LARGE_VIDEO_BYTES = 30 * 1024 * 1024;

const GENERATE_THUMBNAIL_TIMEOUT_MS = 15_000;
const inflightThumbnails = new Set<string>();

// Recordings get a thumbnail at save time; this lazily (or proactively, for a
// bulk import backfill) covers videos that don't have one yet.
export async function generateVideoThumbnail(fileName: string): Promise<boolean> {
  if (inflightThumbnails.has(fileName)) return false;
  inflightThumbnails.add(fileName);
  try {
    return await captureVideoFrame(fileName);
  } finally {
    inflightThumbnails.delete(fileName);
  }
}

function captureVideoFrame(fileName: string): Promise<boolean> {
  return new Promise(resolve => {
    const video = document.createElement("video");
    let done = false;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timeout);
      video.removeAttribute("src");
      video.load();
      resolve(ok);
    };

    const timeout = window.setTimeout(() => finish(false), GENERATE_THUMBNAIL_TIMEOUT_MS);

    video.muted = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    video.addEventListener("error", () => finish(false), { once: true });
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(0.1, (video.duration || 0) / 2);
    }, { once: true });
    video.addEventListener("seeked", () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return finish(false);

      const scale = Math.min(1, 480 / width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));

      const context = canvas.getContext("2d");
      if (!context) return finish(false);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(async blob => {
        if (!blob) return finish(false);
        try {
          await saveVideoThumbnail(fileName, blob);
          finish(true);
        } catch (error) {
          console.error("Failed to save the video thumbnail", error);
          finish(false);
        }
      }, "image/webp", 1);
    }, { once: true });

    video.src = `http://rosemyne-photo.localhost/saved/${fileName}`;
  });
}
