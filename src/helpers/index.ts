import { Dimensions, WindowInfo } from "../types/screenshot";
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

export function* windowDimsIter(windows: Iterable<WindowInfo>) {
  for (const window of windows) {
    for (const subDims of window.subDimensions) {
      yield subDims;
    }

    yield window.dimensions;
  }
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