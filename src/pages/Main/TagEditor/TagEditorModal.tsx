import styles from "./TagEditorModal.module.scss";
import { batch, createEffect, createMemo, createSignal, Match, on, onCleanup, Show, Switch } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { makeEventListener } from "@solid-primitives/event-listener";
import { CircleAlert, Network, Plus, Rows3, Tags, Undo2 } from "lucide-solid";
import Modal from "../../../components/Modal/Modal";
import Button from "../../../components/Button/Button";
import Segmented from "../../../components/Segmented/Segmented";
import EmptyState from "../../../components/EmptyState/EmptyState";
import { safeInvoke } from "../../../helpers/safeInvoke";
import { describeUploaderError } from "../../../components/UploaderCreator/UploaderCreator";
import { ImageHistoryData, TagValue, TagValueTypeMap } from "../../../types";
import {
  cloneEntries, collectKeyErrors, defaultScalarFor, entriesSignature, entriesToObject, entryLabel, findEntry, findParentList, isContainer,
  makeEntry, namePath, NameSuggestion, nameSuggestions, newListItem, parentsById, schemaAt, subtreeIds, TagEntry, tagsToEntries, walkEntries,
} from "./tagEntry";
import { EntryChange, TagEditorApi, TagEditorContext } from "./tagEditorContext";
import TagNodeView from "./TagNodeView";
import TagTableView from "./TagTableView";

type View = "nodes" | "table";
type Original = { key: string, kind: string, scalar: string | number | boolean, parent: number | null };

