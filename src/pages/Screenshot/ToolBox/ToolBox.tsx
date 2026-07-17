import { createEffect, createMemo, For, onCleanup, Show } from "solid-js";
import styles from "./ToolBox.module.scss";
import useScreenshotOverlayStateInner from "../../../states/screenshotOverlayState";
import { beautifyCamelOrPascalCase, getDimensionFromPoints } from "../../../helpers";
import Button from "@core/components/Button/Button";
import Input from "@core/components/Input/Input";
import { BookAIcon, Droplets, Eraser, Grid3X3Icon, LucideIcon, MousePointer2, MousePointerSquareDashed, Pencil, SquareMousePointer, Trash2, X } from "lucide-solid";
import { Tools } from "../../../types";
import { makeEventListener } from "@solid-primitives/event-listener";
import { DefaultColorPicker } from "@thednp/solid-color-picker";

const TOP_MARGIN = 12;

type ToolEntry = { tool: Tools, icon: LucideIcon };

// Grouped (and separated by dividers) in display order; also the order digit
// shortcuts 1-9 map to, so reordering here reorders the shortcuts with it.
const TOOL_GROUPS: ToolEntry[][] = [
  [
    { tool: Tools.Screenshot, icon: MousePointerSquareDashed },
    { tool: Tools.Move, icon: MousePointer2 },
  ],
  [
    { tool: Tools.DrawOverlay, icon: Pencil },
    { tool: Tools.EraseOverlay, icon: Eraser },
  ],
  [
    { tool: Tools.BoxOverlay, icon: SquareMousePointer },
    { tool: Tools.TextOverlay, icon: BookAIcon },
    { tool: Tools.BlurOverlay, icon: Droplets },
    { tool: Tools.PixelateOverly, icon: Grid3X3Icon },
  ],
];
const ALL_TOOLS = TOOL_GROUPS.flat();

function ToolBox() {
  const {
    imageData, currentTool, setCurrentTool, closeOverlay, isOverlayInteracting,
    drawColor, setDrawColor, brushSize, setBrushSize, eraserSize, setEraserSize,
    overlayItems, clearDrawing,
  } = useScreenshotOverlayStateInner;
  const hasDrawing = createMemo(() => overlayItems.some(item => item.type === "draw"));
  const isDrawTool = createMemo(() => currentTool() === Tools.DrawOverlay);
  const isEraseTool = createMemo(() => currentTool() === Tools.EraseOverlay);

  // The mouse cursor is replaced with a circle matching the brush/eraser
  // diameter while either tool is active, so the user can see exactly what a
  // stroke will cover before committing to it. Position is set imperatively
  // (not through Solid's reactive style) since mousemove fires far too often
  // to route through a signal, and mixing the two would fight over `left`/`top`.
  let brushCursor: HTMLDivElement | undefined;

  function positionBrushCursor(event: MouseEvent) {
    if (!brushCursor) return;
    brushCursor.style.left = `${event.clientX}px`;
    brushCursor.style.top = `${event.clientY}px`;
  }

  createEffect(() => {
    if (!isDrawTool() && !isEraseTool()) return;

    document.body.style.cursor = "none";
    window.addEventListener("mousemove", positionBrushCursor);

    onCleanup(() => {
      window.removeEventListener("mousemove", positionBrushCursor);
      document.body.style.cursor = "";
    });
  });

  onCleanup(() => {
    document.body.style.cursor = "";
  });

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

  makeEventListener(window, "keydown", event => {
    if (!imageData()) return;

    const match = event.code.match(/^Digit([1-9])$/);
    if (!match) return;

    const tool = ALL_TOOLS[Number(match[1]) - 1];
    if (tool) setCurrentTool(tool.tool);
  });

  return (
    <Show when={position()}>
      <div style={position()!} class={styles.ToolBoxParent} classList={{ [styles.Interacting]: isOverlayInteracting() }}>
        <div class={styles.ToolBoxColumn}>
          <div class={styles.ToolBox}>
            <For each={TOOL_GROUPS}>
              {(group, groupIndex) => <>
                <Show when={groupIndex() > 0}><div class={styles.Divider} /></Show>
                <For each={group}>
                  {tool => {
                    const isActive = createMemo(() => currentTool() === tool.tool);
                    const shortcutIndex = ALL_TOOLS.indexOf(tool);

                    return <Button
                      isIcon
                      tooltip={`${beautifyCamelOrPascalCase(Tools[tool.tool])} (${shortcutIndex + 1})`}
                      color={isActive() ? "var(--base-blue)" : undefined}
                      style={{
                        width: "36px", height: "36px", "border-radius": "9px",
                        "background-color": isActive() ? "rgb(from var(--base-blue) r g b / .18)" : undefined,
                      }}
                      children={<tool.icon size={18} />}
                      onClick={() => setCurrentTool(tool.tool)}
                    />
                  }}
                </For>
                <Show when={groupIndex() === 1}>
                  <Button
                    isIcon
                    tooltip="Clear drawing"
                    disabled={!hasDrawing()}
                    style={{ width: "36px", height: "36px", "border-radius": "9px" }}
                    children={<Trash2 size={18} />}
                    onClick={clearDrawing}
                  />
                </Show>
              </>}
            </For>
            <div class={styles.Divider} />
            <Button
              isIcon
              tooltip="Cancel (Esc)"
              color="var(--danger-color)"
              style={{ width: "36px", height: "36px", "border-radius": "9px" }}
              children={<X size={18} />}
              onClick={() => closeOverlay()}
            />
          </div>
          <Show when={isDrawTool() || isEraseTool()}>
            <div class={styles.ToolOptions}>
              <Show when={isDrawTool()}>
                <div class={styles.ColorPickerWrapper}>
                  <DefaultColorPicker
                    format="hex"
                    theme="dark"
                    value={drawColor()}
                    onChange={color => setDrawColor(color as `#${string}`)}
                  />
                </div>
              </Show>
              <span class={styles.ToolOptionsLabel}>{isDrawTool() ? "Brush size" : "Eraser size"}</span>
              <Input
                type="number"
                min={1}
                max={200}
                value={isDrawTool() ? brushSize() : eraserSize()}
                onChange={e => {
                  const value = e.currentTarget.valueAsNumber;
                  if (!Number.isFinite(value) || value <= 0) return;
                  if (isDrawTool()) setBrushSize(value);
                  else setEraserSize(value);
                }}
                alignText="right"
                style={{ width: "60px" }}
                inputStyle={{ height: "26px", padding: "0 8px" }}
              />
            </div>
          </Show>
          <div class={styles.Hint}>Drag or click a window to capture · Esc to cancel</div>
        </div>
      </div>
      <Show when={isDrawTool() || isEraseTool()}>
        <div
          ref={el => { brushCursor = el; el.style.left = "-9999px"; el.style.top = "-9999px"; }}
          class={styles.BrushCursor}
          style={{
            width: `${(isDrawTool() ? brushSize() : eraserSize())}px`,
            height: `${(isDrawTool() ? brushSize() : eraserSize())}px`,
            "background-color": isDrawTool() ? `${drawColor()}40` : "transparent",
          }}
        />
      </Show>
    </Show>
  );
}

export default ToolBox;
