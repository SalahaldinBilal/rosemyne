import styles from "./TagEditorModal.module.scss";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { createStore, produce } from "solid-js/store";
import Modal from "../../../components/Modal/Modal";
import Button from "../../../components/Button/Button";
import Select from "../../../components/Select/Select";
import Input from "../../../components/Input/Input";
import DurationField from "../TagFilter/controls/DurationField";
import FilterValueField from "../TagFilter/controls/FilterValueField";
import { safeInvoke } from "../../../helpers/safeInvoke";
import { dateTimeLocalToMs, msToDateTimeLocal } from "../../../helpers";
import { describeUploaderError } from "../../../components/UploaderCreator/UploaderCreator";
import { ImageHistoryData, TagValue } from "../../../types";
import { BOOLEAN_ITEMS, collectKeyErrors, defaultScalarFor, entriesToObject, findEntry, findParentList, KIND_ITEMS, makeEntry, TagEntry, TagKind, tagsToEntries } from "./tagEntry";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-solid";

// FilterValueField only fetches suggestions for number/string paths , inert for datetime-local, so no real path is needed.
const NO_SUGGESTION_PATH: string[] = [];

const ICON_STYLE = { height: "28px", width: "28px", "min-width": "28px" } as const;
const KEY_STYLE = { flex: "0 1 160px", "min-width": "100px" } as const;
const KIND_STYLE = { flex: "0 0 120px" } as const;
const VALUE_STYLE = { flex: "1 1 auto", "min-width": "100px" } as const;
// Past this, the value overflows to Infinity, which JSON serializes as null , silently turning the tag empty.
const NUMBER_MIN = -Number.MAX_VALUE;
const NUMBER_MAX = Number.MAX_VALUE;

type Actions = {
  setKey: (id: number, key: string) => void,
  setKind: (id: number, kind: TagKind) => void,
  setScalar: (id: number, value: string | number | boolean) => void,
  toggleExpanded: (id: number) => void,
  addChild: (id: number) => void,
  remove: (id: number) => void,
};