const NAME_REQUIRED = "Name required";
const NOTICE_MS = 6000;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function focusValue(id: number) {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-tag-value="${id}"] input, [data-tag-value="${id}"] button`)?.focus({ preventScroll: true });
  });
}

function TagEditorModal(props: {
  screenshot: ImageHistoryData | null,
  schema: TagValueTypeMap | null,
  onHide: () => void,
  onSaved: (fileName: string, tags: { [key: string]: TagValue } | null) => void,
}) {
  const viewItems = [
    { id: "nodes" as const, label: <span class={styles.ViewLabel}><Network size={13} />Nodes</span> },
    { id: "table" as const, label: <span class={styles.ViewLabel}><Rows3 size={13} />Table</span> },
  ];
  const [entries, setEntries] = createStore<TagEntry[]>([]);
  const [original, setOriginal] = createSignal(new Map<number, Original>());
  const [originalSignature, setOriginalSignature] = createSignal("");
  const [undoStack, setUndoStack] = createSignal<TagEntry[][]>([]);
  const [touched, setTouched] = createSignal(new Set<number>());
  const [view, setView] = createSignal<View>("nodes");
  const [confirming, setConfirming] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(on(() => props.screenshot, screenshot => {
    const loaded = screenshot ? tagsToEntries(screenshot.tags) : [];
    const snapshot = new Map<number, Original>();
    walkEntries(loaded, (entry, parent) => snapshot.set(entry.id, { key: entry.key, kind: entry.kind, scalar: entry.scalar, parent: parent?.id ?? null }));
    batch(() => {
      setEntries(loaded);
      setOriginal(snapshot);
      setOriginalSignature(entriesSignature(loaded));
      setUndoStack([]);
      setTouched(new Set<number>());
      setView("nodes");
      setConfirming(false);
      setSaveError(null);
      setNotice(null);
    });
  }));

  onCleanup(() => clearTimeout(noticeTimer));

  const parents = createMemo(() => parentsById(entries));
  const allErrors = createMemo(() => {
    const out = new Map<number, string>();
    collectKeyErrors(entries, true, out);
    return out;
  });
  const shownErrors = createMemo(() => {
    const seen = touched();
    return new Map([...allErrors()].filter(([id, message]) => message !== NAME_REQUIRED || seen.has(id)));
  });
  const pendingNames = createMemo(() => allErrors().size - shownErrors().size);
  const dirty = createMemo(() => entriesSignature(entries) !== originalSignature());
  const counts = createMemo(() => {
    const before = original();
    const present = new Set<number>();
    let added = 0, changed = 0;
    walkEntries(entries, entry => {
      present.add(entry.id);
      const change = changeOf(entry.id);
      if (change === "new") added++;
      else if (change === "changed") changed++;
    });
    const removed = [...before.keys()].filter(id => !present.has(id)).length;
    return { added, changed, removed };
  });
  const canSave = createMemo(() => !saving() && dirty() && allErrors().size === 0);
  const title = createMemo(() => props.screenshot?.fileName ?? "");
  const isEmptyTable = createMemo(() => view() === "table" && entries.length === 0);

  function changeOf(id: number): EntryChange {
    const before = original().get(id);
    if (!before) return "new";
    const entry = findEntry(entries, id);
    if (!entry) return "";
    const parent = parents().get(id)?.id ?? null;
    const same = before.key === entry.key && before.kind === entry.kind && before.scalar === entry.scalar && before.parent === parent;
    return same ? "" : "changed";
  }

  function remember() {
    setUndoStack(stack => [...stack, cloneEntries(unwrap(entries))]);
  }

  function undo() {
    const stack = undoStack();
    const last = stack[stack.length - 1];
    if (!last) return;
    batch(() => {
      setUndoStack(stack.slice(0, -1));
      setEntries(cloneEntries(last));
      setNotice(null);
    });
  }

  function showNotice(message: string) {
    clearTimeout(noticeTimer);
    setNotice(message);
    noticeTimer = setTimeout(() => setNotice(null), NOTICE_MS);
  }

  function edit(id: number, update: (entry: TagEntry) => void) {
    setEntries(produce(draft => {
      const entry = findEntry(draft, id);
      if (entry) update(entry);
    }));
  }

  function touch(id: number) {
    if (touched().has(id)) return;
    setTouched(previous => new Set(previous).add(id));
  }

  function suggestionsFor(id: number): NameSuggestion[] {
    const map = schemaAt(props.schema, namePath(id, parents()));
    const siblings = findParentList(entries, id) ?? [];
    const used = new Set(siblings.filter(entry => entry.id !== id).map(entry => entry.key.trim().toLowerCase()));
    return nameSuggestions(map).filter(item => !used.has(item.key.toLowerCase()));
  }

  const api: TagEditorApi = {
    entries,
    parents,
    errors: shownErrors,
    changeOf,
    suggestionsFor,
    touch,
    setKey: (id, key) => edit(id, entry => { entry.key = key; }),
    setScalar: (id, value) => edit(id, entry => { entry.scalar = value; }),
    toggleExpanded: id => edit(id, entry => { entry.expanded = !entry.expanded; }),
    setKind: (id, kind) => {
      remember();
      edit(id, entry => {
        entry.kind = kind;
        entry.scalar = defaultScalarFor(kind);
        entry.children = [];
        if (isContainer(kind)) entry.expanded = true;
      });
    },
    pickName: (id, suggestion) => {
      const entry = findEntry(entries, id);
      if (!entry) return;
      const retype = entry.kind !== suggestion.kind;
      if (retype) remember();
      edit(id, draft => {
        draft.key = suggestion.key;
        if (!retype) return;
        draft.kind = suggestion.kind;
        draft.scalar = defaultScalarFor(suggestion.kind);
        draft.expanded = true;
        draft.children = suggestion.kind === "object"
          ? nameSuggestions(suggestion.schema).map(child => makeEntry(child.key, child.kind))
          : [];
      });
      touch(id);
      focusValue(id);
    },
    addChild: parentId => {
      remember();
      const parent = parentId === null ? null : findEntry(entries, parentId);
      const created = parent?.kind === "array"
        ? newListItem(parent, props.schema, namePath(parent.id, parents()))
        : makeEntry("");
      setEntries(produce(draft => {
        if (parentId === null) return void draft.push(created);
        const target = findEntry(draft, parentId);
        if (!target) return;
        target.children.push(created);
        target.expanded = true;
      }));
      return created.id;
    },
    remove: id => {
      const entry = findEntry(entries, id);
      if (!entry) return;
      const label = entryLabel(entry, parents().get(id) ?? null);
      const inside = subtreeIds(entry).size - 1;
      remember();
      setEntries(produce(draft => {
        const list = findParentList(draft, id);
        const index = list?.findIndex(item => item.id === id) ?? -1;
        if (list && index >= 0) list.splice(index, 1);
      }));
      showNotice(`Removed ${label}${inside ? ` and ${plural(inside, "tag")} inside` : ""}`);
    },
    move: (id, parentId) => {
      const entry = findEntry(entries, id);
      if (!entry) return false;
      if (parentId !== null) {
        const target = findEntry(entries, parentId);
        if (!target || !isContainer(target.kind) || subtreeIds(entry).has(parentId)) return false;
      }
      remember();
      setEntries(produce(draft => {
        const from = findParentList(draft, id);
        const index = from?.findIndex(item => item.id === id) ?? -1;
        if (!from || index < 0) return;
        const [moved] = from.splice(index, 1);
        if (parentId === null) return void draft.push(moved);
        const target = findEntry(draft, parentId)!;
        target.children.push(moved);
        target.expanded = true;
      }));
      // A list item has no name, so moving it into a group needs one right away.
      const landed = parentId === null ? null : findEntry(entries, parentId);
      if (landed?.kind !== "array") touch(id);
      return true;
    },
  };

  function requestClose() {
    if (confirming()) return;
    if (dirty()) setConfirming(true);
    else props.onHide();
  }

  function discard() {
    setConfirming(false);
    props.onHide();
  }

  async function save() {
    const screenshot = props.screenshot;
    if (!screenshot || !canSave()) return;

    setSaving(true);
    setSaveError(null);
    try {
      const tags = entriesToObject(entries);
      const payloadTags = Object.keys(tags).length > 0 ? tags : null;
      const updated = await safeInvoke("update_history_tags", { fileName: screenshot.fileName, tags: payloadTags });
      props.onSaved(screenshot.fileName, updated.tags);
      props.onHide();
    } catch (err) {
      setSaveError(typeof err === "string" ? err : describeUploaderError(err));
    } finally {
      setSaving(false);
    }
  }

  makeEventListener(window, "keydown", event => {
    if (!props.screenshot || confirming()) return;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
      return;
    }
    if (event.key.toLowerCase() === "z" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
      if ((event.target as HTMLElement).closest?.("input, textarea")) return;
      event.preventDefault();
      undo();
    }
  });

  return <TagEditorContext.Provider value={api}>
    <Modal
      show={!!props.screenshot}
      onHide={requestClose}
      title={<span class={styles.Title}>Tags<span class={styles.FileName}>{title()}</span></span>}
      headerActions={<Segmented size="sm" items={viewItems} value={view()} onChange={setView} />}
      width="min(1120px, 100%)"
      height="100%"
      footer={<>
        <div class={styles.Status}>
          <Switch fallback={<span>No changes</span>}>
            <Match when={saveError()}>
              {message => <span class={styles.Error}><CircleAlert size={14} />{message()}</span>}
            </Match>
            <Match when={shownErrors().size > 0}>
              <span class={styles.Error}><CircleAlert size={14} />{plural(shownErrors().size, "name")} to fix</span>
            </Match>
            <Match when={notice()}>
              {message => <span>{message()}</span>}
            </Match>
            <Match when={pendingNames() > 0}>
              <span>{pendingNames() === 1 ? "Name the new tag to save" : `Name the ${pendingNames()} new tags to save`}</span>
            </Match>
            <Match when={dirty()}>
              <Show when={counts().added > 0}><span class={styles.Legend}><i class={styles.New} />{counts().added} new</span></Show>
              <Show when={counts().changed > 0}><span class={styles.Legend}><i class={styles.Changed} />{counts().changed} changed</span></Show>
              <Show when={counts().removed > 0}><span class={styles.Legend}><i class={styles.Removed} />{counts().removed} removed</span></Show>
            </Match>
          </Switch>
        </div>
        <Button size="sm" variant="ghost" disabled={undoStack().length === 0} tooltip="Undo" tooltipKeys={["Ctrl", "Z"]} onClick={undo}>
          <Undo2 size={14} />Undo
        </Button>
        <Button onClick={requestClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave()} tooltip="Save" tooltipKeys={["Ctrl", "Enter"]} onClick={save}>
          {saving() ? "Saving…" : "Save"}
        </Button>
      </>}
    >
      <div class={styles.Body}>
        <Switch>
          <Match when={isEmptyTable()}>
            <div class={styles.Empty}>
              <EmptyState
                icon={<Tags size={20} />}
                title="No tags yet"
                action={<Button size="sm" onClick={() => api.addChild(null)}><Plus size={14} />Add tag</Button>}
              >
                Tags make this capture easy to find with search and filters.
              </EmptyState>
            </div>
          </Match>
          <Match when={view() === "table"}>
            <TagTableView />
          </Match>
          <Match when={view() === "nodes" && props.screenshot}>
            {screenshot => <TagNodeView fileName={screenshot().fileName} itemType={screenshot().type} />}
          </Match>
        </Switch>
      </div>
    </Modal>
    <Modal
      show={confirming()}
      onHide={() => setConfirming(false)}
      title="Discard changes?"
      width={380}
      footer={<>
        <Button onClick={() => setConfirming(false)}>Keep editing</Button>
        <Button variant="danger-solid" onClick={discard}>Discard</Button>
      </>}
    >
      <p>Your changes to the tags on this capture will be lost.</p>
    </Modal>
  </TagEditorContext.Provider>;
}

export default TagEditorModal;
