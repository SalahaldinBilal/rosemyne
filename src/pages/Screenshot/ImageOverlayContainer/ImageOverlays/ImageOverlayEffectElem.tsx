import { createEffect, createMemo, onCleanup } from "solid-js";
import { BlurImageOverlay, ImageOverlayProps, PixelateImageOverlay } from "../../../../types/imageOverlay";
import ImageOverlayBase from "../ImageOverlayBase/ImageOverlayBase";
import useScreenshotOverlayStateInner from "../../../../states/screenshotOverlayState";
import { applyEffectRegion, composeScratchContext, drawOverlayOnto, effectMargin } from "../../../../helpers/canvasRenderer";

/**
 * Fully client-side: composes its region + margin from the capture and every
 * overlay below it (boxes/text redrawn vectorially, lower effects blitted from
 * their canvases), applies its own kernel, and registers the result so effects
 * above can composite it , all region-sized, GPU-backed draws, zero IPC.
 */
function ImageOverlayEffectElem(props: ImageOverlayProps<BlurImageOverlay | PixelateImageOverlay>) {
  const { image, overlayItems, effectLayers, layerVersions, bumpLayerVersion, removeEffectLayer } = useScreenshotOverlayStateInner;
  let canvas: HTMLCanvasElement | undefined;

  const region = createMemo(() => {
    const base = image();
    if (!base) return null;

    const dims = props.item.dimensions;
    const left = Math.max(Math.round(dims.x), 0);
    const top = Math.max(Math.round(dims.y), 0);
    const right = Math.min(Math.round(dims.x + dims.width), base.naturalWidth);
    const bottom = Math.min(Math.round(dims.y + dims.height), base.naturalHeight);

    if (right - left < 1 || bottom - top < 1) return null;
    return { left, top, width: right - left, height: bottom - top };
  });

  createEffect(() => {
    const base = image();
    const currentRegion = region();
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !base || !currentRegion) return;

    const below = overlayItems.filter(other => other.order < props.item.order);

    // Subscribe to lower effect/draw layers re-rendering; box/text changes are
    // tracked through the attribute reads inside the draw calls below.
    for (const other of below) {
      if (other.type === "blur" || other.type === "pixelate" || other.type === "draw") layerVersions[other.order];
    }

    const margin = effectMargin(props.item);
    const sceneLeft = Math.max(currentRegion.left - margin, 0);
    const sceneTop = Math.max(currentRegion.top - margin, 0);
    const sceneWidth = Math.min(currentRegion.left + currentRegion.width + margin, base.naturalWidth) - sceneLeft;
    const sceneHeight = Math.min(currentRegion.top + currentRegion.height + margin, base.naturalHeight) - sceneTop;

    const scene = composeScratchContext(sceneWidth, sceneHeight);
    scene.drawImage(base, sceneLeft, sceneTop, sceneWidth, sceneHeight, 0, 0, sceneWidth, sceneHeight);

    for (const other of below) {
      drawOverlayOnto(scene, other, sceneLeft, sceneTop, effectLayers);
    }

    applyEffectRegion(scene, sceneLeft, sceneTop, props.item);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      scene.canvas,
      currentRegion.left - sceneLeft, currentRegion.top - sceneTop, currentRegion.width, currentRegion.height,
      0, 0, currentRegion.width, currentRegion.height,
    );

    // Drag clones must not shadow the original's layer under the same order.
    if (!props.beingDragged) {
      effectLayers.set(props.item.order, canvas);
      bumpLayerVersion(props.item.order);
    }
  });

  onCleanup(() => {
    if (!props.beingDragged) removeEffectLayer(props.item.order);
  });

  return <ImageOverlayBase {...props}>
    <canvas
      ref={canvas}
      width={region()?.width ?? 0}
      height={region()?.height ?? 0}
      style={{
        position: "absolute",
        left: `${(region()?.left ?? 0) - Math.round(props.item.dimensions.x)}px`,
        top: `${(region()?.top ?? 0) - Math.round(props.item.dimensions.y)}px`,
      }}
    />
  </ImageOverlayBase>;
}

export default ImageOverlayEffectElem;
