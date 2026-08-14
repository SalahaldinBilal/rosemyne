import { createMemo, createSignal, untrack } from "solid-js";
import { DrawStroke, ImageOverlay } from "../types/imageOverlay";

const MERGE_WINDOW_MS = 600;

export type AnnotationSnapshot = {
  items: ImageOverlay[],
  strokes: DrawStroke[],
};

function snapshotsEqual(a: AnnotationSnapshot, b: AnnotationSnapshot) {
  return a.strokes.length === b.strokes.length
    && a.strokes.every((stroke, i) => stroke === b.strokes[i])
    && JSON.stringify(a.items) === JSON.stringify(b.items);
}

export function createAnnotationHistory(
  capture: () => AnnotationSnapshot,
  restore: (snapshot: AnnotationSnapshot) => void,
) {
  let entries: AnnotationSnapshot[] = [capture()];
  const [index, setIndex] = createSignal(0);
  const [count, setCount] = createSignal(1);
  let openMergeKey: string | null = null;
  let mergeDeadline = 0;

  const canUndo = createMemo(() => index() > 0);
  const canRedo = createMemo(() => index() < count() - 1);

  // All three untracked: callers include effects (e.g. the tool-switch cleanup
  // path), which must not subscribe to history state through these reads.
  function commit(mergeKey?: string) {
    untrack(() => {
      const snapshot = capture();
      if (snapshotsEqual(snapshot, entries[index()])) return;

      const now = Date.now();
      const merge = mergeKey !== undefined && mergeKey === openMergeKey
        && now <= mergeDeadline && index() > 0 && index() === count() - 1;

      if (merge) {
        entries[index()] = snapshot;
      } else {
        entries = entries.slice(0, index() + 1);
        entries.push(snapshot);
        setIndex(entries.length - 1);
        setCount(entries.length);
      }

      openMergeKey = mergeKey ?? null;
      mergeDeadline = now + MERGE_WINDOW_MS;
    });
  }

  function undo() {
    untrack(() => {
      if (!canUndo()) return;
      openMergeKey = null;
      setIndex(i => i - 1);
      restore(entries[index()]);
    });
  }

  function redo() {
    untrack(() => {
      if (!canRedo()) return;
      openMergeKey = null;
      setIndex(i => i + 1);
      restore(entries[index()]);
    });
  }

  function rebaseline() {
    entries = [capture()];
    setIndex(0);
    setCount(1);
    openMergeKey = null;
  }

  function patchAll(patch: (snapshot: AnnotationSnapshot) => void) {
    entries.forEach(patch);
  }

  return { commit, undo, redo, canUndo, canRedo, rebaseline, patchAll };
}

export type AnnotationHistory = ReturnType<typeof createAnnotationHistory>;
