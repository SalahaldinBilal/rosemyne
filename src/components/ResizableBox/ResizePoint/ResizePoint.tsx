import styles from "./ResizePoint.module.scss";
import { ResizeDirection } from "../../../types";
import { createMemo, JSX } from "solid-js";

function ResizePoint(props: { direction: ResizeDirection, pointRadius: number, onMouseDown: () => void }): JSX.Element {
  const pointStyles = createMemo(() => directionToFlexSpace(props.direction, props.pointRadius));
  const pointRadiusPixels = createMemo(() => props.pointRadius + 'px');

  return (
    <div
      class={styles.PointParent}
      style={pointStyles().parentStyles}
      onMouseDown={props.onMouseDown}
    >
      <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" style={{ width: pointRadiusPixels(), height: pointRadiusPixels(), ...pointStyles().childStyles }}>
        <circle cx="10" cy="10" r="10" />
      </svg>
    </div>
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

function directionToFlexSpace(direction: ResizeDirection, circleRadius: number) {
  const parentStyles: JSX.CSSProperties = {};
  const childStyles: JSX.CSSProperties = {};
  const translateBy = circleRadius / 2;
  let xTranslate = 0;
  let yTranslate = 0;

  switch (direction) {
    case ResizeDirection.TopLeft:
    case ResizeDirection.Top:
    case ResizeDirection.TopRight:
      parentStyles['align-items'] = 'flex-start';
      yTranslate = -translateBy;
      break;
    case ResizeDirection.BottomRight:
    case ResizeDirection.Bottom:
    case ResizeDirection.BottomLeft:
      parentStyles['align-items'] = 'flex-end';
      yTranslate = translateBy;
      break;
    case ResizeDirection.Right:
    case ResizeDirection.Left:
      parentStyles['align-items'] = 'center';
      break;
  }

  switch (direction) {
    case ResizeDirection.TopLeft:
    case ResizeDirection.Left:
    case ResizeDirection.BottomLeft:
      parentStyles['justify-content'] = 'flex-start';
      xTranslate = -translateBy;
      break;
    case ResizeDirection.BottomRight:
    case ResizeDirection.Right:
    case ResizeDirection.TopRight:
      parentStyles['justify-content'] = 'flex-end';
      xTranslate = +translateBy;
      break;
    case ResizeDirection.Top:
    case ResizeDirection.Bottom:
      parentStyles['justify-content'] = 'center';
      break;
  }

  childStyles.cursor = directionCursor(direction);
  childStyles.transform = `translate(${xTranslate}px, ${yTranslate}px)`;

  return { parentStyles, childStyles };
}
