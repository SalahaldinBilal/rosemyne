import styles from "./ImageViewer.module.scss";
import { createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { ImageViewerProps } from "../../types";
import Button from "../Button/Button";
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

  const pannable = createMemo(() => {
    const size = rotatedSize();
    if (!size) return false;
    return size.w * scale() > viewport().w + 0.5 || size.h * scale() > viewport().h + 0.5;
  });

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
    const maxX = size.w * atScale > view.w ? (size.w * atScale - view.w) / 2 + view.w * PAN_OVERSCROLL : 0;
    const maxY = size.h * atScale > view.h ? (size.h * atScale - view.h) / 2 + view.h * PAN_OVERSCROLL : 0;
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
    if (event.button !== 0 || !pannable()) return;
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
        rotate(90);
        break;
      case "R":
        rotate(-90);
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

  return <div class={styles.ImageViewer}>
    <div
      class={styles.Stage}
      classList={{ [styles.Pannable]: pannable(), [styles.Dragging]: dragging() }}
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
          transform: `translate(calc(-50% + ${pan().x}px), calc(-50% + ${pan().y}px)) rotate(${rotation()}deg) scale(${scale()})`,
        }}
        onLoad={event => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
      />
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
      <div class={styles.Divider} />
      <Button isIcon color="var(--base-font-color)" tooltip="Rotate left (Shift+R)" onClick={() => rotate(-90)}>
        <RotateCcw size={18} />
      </Button>
      <Button isIcon color="var(--base-font-color)" tooltip="Rotate right (R)" onClick={() => rotate(90)}>
        <RotateCw size={18} />
      </Button>
    </div>
  </div>
}

export default ImageViewer;
