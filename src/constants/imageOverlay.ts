import { flipObject } from "../helpers";
import { Tools } from "../types";
import { ImageOverlay } from "../types/imageOverlay";

export const TEXT_FONT_OPTIONS: string[] = ["serif", "sans-serif", "monospace", "cursive"];

// Mirrors CURSOR_IMAGE_NAME in overlay_images/mod.rs (Rust rejects it as a user image name).
// The live cursor is only meaningful for a capture, so it's placed automatically
// rather than offered as a choice; hence a real scheme cursor as the default.
export const CURSOR_IMAGE_NAME = "Cursor";
export const DEFAULT_OVERLAY_IMAGE_NAME = "Arrow";

export const OVERLAY_DEFAULT_ATTRIBUTES: { [Type in ImageOverlay["type"]]: Extract<ImageOverlay, { type: Type }>["attributes"] } = {
  box: {
    color: { type: "color", value: "#ff000000" },
    borderColor: { type: "color", value: "#ff0000" },
    borderThickness: { type: "number", value: 1 },
  },
  text: {
    color: { type: "color", value: "#ff0000" },
    text: { type: "string", value: "Hello World" },
    size: { type: "number", value: 24 },
    font: { type: "select", value: "serif", options: TEXT_FONT_OPTIONS },
  },
  blur: {
    intensity: { type: "number", value: 5 },
  },
  pixelate: {
    intensity: { type: "number", value: 5 },
  },
  image: {
    image: { type: "select", value: DEFAULT_OVERLAY_IMAGE_NAME, options: [DEFAULT_OVERLAY_IMAGE_NAME] },
    opacity: { type: "number", value: 100, min: 0, max: 100 },
  },
  draw: {},
  arrow: {
    color: { type: "color", value: "#ff0000" },
    thickness: { type: "number", value: 5, min: 1 },
    headSize: { type: "number", value: 30, min: 1 },
  },
  line: {
    color: { type: "color", value: "#ff0000" },
    thickness: { type: "number", value: 5, min: 1 },
  },
};

export const TOOL_TO_OVERLAY = {
  [Tools.BoxOverlay]: "box",
  [Tools.TextOverlay]: "text",
  [Tools.BlurOverlay]: "blur",
  [Tools.PixelateOverly]: "pixelate",
  [Tools.ImageOverlay]: "image",
  [Tools.ArrowOverlay]: "arrow",
  [Tools.LineOverlay]: "line",
} as const;

export const OVERLAY_TO_TOOL = flipObject(TOOL_TO_OVERLAY);

export const OVERLAY_TOOLS: Array<keyof typeof TOOL_TO_OVERLAY> = Object.keys(TOOL_TO_OVERLAY).map(e => +e);