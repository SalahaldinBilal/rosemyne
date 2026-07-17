import { createEffect } from "solid-js";
import { ImageOverlayProps, TextImageOverlay } from "../../../../types/imageOverlay";
import ImageOverlayBase from "../ImageOverlayBase/ImageOverlayBase";
import { drawTextOverlay } from "../../../../helpers/canvasRenderer";

function ImageOverlayTextElem(props: ImageOverlayProps<TextImageOverlay>) {
  let canvas: HTMLCanvasElement | undefined;

  createEffect(() => {
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTextOverlay(ctx, props.item, Math.round(props.item.dimensions.x), Math.round(props.item.dimensions.y));
  });

  return <ImageOverlayBase {...props}>
    <canvas
      ref={canvas}
      width={Math.max(0, Math.round(props.item.dimensions.width))}
      height={Math.max(0, Math.round(props.item.dimensions.height))}
    />
  </ImageOverlayBase>;
}

export default ImageOverlayTextElem;