function TagEntryRow(props: { entry: TagEntry, showKey: boolean, topLevel: boolean, errors: Map<number, string>, actions: Actions }) {
  const isContainer = createMemo(() => props.entry.kind === "object" || props.entry.kind === "array");
  const error = createMemo(() => props.errors.get(props.entry.id));

  return <div class={styles.Entry}>
    <div class={styles.Row}>
      <Show when={isContainer()} fallback={<div class={styles.ExpandSpacer} />}>
        <Button isIcon style={ICON_STYLE} onClick={() => props.actions.toggleExpanded(props.entry.id)}>
          {props.entry.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </Button>
      </Show>
      <Show when={props.showKey}>
        <Input
          style={KEY_STYLE}
          value={props.entry.key}
          placeholder={props.topLevel ? "Tag name" : "Key"}
          onChange={event => props.actions.setKey(props.entry.id, event.currentTarget.value)}
        />
      </Show>
      <Select style={KIND_STYLE} value={props.entry.kind} items={KIND_ITEMS} onItemClick={item => props.actions.setKind(props.entry.id, item.value)} />
      <Switch>
        <Match when={props.entry.kind === "string"}>
          <Input style={VALUE_STYLE} value={props.entry.scalar as string} onChange={event => props.actions.setScalar(props.entry.id, event.currentTarget.value)} />
        </Match>
        <Match when={props.entry.kind === "number"}>
          <Input style={VALUE_STYLE} type="number" min={NUMBER_MIN} max={NUMBER_MAX} value={props.entry.scalar as number} onChange={event => props.actions.setScalar(props.entry.id, Number(event.currentTarget.value))} />
        </Match>
        <Match when={props.entry.kind === "boolean"}>
          <Select style={VALUE_STYLE} value={String(props.entry.scalar)} items={BOOLEAN_ITEMS} onItemClick={item => props.actions.setScalar(props.entry.id, item.value)} />
        </Match>
        <Match when={props.entry.kind === "time"}>
          <div style={VALUE_STYLE}>
            <DurationField valueMs={props.entry.scalar as number} onChange={ms => props.actions.setScalar(props.entry.id, ms)} />
          </div>
        </Match>
        <Match when={props.entry.kind === "dateTime"}>
          <div style={VALUE_STYLE}>
            <FilterValueField
              type="datetime-local"
              path={NO_SUGGESTION_PATH}
              value={msToDateTimeLocal(props.entry.scalar as number)}
              onChange={raw => props.actions.setScalar(props.entry.id, dateTimeLocalToMs(raw))}
            />
          </div>
        </Match>
        <Match when={props.entry.kind === "null"}>
          <span class={styles.NullLabel} style={VALUE_STYLE}>null</span>
        </Match>
      </Switch>
      <Button isIcon color="var(--danger-color)" style={ICON_STYLE} tooltip="Remove" onClick={() => props.actions.remove(props.entry.id)}>
        <Trash2 size={14} />
      </Button>
    </div>
    <Show when={error()}>{message => <div class={styles.Error}>{message()}</div>}</Show>
    <Show when={isContainer() && props.entry.expanded}>
      <div class={styles.Nested}>
        <TagEntryList
          entries={props.entry.children}
          parentKind={props.entry.kind as "object" | "array"}
          topLevel={false}
          errors={props.errors}
          actions={props.actions}
          onAdd={() => props.actions.addChild(props.entry.id)}
        />
      </div>
    </Show>
  </div>;
}

function TagEntryList(props: { entries: TagEntry[], parentKind: "object" | "array", topLevel: boolean, errors: Map<number, string>, actions: Actions, onAdd: () => void }) {
  return <div class={styles.List}>
    <For each={props.entries}>
      {entry => <TagEntryRow entry={entry} showKey={props.parentKind === "object"} topLevel={props.topLevel} errors={props.errors} actions={props.actions} />}
    </For>
    <Button style={{ "align-self": "flex-start" }} onClick={props.onAdd}>
      <Plus size={14} />
      {props.parentKind === "object" ? "Add tag" : "Add item"}
    </Button>
  </div>;
}

function TagEditorModal(props: {
  screenshot: ImageHistoryData | null,
  onHide: () => void,
  onSaved: (fileName: string, tags: { [key: string]: TagValue } | null) => void,
}) {
  const [entries, setEntries] = createStore<TagEntry[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(on(() => props.screenshot, screenshot => {
    setEntries(screenshot ? tagsToEntries(screenshot.tags) : []);
    setError(null);
  }));

  function edit(id: number, update: (entry: TagEntry) => void) {
    setEntries(produce(draft => {
      const entry = findEntry(draft, id);
      if (entry) update(entry);
    }));
  }

  const actions: Actions = {
    setKey: (id, key) => edit(id, entry => { entry.key = key; }),
    setScalar: (id, value) => edit(id, entry => { entry.scalar = value; }),
    toggleExpanded: id => edit(id, entry => { entry.expanded = !entry.expanded; }),
    setKind: (id, kind) => edit(id, entry => {
      entry.kind = kind;
      entry.scalar = defaultScalarFor(kind);
      entry.children = [];
      if (kind === "object" || kind === "array") entry.expanded = true;
    }),
    addChild: id => edit(id, entry => {
      if (entry.kind !== "object" && entry.kind !== "array") return;
      entry.children.push(makeEntry(""));
      entry.expanded = true;
    }),
    remove: id => setEntries(produce(draft => {
      const list = findParentList(draft, id);
      if (!list) return;
      const index = list.findIndex(entry => entry.id === id);
      if (index >= 0) list.splice(index, 1);
    })),
  };

  function addTopLevel() {
    setEntries(produce(draft => { draft.push(makeEntry("")); }));
  }

  const errors = createMemo(() => {
    const out = new Map<number, string>();
    collectKeyErrors(entries, true, out);
    return out;
  });
  const hasErrors = createMemo(() => errors().size > 0);

  async function save() {
    const screenshot = props.screenshot;
    if (!screenshot || hasErrors()) return;

    setSaving(true);
    setError(null);
    try {
      const tags = entriesToObject(entries);
      const payloadTags = Object.keys(tags).length > 0 ? tags : null;
      const updated = await safeInvoke("update_history_tags", { fileName: screenshot.fileName, tags: payloadTags });
      props.onSaved(screenshot.fileName, updated.tags);
      props.onHide();
    } catch (err) {
      setError(typeof err === "string" ? err : describeUploaderError(err));
    } finally {
      setSaving(false);
    }
  }

  const title = createMemo(() => props.screenshot ? `Edit tags , ${props.screenshot.fileName}` : "");

  return <Modal show={!!props.screenshot} onHide={props.onHide} title={title()} width={640} height="75%">
    <div class={styles.Body}>
      <div class={styles.Scroll}>
        <TagEntryList entries={entries} parentKind="object" topLevel errors={errors()} actions={actions} onAdd={addTopLevel} />
      </div>
      <Show when={error()}>{message => <div class={styles.ErrorBanner}>{message()}</div>}</Show>
      <div class={styles.Footer}>
        <Button onClick={props.onHide}>Cancel</Button>
        <Button filled color="var(--base-blue)" disabled={saving() || hasErrors()} onClick={save}>
          {saving() ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  </Modal>;
}

export default TagEditorModal;
