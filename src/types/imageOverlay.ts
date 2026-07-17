import { SetStoreFunction } from "solid-js/store"
import { Dimensions } from "./screenshot"
import { JSX } from "solid-js"

export type ImageOverlayBase<Type extends string, Attributes extends ImageOverlayAttributeMap> = {
  dimensions: Dimensions,
  attributes: ExpandRecursively<DeepWriteable<SpecifiedAttributeMap<Attributes>>>,
  order: number
  type: Type,
}

export type ImageOverlayAttributeBase<Type extends string, Value> = { type: Type, value: Value }

export type ImageOverlayStringAttribute = ImageOverlayAttributeBase<"string", string>
export type ImageOverlayColorAttribute = ImageOverlayAttributeBase<"color", `#${string}`>

export type ImageOverlayNumberAttribute = ImageOverlayAttributeBase<"number", number> & {
  min?: number,
  max?: number
}

export type ImageOverlaySelectAttribute = ImageOverlayAttributeBase<"select", string> & {
  options: ReadonlyArray<string>
}

export type ImageOverlayAttribute = ImageOverlayStringAttribute | ImageOverlayNumberAttribute | ImageOverlayColorAttribute | ImageOverlaySelectAttribute;
export type ImageOverlayAttributeMap = Record<string, ImageOverlayAttribute>;


export type AttributeArrayToMapOld<T extends ImageOverlayAttributeMap> = {
  [Key in keyof T]: Merge<T[Key], { value: Extract<ImageOverlayAttribute, { type: T[Key]["type"] }>["value"] }>
};

export type SpecifiedAttributeMap<T extends ImageOverlayAttributeMap> = {
  [Key in keyof T]: Extract<ImageOverlayAttribute, { type: T[Key]["type"] }>
};

export type BoxImageOverlay = ImageOverlayBase<"box", {
  "color": { type: "color", value: `#000000` },
  "borderColor": { type: "color", value: `#FFFFFF` },
  "borderThickness": { type: "number", value: 5, min: 0 },
}>;

export type TextImageOverlay = ImageOverlayBase<"text", {
  "text": { type: "string", value: `Hello World` },
  "color": { type: "color", value: `#000000` },
  "size": { type: "number", value: 24, min: 0 },
  "font": { type: "select", value: "serif", options: ["serif", "sans-serif", "monospace", "cursive"] },
}>;

export type BlurImageOverlay = ImageOverlayBase<"blur", {
  "intensity": { type: "number", value: 24, min: 0 },
}>;

export type PixelateImageOverlay = ImageOverlayBase<"pixelate", {
  "intensity": { type: "number", value: 24, min: 0 },
}>;

// Freehand strokes painted straight onto a persistent full-capture layer , see
// DrawLayer.tsx. Unlike every other overlay type it has no meaningful editable
// box: `dimensions` always covers the whole capture and `attributes` is empty,
// since brush color/size are global tool settings, not per-item.
export type DrawImageOverlay = ImageOverlayBase<"draw", {}>;

export type ImageOverlay = BoxImageOverlay | TextImageOverlay | BlurImageOverlay | PixelateImageOverlay | DrawImageOverlay;

export type ImageOverlayElem = (props: { item: ImageOverlay, onChange: SetStoreFunction<ImageOverlay> }) => JSX.Element;
export type ImageOverlayProps<T extends ImageOverlay> = { index: number, item: T, beingDragged?: boolean, renderOrder?: number };