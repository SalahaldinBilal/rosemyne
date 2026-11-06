import styles from "./TagNodeView.module.scss";
import { createMemo, createSignal, For, Index, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { Dynamic } from "solid-js/web";
import { makeEventListener } from "@solid-primitives/event-listener";
import { Braces, Calendar, CircleSlash, File, Hash, List, LucideIcon, Maximize, Minus, Network, Plus, Timer, ToggleLeft, Type, X } from "lucide-solid";
import Button from "../../../components/Button/Button";
import Select from "../../../components/Select/Select";
import { HistoryItemType } from "../../../types";
import { savedUrl } from "../HistoryCard/HistoryCard";
import { entryLabel, isContainer, KIND_ITEMS, subtreeIds, TagEntry, TagKind } from "./tagEntry";
import { focusEntry, useTagEditor } from "./tagEditorContext";
import TagNameInput from "./TagNameInput";
import TagValueEditor from "./TagValueEditor";

type NodeKey = number | "root";
type Point = { x: number, y: number };

const ROOT_W = 200;
const NODE_W = 312;
const GAP_X = 64;
const GAP_Y = 14;
const ANCHOR_Y = 21;
const ROOT_ANCHOR_Y = 62;
const DEFAULT_HEIGHT = 92;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.6;
const DRAG_THRESHOLD = 4;
// Clicks on these keep their normal behavior instead of starting a node drag.
const NO_DRAG = "input, button, textarea, [tabindex], [role], [data-no-drag]";

const KIND_ICONS: Record<TagKind, LucideIcon> = {
  string: Type, number: Hash, boolean: ToggleLeft, time: Timer, dateTime: Calendar, object: Braces, array: List, null: CircleSlash,
};

type Drag =
  | { kind: "pan", startX: number, startY: number, view: Point, moved: boolean }
  | { kind: "node", id: NodeKey, startX: number, startY: number, offset: Point, ids: Set<number>, moved: boolean };

function TagNodeView(props: { fileName: string, itemType: HistoryItemType }) {
  const editor = useTagEditor();
  const [view, setView] = createSignal({ x: 0, y: 0, z: 1 });
  const [heights, setHeights] = createStore<Record<string, number>>({});
  const [offsets, setOffsets] = createStore<Record<string, Point>>({});
  const [selected, setSelected] = createSignal<NodeKey | null>(null);
  const [draggedIds, setDraggedIds] = createSignal<Set<number> | null>(null);
  const [dropTarget, setDropTarget] = createSignal<NodeKey | null>(null);
  const [panning, setPanning] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  let canvas: HTMLDivElement | undefined;
  let drag: Drag | null = null;

  const visible = createMemo(() => {
    const out: TagEntry[] = [];
    const visit = (list: TagEntry[]) => {
      for (const entry of list) {
        out.push(entry);
        if (isContainer(entry.kind) && entry.expanded) visit(entry.children);
      }
    };
    visit(editor.entries);
    return out;
  });

  const positions = createMemo(() => {
    const base = new Map<NodeKey, Point>();
    const heightOf = (id: number) => heights[id] ?? DEFAULT_HEIGHT;

    function place(list: TagEntry[], depth: number, cursor: number): number {
      const x = ROOT_W + GAP_X + (depth - 1) * (NODE_W + GAP_X);
      for (const entry of list) {
        const height = heightOf(entry.id);
        if (!isContainer(entry.kind) || !entry.expanded || entry.children.length === 0) {
          base.set(entry.id, { x, y: cursor });
          cursor += height + GAP_Y;
          continue;
        }
        const start = cursor;
        const after = place(entry.children, depth + 1, cursor);
        const first = base.get(entry.children[0].id)!;
        const last = base.get(entry.children[entry.children.length - 1].id)!;
        const y = Math.max(start, (first.y + last.y) / 2);
        base.set(entry.id, { x, y });
        cursor = Math.max(after, y + height + GAP_Y);
      }
      return cursor;
    }

    place(editor.entries, 1, 0);
    const top = editor.entries;
    const rootY = top.length
      ? (base.get(top[0].id)!.y + base.get(top[top.length - 1].id)!.y) / 2 + ANCHOR_Y - ROOT_ANCHOR_Y
      : 0;

    const rootOffset = offsets.root ?? { x: 0, y: 0 };
    const out = new Map<NodeKey, Point>([["root", { x: rootOffset.x, y: rootY + rootOffset.y }]]);
    const shift = (list: TagEntry[], carried: Point) => {
      for (const entry of list) {
        const own = offsets[entry.id] ?? { x: 0, y: 0 };
        const total = { x: carried.x + own.x, y: carried.y + own.y };
        const point = base.get(entry.id);
        if (point) out.set(entry.id, { x: point.x + total.x, y: point.y + total.y });
        shift(entry.children, total);
      }
    };
    shift(editor.entries, rootOffset);
    return out;
  });

  const edges = createMemo(() => {
    const parents = editor.parents();
    const placed = positions();
    const root = placed.get("root")!;
    return visible().map(entry => {
      const parent = parents.get(entry.id) ?? null;
      const to = placed.get(entry.id)!;
      const from = parent
        ? { x: placed.get(parent.id)!.x + NODE_W, y: placed.get(parent.id)!.y + ANCHOR_Y }
        : { x: root.x + ROOT_W, y: root.y + ROOT_ANCHOR_Y };
      const end = { x: to.x, y: to.y + ANCHOR_Y };
      const bend = Math.max(30, (end.x - from.x) / 2);
      return {
        d: `M${from.x} ${from.y} C${from.x + bend} ${from.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`,
        hot: selected() === entry.id || selected() === (parent ? parent.id : "root"),
      };
    });
  });

  const worldStyle = createMemo(() => ({ transform: `translate(${view().x}px, ${view().y}px) scale(${view().z})` }));
  const canvasStyle = createMemo(() => ({
    "background-size": `${20 * view().z}px ${20 * view().z}px`,
    "background-position": `${view().x}px ${view().y}px`,
  }));
  const zoomLabel = createMemo(() => `${Math.round(view().z * 100)}%`);
  const rootStyle = createMemo(() => {
    const point = positions().get("root")!;
    return { left: `${point.x}px`, top: `${point.y}px` };
  });
  const thumbUrl = createMemo(() => props.itemType === "video"
    ? `http://rosemyne-photo.localhost/thumb/${props.fileName}`
    : props.itemType === "image" ? savedUrl(props.fileName) : null);
  const tagCount = createMemo(() => `${editor.entries.length} ${editor.entries.length === 1 ? "tag" : "tags"}`);

  function zoomAt(cx: number, cy: number, factor: number) {
    const { x, y, z } = view();
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
    const worldX = (cx - x) / z, worldY = (cy - y) / z;
    setView({ x: cx - worldX * next, y: cy - worldY * next, z: next });
  }

  function zoomCenter(factor: number) {
    if (!canvas) return;
    zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, factor);
  }

  function bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [id, point] of positions()) {
      const width = id === "root" ? ROOT_W : NODE_W;
      const height = id === "root" ? (heights.root ?? 160) : (heights[id] ?? DEFAULT_HEIGHT);
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x + width); maxY = Math.max(maxY, point.y + height);
    }
    return { minX, minY, maxX, maxY };
  }

  function fit() {
    if (!canvas) return;
    const { minX, minY, maxX, maxY } = bounds();
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const z = Math.min(1, Math.max(MIN_ZOOM, Math.min((width - 96) / (maxX - minX), (height - 96) / (maxY - minY))));
    setView({ x: (width - (maxX - minX) * z) / 2 - minX * z, y: (height - (maxY - minY) * z) / 2 - minY * z, z });
  }

  function tidy() {
    setOffsets(produce(all => { for (const key of Object.keys(all)) delete all[key]; }));
    requestAnimationFrame(fit);
  }

  function ensureVisible(id: number) {
    if (!canvas) return;
    const point = positions().get(id);
    if (!point) return;
    const { x, y, z } = view();
    const left = point.x * z + x, top = point.y * z + y;
    const right = left + NODE_W * z, bottom = top + (heights[id] ?? DEFAULT_HEIGHT) * z;
    const margin = 32;
    const dx = left < margin ? margin - left : right > canvas.clientWidth - margin ? canvas.clientWidth - margin - right : 0;
    const dy = top < margin ? margin - top : bottom > canvas.clientHeight - margin ? canvas.clientHeight - margin - bottom : 0;
    if (dx || dy) setView({ x: x + dx, y: y + dy, z });
  }

  function add(parent: number | null) {
    const id = editor.addChild(parent);
    setSelected(id);
    focusEntry(id);
    requestAnimationFrame(() => requestAnimationFrame(() => ensureVisible(id)));
  }

  function resetOffsets(ids: Iterable<number>) {
    setOffsets(produce(all => { for (const id of ids) delete all[id]; }));
  }

  function nodeAt(clientX: number, clientY: number, skip: Set<number>): NodeKey | null {
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const node = element.closest<HTMLElement>("[data-node-id]");
      if (!node || !canvas?.contains(node)) continue;
      const raw = node.dataset.nodeId!;
      if (raw === "root") return "root";
      const id = Number(raw);
      if (skip.has(id)) continue;
      const entry = visible().find(item => item.id === id);
      return entry && isContainer(entry.kind) ? id : null;
    }
    return null;
  }

  function onPointerDown(event: PointerEvent) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-canvas-overlay]")) return;
    const node = target.closest<HTMLElement>("[data-node-id]");

    if (event.button === 1 || (event.button === 0 && !node)) {
      event.preventDefault();
      drag = { kind: "pan", startX: event.clientX, startY: event.clientY, view: { ...view() }, moved: false };
      canvas?.setPointerCapture(event.pointerId);
      setPanning(true);
      return;
    }
    if (event.button !== 0 || !node) return;

    const id: NodeKey = node.dataset.nodeId === "root" ? "root" : Number(node.dataset.nodeId);
    setSelected(id);
    // Only controls inside the node count. The dialog around the canvas has a role too.
    const control = target.closest(NO_DRAG);
    if (control && node.contains(control)) return;

    event.preventDefault();
    const entry = id === "root" ? null : visible().find(item => item.id === id) ?? null;
    drag = {
      kind: "node",
      id,
      startX: event.clientX,
      startY: event.clientY,
      offset: { ...(offsets[id] ?? { x: 0, y: 0 }) },
      ids: entry ? subtreeIds(entry) : new Set(),
      moved: false,
    };
    canvas?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag) return;
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    drag.moved = true;

    if (drag.kind === "pan") {
      setView({ x: drag.view.x + dx, y: drag.view.y + dy, z: view().z });
      return;
    }

    const z = view().z;
    setOffsets(String(drag.id), { x: drag.offset.x + dx / z, y: drag.offset.y + dy / z });
    if (drag.id === "root") return;
    setDraggedIds(drag.ids);
    setDropTarget(nodeAt(event.clientX, event.clientY, drag.ids));
  }

  function onPointerUp() {
    const finished = drag;
    drag = null;
    setPanning(false);
    if (!finished) return;

    if (finished.kind === "pan") {
      if (!finished.moved) setSelected(null);
      return;
    }

    const target = dropTarget();
    setDraggedIds(null);
    setDropTarget(null);
    if (finished.id === "root" || !finished.moved || target === null) return;

    const id = finished.id;
    const parent = editor.parents().get(id) ?? null;
    const sameParent = target === "root" ? parent === null : parent?.id === target;
    if (sameParent || editor.move(id, target === "root" ? null : target)) resetOffsets(finished.ids);
  }

  makeEventListener(window, "keydown", event => {
    const id = selected();
    if (typeof id !== "number" || (event.key !== "Delete" && event.key !== "Backspace")) return;
    if ((event.target as HTMLElement).closest?.("input, textarea")) return;
    event.preventDefault();
    editor.remove(id);
    setSelected(null);
  });

  onMount(() => {
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    canvas!.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => canvas?.removeEventListener("wheel", onWheel));

    requestAnimationFrame(() => requestAnimationFrame(() => {
      fit();
      setReady(true);
    }));
  });

  function measure(key: string, element: HTMLElement) {
    const observer = new ResizeObserver(() => setHeights(key, element.offsetHeight));
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  }

  function TagNode(nodeProps: { entry: TagEntry }) {
    const id = nodeProps.entry.id;
    const parent = createMemo(() => editor.parents().get(id) ?? null);
    const inList = createMemo(() => parent()?.kind === "array");
    const label = createMemo(() => entryLabel(nodeProps.entry, parent()));
    const container = createMemo(() => isContainer(nodeProps.entry.kind));
    const hiddenCount = createMemo(() => !nodeProps.entry.expanded ? nodeProps.entry.children.length : 0);
    const change = createMemo(() => editor.changeOf(id));
    const style = createMemo(() => {
      const point = positions().get(id) ?? { x: 0, y: 0 };
      return { left: `${point.x}px`, top: `${point.y}px` };
    });

    return (
      <div
        ref={element => measure(String(id), element)}
        class={styles.Node}
        classList={{
          [styles.Selected]: selected() === id,
          [styles.Invalid]: editor.errors().has(id),
          [styles.Dragged]: draggedIds()?.has(id) ?? false,
          [styles.Drop]: dropTarget() === id,
        }}
        style={style()}
        data-node-id={id}
      >
        <span class={styles.PortIn} />
        <div class={styles.Head}>
          <span class={styles.KindIcon} classList={{ [styles.ContainerKind]: container() }}><Dynamic component={KIND_ICONS[nodeProps.entry.kind]} size={14} /></span>
          <Show when={!inList()} fallback={<span class={styles.Index}>{label()}</span>}>
            <TagNameInput entry={nodeProps.entry} />
          </Show>
          <span class={styles.Mark} classList={{ [styles.New]: change() === "new", [styles.Changed]: change() === "changed" }} />
          <Button isIcon size="sm" variant="danger" class={styles.Remove} tooltip="Remove" tooltipKeys={["Del"]} onClick={() => editor.remove(id)}>
            <X size={14} />
          </Button>
        </div>
        <div class={styles.Body}>
          <Select variant="bare" class={styles.KindSelect} value={nodeProps.entry.kind} items={KIND_ITEMS} onItemClick={item => editor.setKind(id, item.value)} />
          <TagValueEditor entry={nodeProps.entry} />
        </div>
        <Show when={container()}>
          <button
            type="button"
            class={styles.PortOut}
            aria-label={nodeProps.entry.kind === "array" ? "Add item" : "Add tag"}
            onClick={() => add(id)}
          >
            <Show when={hiddenCount() > 0} fallback={<Plus size={13} />}>
              <span class={styles.Count}>{hiddenCount()}</span>
            </Show>
          </button>
        </Show>
      </div>
    );
  }

  return (
    <div
      ref={canvas}
      class={styles.Canvas}
      classList={{ [styles.Panning]: panning() }}
      style={canvasStyle()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div class={styles.World} classList={{ [styles.Ready]: ready() }} style={worldStyle()}>
        <svg class={styles.Edges}>
          <Index each={edges()}>{edge => <path d={edge().d} classList={{ [styles.Hot]: edge().hot }} />}</Index>
        </svg>

        <div
          ref={element => measure("root", element)}
          class={`${styles.Node} ${styles.Root}`}
          classList={{ [styles.Selected]: selected() === "root", [styles.Drop]: dropTarget() === "root" }}
          style={rootStyle()}
          data-node-id="root"
        >
          <div class={styles.Thumb}>
            <Show when={thumbUrl()} fallback={<File size={22} />}>
              {url => <img src={url()} draggable={false} />}
            </Show>
          </div>
          <div class={styles.RootName}>{props.fileName}</div>
          <div class={styles.RootMeta}>{tagCount()}</div>
          <button type="button" class={styles.PortOut} aria-label="Add tag" onClick={() => add(null)}>
            <Plus size={13} />
          </button>
        </div>

        <For each={visible()}>{entry => <TagNode entry={entry} />}</For>
      </div>

      <div class={styles.Hint} data-canvas-overlay>
        Drag a tag onto a group or list to move it there. Drop it on its own parent to put it back.
      </div>
      <div class={styles.Controls} data-canvas-overlay>
        <Button isIcon size="sm" variant="ghost" tooltip="Zoom out" onClick={() => zoomCenter(1 / 1.2)}><Minus size={14} /></Button>
        <span class={styles.Zoom}>{zoomLabel()}</span>
        <Button isIcon size="sm" variant="ghost" tooltip="Zoom in" onClick={() => zoomCenter(1.2)}><Plus size={14} /></Button>
        <span class={styles.Divider} />
        <Button isIcon size="sm" variant="ghost" tooltip="Fit to view" onClick={fit}><Maximize size={14} /></Button>
        <Button isIcon size="sm" variant="ghost" tooltip="Tidy up" onClick={tidy}><Network size={14} /></Button>
      </div>
    </div>
  );
}

export default TagNodeView;
