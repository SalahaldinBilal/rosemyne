import { createEffect } from "solid-js";
import { BoxImageOverlay, ImageOverlayProps } from "../../../../types/imageOverlay";
import ImageOverlayBase from "../ImageOverlayBase/ImageOverlayBase";
import { drawBoxOverlay } from "../../../../helpers/canvasRenderer";

function ImageOverlayBoxElem(props: ImageOverlayProps<BoxImageOverlay>) {
  let canvas: HTMLCanvasElement | undefined;

  createEffect(() => {
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBoxOverlay(ctx, props.item, Math.round(props.item.dimensions.x), Math.round(props.item.dimensions.y));
  });

  return <ImageOverlayBase {...props}>
    <canvas
      ref={canvas}
      width={Math.max(0, Math.round(props.item.dimensions.width))}
      height={Math.max(0, Math.round(props.item.dimensions.height))}
    />
  </ImageOverlayBase>;
}

export default ImageOverlayBoxElem;
