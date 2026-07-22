import { Dimensions, DimensionsWithOrder, WindowInfo } from "../types/screenshot";
import { Position } from '../types';

export function isNotNullish<T>(val: T | null | undefined): val is T {
  return val !== null && val !== undefined;
}

export function generateRandomId() {
  const ids = new Uint32Array(1);
  window.crypto.getRandomValues(ids);
  return ids[0];
}

export function dimensionToStyle(dims: Dimensions) {
  return {
    left: dims.x.toString() + "px", top: dims.y.toString() + "px",
    width: dims.width.toString() + "px", height: dims.height.toString() + "px"
  }
}

export function titleCase(str: string) {
  return str[0].toUpperCase() + str.slice(1).toLowerCase();
}

const CAMEL_CASE_REGEX = /(?<word>([A-Z]|[a-z])[^A-Z]*)/g;
export function beautifyCamelOrPascalCase(string: string): string {
  const words: string[] = [];

  for (const match of string.matchAll(CAMEL_CASE_REGEX)) {
    if (match.groups?.word) words.push(titleCase(match.groups?.word));
  }

  return words.join(" ");
}

export function partialObjectUpdate<T>(original: T, updated: Partial<T>): T {
  for (const [key, value] of Object.entries(updated)) {
    if (typeof value === "object" && !Array.isArray(value))
      original[key as keyof T] = value as any;
  }

  return original;
}

export function getIntersection(base: Dimensions, other: Dimensions): Dimensions | null {
  const x1 = Math.max(base.x, other.x);
  const y1 = Math.max(base.y, other.y);
  const x2 = Math.min(base.x + base.width, other.x + other.width);
  const y2 = Math.min(base.y + base.height, other.y + other.height);

  const width = x2 - x1;
  const height = y2 - y1;

  return width > 0 && height > 0 ? { x: x1, y: y1, width, height } : null;
}

export function effectIntensity(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function hexColorOpacity(color: string): number {
  if (color.length !== 9) return 1;

  const hexOpacity = color.slice(7);
  return parseInt(hexOpacity, 16) / 255;
}

export function cropCanvasData(data: Uint8ClampedArray, dataWidth: number, cropDims: Dimensions): Uint8ClampedArray {
  const { x, y, width, height } = cropDims;

  const croppedArray = new Uint8ClampedArray(width * height * 4);
  let resultIndex = 0;

  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) {
      const index = (row * dataWidth + col) * 4;

      croppedArray[resultIndex++] = data[index];     // Red
      croppedArray[resultIndex++] = data[index + 1]; // Green
      croppedArray[resultIndex++] = data[index + 2]; // Blue
      croppedArray[resultIndex++] = data[index + 3]; // Alpha
    }
  }

  return croppedArray;
}

export function getDimensionFromPoints<T extends Dimensions | { dimensions: Dimensions }>(point: Position, dims: Iterable<T>): Dimensions | null {
  for (const dimObj of dims) {
    const dimensions = "dimensions" in dimObj ? dimObj.dimensions : dimObj as Dimensions;

    if (
      point.x >= dimensions.x && point.x <= dimensions.x + dimensions.width &&
      point.y >= dimensions.y && point.y <= dimensions.y + dimensions.height
    ) {
      return dimensions;
    }
  }

  return null;
}

function squaredDistanceToBox(point: Position, box: Dimensions): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return dx * dx + dy * dy;
}

// Prefers the topmost box the point is actually inside; falls back to the nearest box otherwise.
export function findClosestWindowAtPoint(windows: Iterable<WindowInfo>, point: Position): { window: WindowInfo, box: DimensionsWithOrder } | null {
  const candidates = Array.from(windows).flatMap(window =>
    [window.dimensions, ...window.subDimensions].map(box => ({ window, box }))
  );
  if (candidates.length === 0) return null;

  const containing = candidates.filter(({ box }) => squaredDistanceToBox(point, box) === 0);
  if (containing.length > 0) {
    return containing.reduce((topmost, current) => current.box.zOrder > topmost.box.zOrder ? current : topmost);
  }

  return candidates.reduce((closest, current) =>
    squaredDistanceToBox(point, current.box) < squaredDistanceToBox(point, closest.box) ? current : closest
  );
}

export function* windowDimsIter(windows: Iterable<WindowInfo>) {
  for (const window of windows) {
    for (const subDims of window.subDimensions) {
      yield subDims;
    }

    yield window.dimensions;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// `<input type="datetime-local">` reads/writes local wall-clock time as a
// plain (timezone-less) string; `Date`'s local getters/constructor do the ms conversion.
export function msToDateTimeLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function dateTimeLocalToMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  const promise = new Promise<HTMLImageElement>((res) => image.addEventListener("load", () => res(image)));
  image.crossOrigin = "Anonymous";
  image.src = url;
  return promise;
}

export function flipObject<T extends { [key: string | number]: string | number }>(obj: T): { [K in keyof T as T[K]]: K } {
  return Object.entries(obj).reduce((prev, [key, value]) => {
    //@ts-expect-error
    prev[value] = key == +key ? +key : key;

    return prev;
  }, {} as { [K in keyof T as T[K]]: K })
}