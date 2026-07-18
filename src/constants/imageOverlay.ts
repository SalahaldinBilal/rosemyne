import { flipObject } from "../helpers";
import { Tools } from "../types";
import { ImageOverlay } from "../types/imageOverlay";

export const TEXT_FONT_OPTIONS: string[] = ["serif", "sans-serif", "monospace", "cursive"];

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
  draw: {},
};

export const TOOL_TO_OVERLAY = {
  [Tools.BoxOverlay]: "box",
  [Tools.TextOverlay]: "text",
  [Tools.BlurOverlay]: "blur",
  [Tools.PixelateOverly]: "pixelate",
} as const;

export const OVERLAY_TO_TOOL = flipObject(TOOL_TO_OVERLAY);

export const OVERLAY_TOOLS: Array<keyof typeof TOOL_TO_OVERLAY> = Object.keys(TOOL_TO_OVERLAY).map(e => +e);