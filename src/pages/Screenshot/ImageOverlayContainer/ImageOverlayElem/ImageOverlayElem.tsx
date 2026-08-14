import { Match, Switch } from "solid-js";
import { ImageOverlay, ImageOverlayProps } from "../../../../types/imageOverlay";
import ImageOverlayBoxElem from "../ImageOverlays/ImageOverlayBoxElem";
import ImageOverlayTextElem from "../ImageOverlays/ImageOverlayTextElem";
import ImageOverlayEffectElem from "../ImageOverlays/ImageOverlayEffectElem";
import ImageOverlayImageElem from "../ImageOverlays/ImageOverlayImageElem";
import ImageOverlayLineElem from "../ImageOverlays/ImageOverlayLineElem";

function ImageOverlayElem(props: ImageOverlayProps<ImageOverlay>) {
  return <Switch>
    <Match when={props.item.type === "box"}>
      <ImageOverlayBoxElem {...props as any} />
    </Match>
    <Match when={props.item.type === "text"}>
      <ImageOverlayTextElem {...props as any} />
    </Match>
    <Match when={props.item.type === "blur" || props.item.type === "pixelate"}>
      <ImageOverlayEffectElem {...props as any} />
    </Match>
    <Match when={props.item.type === "image"}>
      <ImageOverlayImageElem {...props as any} />
    </Match>
    <Match when={props.item.type === "line" || props.item.type === "arrow"}>
      <ImageOverlayLineElem {...props as any} />
    </Match>
  </Switch>
}

export default ImageOverlayElem;