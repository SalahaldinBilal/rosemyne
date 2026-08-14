import { createEffect, createMemo } from "solid-js";
import { ArrowImageOverlay, ImageOverlayProps, LineImageOverlay } from "../../../../types/imageOverlay";
import ImageOverlayBase from "../ImageOverlayBase/ImageOverlayBase";
import { drawLineOverlay, lineStrokeMargin } from "../../../../helpers/canvasRenderer";

function ImageOverlayLineElem(props: ImageOverlayProps<LineImageOverlay | ArrowImageOverlay>) {
  let canvas: HTMLCanvasElement | undefined;

  const margin = createMemo(() => lineStrokeMargin(props.item));

  createEffect(() => {
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawLineOverlay(ctx, props.item, Math.round(props.item.dimensions.x) - margin(), Math.round(props.item.dimensions.y) - margin());
  });

  return <ImageOverlayBase {...props}>
    <canvas
      ref={canvas}
      width={Math.max(0, Math.round(props.item.dimensions.width)) + margin() * 2}
      height={Math.max(0, Math.round(props.item.dimensions.height)) + margin() * 2}
      style={{ position: "absolute", left: `${-margin()}px`, top: `${-margin()}px` }}
    />
  </ImageOverlayBase>;
}

export default ImageOverlayLineElem;
