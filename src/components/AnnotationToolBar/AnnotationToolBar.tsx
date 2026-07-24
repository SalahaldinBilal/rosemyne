import { createEffect, createMemo, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import styles from "./AnnotationToolBar.module.scss";
import { useAnnotationState } from "../../states/annotationContext";
import { beautifyCamelOrPascalCase } from "../../helpers";
import Button from "../Button/Button";
import Input from "../Input/Input";
import { BookAIcon, Droplets, Eraser, Grid3X3Icon, LucideIcon, MousePointer2, MousePointerSquareDashed, Pencil, SquareMousePointer, Trash2, X } from "lucide-solid";
import { Tools } from "../../types";
import { makeEventListener } from "@solid-primitives/event-listener";
import { DefaultColorPicker } from "@thednp/solid-color-picker";

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

// Shared tool picker, unpositioned, callers (ToolBox.tsx, ScrollCaptureResult) handle their own layout.
// onClose is omitted by embedded callers that already offer their own cancel/discard chrome (e.g. ScrollCaptureResult's TopBar).
function AnnotationToolBar(props: { hint?: string, onClose?: () => void, cursorScale?: () => number, screenshotToolLabel?: string }) {
  const {
    currentTool, setCurrentTool, isOverlayInteracting,
    drawColor, setDrawColor, brushSize, setBrushSize, eraserSize, setEraserSize,
    overlayItems, clearDrawing,
  } = useAnnotationState();
  const hasDrawing = createMemo(() => overlayItems.some(item => item.type === "draw"));
  const isDrawTool = createMemo(() => currentTool() === Tools.DrawOverlay);
  const isEraseTool = createMemo(() => currentTool() === Tools.EraseOverlay);

  // Position set imperatively (not a reactive style), mousemove fires too often to route through a signal.
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

  makeEventListener(window, "keydown", event => {
    const match = event.code.match(/^Digit([1-9])$/);
    if (!match) return;

    const tool = ALL_TOOLS[Number(match[1]) - 1];
    if (tool) setCurrentTool(tool.tool);
  });

  return (<>
    <div class={styles.ToolBoxColumn} classList={{ [styles.Interacting]: isOverlayInteracting() }}>
      <div class={styles.ToolBox}>
        <For each={TOOL_GROUPS}>
          {(group, groupIndex) => <>
            <Show when={groupIndex() > 0}><div class={styles.Divider} /></Show>
            <For each={group}>
              {tool => {
                const isActive = createMemo(() => currentTool() === tool.tool);
                const shortcutIndex = ALL_TOOLS.indexOf(tool);

                const label = tool.tool === Tools.Screenshot ? (props.screenshotToolLabel ?? "Screenshot") : beautifyCamelOrPascalCase(Tools[tool.tool]);

                return <Button
                  isIcon
                  tooltip={`${label} (${shortcutIndex + 1})`}
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
        <Show when={props.onClose}>
          <div class={styles.Divider} />
          <Button
            isIcon
            tooltip="Cancel (Esc)"
            color="var(--danger-color)"
            style={{ width: "36px", height: "36px", "border-radius": "9px" }}
            children={<X size={18} />}
            onClick={() => props.onClose?.()}
          />
        </Show>
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
      <Show when={props.hint}>
        <div class={styles.Hint}>{props.hint}</div>
      </Show>
    </div>
    <Show when={isDrawTool() || isEraseTool()}>
      {/* Portal'd to <body>: the positioning wrapper's own CSS transform would otherwise become the containing block for this position:fixed cursor, offsetting it from the real pointer. */}
      <Portal>
        <div
          ref={el => { brushCursor = el; el.style.left = "-9999px"; el.style.top = "-9999px"; }}
          class={styles.BrushCursor}
          style={{
            // Scaled to match strokes, which are painted in native image pixels then visually zoomed by the viewer.
            width: `${(isDrawTool() ? brushSize() : eraserSize()) * (props.cursorScale?.() ?? 1)}px`,
            height: `${(isDrawTool() ? brushSize() : eraserSize()) * (props.cursorScale?.() ?? 1)}px`,
            "background-color": isDrawTool() ? `${drawColor()}40` : "transparent",
          }}
        />
      </Portal>
    </Show>
  </>);
}

export default AnnotationToolBar;
