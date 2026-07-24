import { createMemo, Show } from "solid-js";
import styles from "./ToolBox.module.scss";
import useScreenshotOverlayStateInner from "../../../states/screenshotOverlayState";
import { getDimensionFromPoints } from "../../../helpers";
import AnnotationToolBar from "@core/components/AnnotationToolBar/AnnotationToolBar";

const TOP_MARGIN = 12;

function ToolBox() {
  const { imageData, closeOverlay } = useScreenshotOverlayStateInner;

  // The monitor the mouse was on when the screenshot was taken; the toolbox is anchored to
  // its top-center for the whole session and never moves, regardless of selection/drag state.
  const selectedMonitorDimensions = createMemo(() => {
    if (!imageData()) return;

    return getDimensionFromPoints(imageData()!.mousePosition, imageData()!.monitorPositions) ?? imageData()!.monitorPositions[0]
  });
  const position = createMemo(() => {
    const monitor = selectedMonitorDimensions();
    if (!monitor) return null;

    return {
      left: (monitor.x + monitor.width / 2) + "px",
      top: (monitor.y + TOP_MARGIN) + "px",
    };
  });

  return (
    <Show when={position()}>
      <div style={position()!} class={styles.ToolBoxParent}>
        <AnnotationToolBar hint="Drag or click a window to capture · Esc to cancel" onClose={() => closeOverlay()} />
      </div>
    </Show>
  );
}

export default ToolBox;
