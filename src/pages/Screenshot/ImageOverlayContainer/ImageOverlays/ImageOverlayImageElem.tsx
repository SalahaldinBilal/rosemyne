import { createEffect, createMemo, onCleanup } from "solid-js";
import { ImageImageOverlay, ImageOverlayProps } from "../../../../types/imageOverlay";
import ImageOverlayBase from "../ImageOverlayBase/ImageOverlayBase";
import { useAnnotationState } from "../../../../states/annotationContext";
import useOverlayImagesState from "../../../../states/overlayImagesState";

function ImageOverlayImageElem(props: ImageOverlayProps<ImageImageOverlay>) {
  const { image, effectLayers, bumpLayerVersion, removeEffectLayer } = useAnnotationState();
  const { bitmapFor, bitmapVersions } = useOverlayImagesState;
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

  const source = createMemo(() => {
    const name = props.item.attributes.image.value;
    bitmapVersions[name];
    return bitmapFor(name);
  });

  const opacity = createMemo(() => Math.min(Math.max(props.item.attributes.opacity.value, 0), 100) / 100);

  createEffect(() => {
    const currentRegion = region();
    const bitmap = source();
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !currentRegion) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (bitmap) {
      ctx.globalAlpha = opacity();
      ctx.drawImage(
        bitmap,
        Math.round(props.item.dimensions.x) - currentRegion.left,
        Math.round(props.item.dimensions.y) - currentRegion.top,
        Math.round(props.item.dimensions.width),
        Math.round(props.item.dimensions.height),
      );
      ctx.globalAlpha = 1;
    }

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

export default ImageOverlayImageElem;
