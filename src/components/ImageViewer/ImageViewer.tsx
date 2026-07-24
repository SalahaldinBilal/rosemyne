import styles from "./ImageViewer.module.scss";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";
import { unwrap } from "solid-js/store";
import { ImageViewerApi, ImageViewerProps, Tools } from "../../types";
import Button from "../Button/Button";
import AnnotationToolBar from "../AnnotationToolBar/AnnotationToolBar";
import AnnotationContext from "../../states/annotationContext";
import { createAnnotationState } from "../../states/annotationState";
import ImageOverlayContainer from "../../pages/Screenshot/ImageOverlayContainer/ImageOverlayContainer";
import DrawLayer from "../../pages/Screenshot/DrawLayer/DrawLayer";
import CropSelectionBox from "../CropSelectionBox/CropSelectionBox";
import { renderFinalImage } from "../../helpers/canvasRenderer";
import { makeEventListener } from "@solid-primitives/event-listener";
import { Maximize, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-solid";

const ZOOM_STEP = 1.25;
const WHEEL_ZOOM_INTENSITY = 0.0015;
// When an axis overflows, let the image edge be pulled this far (in viewport
// fractions) past the container edge, so edge regions can reach the center.
const PAN_OVERSCROLL = 0.5;

function ImageViewer(props: ImageViewerProps) {
  const [natural, setNatural] = createSignal<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = createSignal({ w: 0, h: 0 });
  const [scale, setScale] = createSignal(1);
  const [rotation, setRotation] = createSignal(0);
  // Pan is the offset of the image center from the container center, in screen pixels.
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  const [fitted, setFitted] = createSignal(true);
  const [dragging, setDragging] = createSignal(false);

  let stage: HTMLDivElement | undefined;

  const rotatedSize = createMemo(() => {
    const size = natural();
    if (!size) return null;
    return rotation() % 180 !== 0 ? { w: size.h, h: size.w } : size;
  });

  const fitScale = createMemo(() => {
    const size = rotatedSize();
    const view = viewport();
    if (!size || view.w <= 0 || view.h <= 0) return 1;
    return Math.min(view.w / size.w, view.h / size.h);
  });

  // Shared between the image and `overlay`, so both stay pixel-aligned.
  const transform = createMemo(() => `translate(calc(-50% + ${pan().x}px), calc(-50% + ${pan().y}px)) rotate(${rotation()}deg) scale(${scale()})`);

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  function clampScale(value: number) {
    return clamp(value, Math.min(fitScale(), 1) / 10, Math.max(fitScale(), 1) * 16);
  }

  function clampPan(next: { x: number; y: number }, atScale: number) {
    const size = rotatedSize();
    if (!size) return { x: 0, y: 0 };
    const view = viewport();
    const maxX = Math.max(0, size.w * atScale - view.w) / 2 + view.w * PAN_OVERSCROLL;
    const maxY = Math.max(0, size.h * atScale - view.h) / 2 + view.h * PAN_OVERSCROLL;
    return { x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  }

  function applyFit() {
    setFitted(true);
    setScale(fitScale());
    setPan({ x: 0, y: 0 });
  }

  function zoomTo(target: number, centerX = 0, centerY = 0) {
    const previous = scale();
    const next = clampScale(target);
    const ratio = next / previous;
    setPan(current => clampPan({
      x: centerX + (current.x - centerX) * ratio,
      y: centerY + (current.y - centerY) * ratio,
    }, next));
    setScale(next);
    setFitted(false);
  }

  function zoomBy(factor: number) {
    zoomTo(scale() * factor);
  }

  function rotate(degrees: number) {
    setRotation(current => (current + degrees + 360) % 360);
    applyFit();
  }

  function stagePoint(event: { clientX: number; clientY: number }) {
    const rect = stage!.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
  }

  // Inverts the same pan/scale transform the image and `overlay` share; only
  // valid at rotation 0, which is why `overlay` callers also pass `hideRotate`.
  function toImageCoords(clientX: number, clientY: number) {
    const point = stagePoint({ clientX, clientY });
    const size = natural();
    const p = pan();
    const s = scale();
    return {
      x: (size ? size.w / 2 : 0) + (point.x - p.x) / s,
      y: (size ? size.h / 2 : 0) + (point.y - p.y) / s,
    };
  }

  function toImageDelta(dx: number, dy: number) {
    const s = scale();
    return { x: dx / s, y: dy / s };
  }

  // `editable` is stable for this instance's lifetime, so this only ever runs once:
  // the annotation state is created here (not by the caller) so it can live for as
  // long as this ImageViewer does, surviving `annotating` toggling on/off.
  const annotation = props.editable
    ? createAnnotationState(() => props.src, toImageCoords, toImageDelta)
    : undefined;
  // Unlike the screenshotter (which starts a live drag-select), an editable
  // ImageViewer has nothing to select on entry, Move is the useful default.
  annotation?.setCurrentTool(Tools.Move);

  // Primary(left)-button drag pans only when nothing else claims it: outside
  // annotate mode that's the caller's `allowPrimaryPan`, inside it it's only
  // the Move tool, so drawing/box/etc. tools don't fight the viewer for drags.
  const canPrimaryPan = createMemo(() => {
    if (annotation && props.annotating) return annotation.currentTool() === Tools.Move;
    return props.allowPrimaryPan !== false;
  });

  function renderFinal(withAnnotations: boolean) {
    if (!annotation) return null;
    const baseImage = annotation.image();
    if (!baseImage) return null;

    const box = withAnnotations
      ? { ...unwrap(annotation.selectedBox) }
      : { x: 0, y: 0, width: baseImage.naturalWidth, height: baseImage.naturalHeight };
    const overlays = withAnnotations ? unwrap(annotation.overlayItems) : [];

    return renderFinalImage(baseImage, box, overlays, annotation.effectLayers);
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const point = stagePoint(event);
    zoomTo(scale() * Math.exp(-event.deltaY * WHEEL_ZOOM_INTENSITY), point.x, point.y);
  }

  function onDblClick(event: MouseEvent) {
    if (fitted()) {
      const point = stagePoint(event);
      zoomTo(1, point.x, point.y);
    } else {
      applyFit();
    }
  }

  function onPointerDown(event: PointerEvent) {
    // Middle-button drag always pans; primary(left)-button drag only when the
    // caller isn't using it for something else (e.g. drawing an overlay).
    const isMiddle = event.button === 1;
    const isPrimary = event.button === 0 && canPrimaryPan();
    if (!(isMiddle || isPrimary)) return;
    event.preventDefault();
    const el = event.currentTarget as HTMLElement;
    el.setPointerCapture(event.pointerId);
    setDragging(true);

    let lastX = event.clientX;
    let lastY = event.clientY;

    const move = (moveEvent: PointerEvent) => {
      setPan(current => clampPan({
        x: current.x + moveEvent.clientX - lastX,
        y: current.y + moveEvent.clientY - lastY,
      }, scale()));
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
    };

    const stop = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
      setDragging(false);
    };

    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  }

  makeEventListener(window, "keydown", event => {
    if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;

    switch (event.key) {
      case "+":
      case "=":
        zoomBy(ZOOM_STEP);
        break;
      case "-":
        zoomBy(1 / ZOOM_STEP);
        break;
      case "0":
        applyFit();
        break;
      case "1":
        zoomTo(1);
        break;
      case "r":
        if (!props.hideRotate) rotate(90);
        break;
      case "R":
        if (!props.hideRotate) rotate(-90);
        break;
    }
  });

  onMount(() => {
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      setViewport({ w: rect.width, h: rect.height });
    });
    observer.observe(stage!);
    onCleanup(() => observer.disconnect());

    const api: ImageViewerApi = { toImageCoords, toImageDelta };
    if (annotation) {
      api.renderFinal = renderFinal;
      api.resetEditing = annotation.resetEditing;
    }
    props.onApi?.(api);
  });

  createEffect(() => {
    fitScale();
    viewport();
    untrack(() => {
      if (fitted()) {
        applyFit();
      } else {
        const next = clampScale(scale());
        setScale(next);
        setPan(current => clampPan(current, next));
      }
    });
  });

  // A named function, not a pre-computed `const`, so that when it's called
  // from inside <AnnotationContext.Provider>'s JSX children below, Solid's
  // compiler defers actually calling it (children are compiled as a getter)
  // until the Provider has set its context on the owner. A precomputed value
  // would construct ImageOverlayContainer/DrawLayer/AnnotationToolBar (and
  // their useAnnotationState() calls) before the Provider is in scope.
  function renderBody() {
    return <div class={styles.ImageViewer}>
      <div
        class={styles.Stage}
        classList={{ [styles.Pannable]: canPrimaryPan(), [styles.Dragging]: dragging() }}
        ref={stage}
        onWheel={onWheel}
        onDblClick={onDblClick}
        onPointerDown={onPointerDown}
      >
        <img
          src={props.src}
          draggable={false}
          classList={{ [styles.Pixelated]: scale() >= 2 }}
          style={{
            visibility: natural() ? "visible" : "hidden",
            transform: transform(),
          }}
          onLoad={event => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
        />
        <Show when={props.overlay || (annotation && props.annotating)}>
          <div
            class={styles.OverlayLayer}
            style={{
              width: `${natural()?.w ?? 0}px`,
              height: `${natural()?.h ?? 0}px`,
              transform: transform(),
            }}
          >
            {props.overlay}
            <Show when={annotation && props.annotating}>
              <div class={styles.EditLayer} onMouseDown={e => annotation!.mouseEventHandler.emit("mouseDown", e)}>
                <ImageOverlayContainer />
                <DrawLayer />
                <CropSelectionBox />
              </div>
            </Show>
          </div>
        </Show>
      </div>
      <div class={styles.Toolbar} onPointerDown={event => event.stopPropagation()} onDblClick={event => event.stopPropagation()}>
        <Button isIcon color="var(--base-font-color)" tooltip="Zoom out (-)" onClick={() => zoomBy(1 / ZOOM_STEP)}>
          <ZoomOut size={18} />
        </Button>
        <span class={styles.ZoomLabel}>{Math.round(scale() * 100)}%</span>
        <Button isIcon color="var(--base-font-color)" tooltip="Zoom in (+)" onClick={() => zoomBy(ZOOM_STEP)}>
          <ZoomIn size={18} />
        </Button>
        <div class={styles.Divider} />
        <Button isIcon color="var(--base-font-color)" tooltip="Fit to window (0)" onClick={applyFit}>
          <Maximize size={18} />
        </Button>
        <Button isIcon color="var(--base-font-color)" tooltip="Actual size (1)" onClick={() => zoomTo(1)}>
          <span class={styles.ActualSize}>1:1</span>
        </Button>
        <Show when={!props.hideRotate}>
          <div class={styles.Divider} />
          <Button isIcon color="var(--base-font-color)" tooltip="Rotate left (Shift+R)" onClick={() => rotate(-90)}>
            <RotateCcw size={18} />
          </Button>
          <Button isIcon color="var(--base-font-color)" tooltip="Rotate right (R)" onClick={() => rotate(90)}>
            <RotateCw size={18} />
          </Button>
        </Show>
      </div>
      <Show when={annotation && props.annotating}>
        <div class={styles.AnnotationToolbar} onPointerDown={event => event.stopPropagation()} onDblClick={event => event.stopPropagation()}>
          <AnnotationToolBar hint={props.annotationHint} cursorScale={scale} screenshotToolLabel="Crop" />
        </div>
      </Show>
    </div>;
  }

  return annotation
    ? <AnnotationContext.Provider value={annotation}>{renderBody()}</AnnotationContext.Provider>
    : renderBody();
}

export default ImageViewer;
