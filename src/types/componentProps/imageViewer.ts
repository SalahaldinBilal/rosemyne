import { JSX } from "solid-js";
import { Position } from "../index";
import { RenderedImage } from "../../helpers/canvasRenderer";

export type ImageViewerApi = {
  toImageCoords: (clientX: number, clientY: number) => Position;
  // For a raw screen-pixel delta (e.g. a drag library's own pointer
  // tracking), not an absolute point: divides out scale, no origin to subtract.
  toImageDelta: (dx: number, dy: number) => Position;
  // Only present when `editable` is set. Renders the current annotation state
  // (or, with `withAnnotations` false, just the plain image) to a final image
  // ready to hand to `saveScreenshot`.
  renderFinal?: (withAnnotations: boolean) => RenderedImage | null;
  // Only present when `editable` is set. Clears drawn overlays/selection/tool state.
  resetEditing?: () => void;
}

export type ImageViewerProps = {
  src: string;
  // Rendered inside the same pan/scale transform as the image itself, sized
  // to the image's natural dimensions, so overlay content built in native
  // image-space pixels (annotations, a crop box, ...) aligns with it exactly.
  overlay?: JSX.Element;
  // Hides rotate controls and keeps rotation at 0, an `overlay`'s coordinate
  // math only accounts for pan/scale, not rotation.
  hideRotate?: boolean;
  // When false, a primary(left)-button drag doesn't pan, some interactive
  // `overlay` content wants that gesture instead (e.g. drawing a box).
  // Middle-button drag still pans regardless. Defaults to true.
  allowPrimaryPan?: boolean;
  // Fired once, when the viewer's pan/zoom-aware coordinate conversion is
  // ready to use.
  onApi?: (api: ImageViewerApi) => void;
  // Stable for this instance's lifetime, read once at setup, not reactive:
  // whether this viewer creates and owns an AnnotationState at all.
  editable?: boolean;
  // Reactive: whether the edit chrome (toolbar + overlay stack) is shown
  // right now. Kept independent of `editable` so toggling it never tears
  // down or recreates the underlying annotation state.
  annotating?: boolean;
  // Forwarded to AnnotationToolBar's hint.
  annotationHint?: string;
}
