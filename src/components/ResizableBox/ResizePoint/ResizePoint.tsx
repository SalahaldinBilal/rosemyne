import styles from "./ResizePoint.module.scss";
import { ResizeDirection } from "../../../types";
import { createMemo, JSX } from "solid-js";

function ResizePoint(props: { direction: ResizeDirection, pointRadius: number, onMouseDown: () => void }): JSX.Element {
  const anchor = createMemo(() => directionAnchor(props.direction));
  const pointRadiusPixels = createMemo(() => props.pointRadius + 'px');

  return (
    <svg
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
      class={styles.Point}
      style={{
        width: pointRadiusPixels(),
        height: pointRadiusPixels(),
        left: anchor().left,
        top: anchor().top,
        cursor: directionCursor(props.direction),
      }}
      onMouseDown={props.onMouseDown}
    >
      <circle cx="10" cy="10" r="8.5" />
    </svg>
  );
}

export default ResizePoint;

export function horizontalAnchor(direction: ResizeDirection, dims: { x: number, width: number }): number | null {
  switch (direction) {
    case ResizeDirection.TopLeft:
    case ResizeDirection.Left:
    case ResizeDirection.BottomLeft:
      return dims.x + dims.width;
    case ResizeDirection.TopRight:
    case ResizeDirection.Right:
    case ResizeDirection.BottomRight:
      return dims.x;
    default:
      return null;
  }
}

export function verticalAnchor(direction: ResizeDirection, dims: { y: number, height: number }): number | null {
  switch (direction) {
    case ResizeDirection.TopLeft:
    case ResizeDirection.Top:
    case ResizeDirection.TopRight:
      return dims.y + dims.height;
    case ResizeDirection.BottomLeft:
    case ResizeDirection.Bottom:
    case ResizeDirection.BottomRight:
      return dims.y;
    default:
      return null;
  }
}

export function composeDirection(horizontal: "left" | "right" | null, vertical: "top" | "bottom" | null): ResizeDirection | null {
  if (horizontal && vertical) {
    if (vertical === "top") return horizontal === "left" ? ResizeDirection.TopLeft : ResizeDirection.TopRight;
    return horizontal === "left" ? ResizeDirection.BottomLeft : ResizeDirection.BottomRight;
  }

  if (horizontal) return horizontal === "left" ? ResizeDirection.Left : ResizeDirection.Right;
  if (vertical) return vertical === "top" ? ResizeDirection.Top : ResizeDirection.Bottom;

  return null;
}

export function directionCursor(direction: ResizeDirection): string {
  switch (direction) {
    case ResizeDirection.TopLeft: return "nw-resize";
    case ResizeDirection.Top: return "n-resize";
    case ResizeDirection.TopRight: return "ne-resize";
    case ResizeDirection.Right: return "e-resize";
    case ResizeDirection.BottomRight: return "se-resize";
    case ResizeDirection.Bottom: return "s-resize";
    case ResizeDirection.BottomLeft: return "sw-resize";
    case ResizeDirection.Left: return "w-resize";
  }
}

// Percentages of the box itself, so a point stays on its own corner/edge at any
// size; laying them out inside grid cells breaks once a cell is thinner than the point.
function directionAnchor(direction: ResizeDirection): { left: string, top: string } {
  const top = (() => {
    switch (direction) {
      case ResizeDirection.TopLeft:
      case ResizeDirection.Top:
      case ResizeDirection.TopRight:
        return "0%";
      case ResizeDirection.BottomLeft:
      case ResizeDirection.Bottom:
      case ResizeDirection.BottomRight:
        return "100%";
      default:
        return "50%";
    }
  })();

  const left = (() => {
    switch (direction) {
      case ResizeDirection.TopLeft:
      case ResizeDirection.Left:
      case ResizeDirection.BottomLeft:
        return "0%";
      case ResizeDirection.TopRight:
      case ResizeDirection.Right:
      case ResizeDirection.BottomRight:
        return "100%";
      default:
        return "50%";
    }
  })();

  return { left, top };
}
