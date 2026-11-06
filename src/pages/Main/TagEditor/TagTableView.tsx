import styles from "./TagTableView.module.scss";
import { createEffect, createMemo, createSignal, For, JSX, Show } from "solid-js";
import { ArrowLeft, ChevronRight, CornerDownRight, Plus, X } from "lucide-solid";
import Button from "../../../components/Button/Button";
import Select from "../../../components/Select/Select";
import { entryLabel, findEntry, isContainer, KIND_ITEMS, TagEntry } from "./tagEntry";
import { focusEntry, useTagEditor } from "./tagEditorContext";
import TagNameInput from "./TagNameInput";
import TagValueEditor from "./TagValueEditor";

// Groups nest inline up to this depth. Deeper ones open as their own view, so the name column never runs out of room.
const MAX_DEPTH = 3;

function depthStyle(depth: number): JSX.CSSProperties {
  return { "--depth": depth };
}

function TagTableView() {
  const editor = useTagEditor();
  const [focusId, setFocusId] = createSignal<number | null>(null);
  const focused = createMemo(() => {
    const id = focusId();
    return id === null ? null : findEntry(editor.entries, id);
  });
  const crumbs = createMemo(() => {
    const parents = editor.parents();
    const chain: TagEntry[] = [];
    for (let entry = focused(); entry; entry = parents.get(entry.id) ?? null) chain.unshift(entry);
    return chain.map(entry => ({ id: entry.id, label: entryLabel(entry, parents.get(entry.id) ?? null) }));
  });
  const rootList = createMemo(() => focused()?.children ?? editor.entries);
  const rootInList = createMemo(() => focused()?.kind === "array");
  const headerStyle = createMemo(() => depthStyle(0));

  // An undo can take away the group being viewed.
  createEffect(() => {
    if (focusId() !== null && !focused()) setFocusId(null);
  });

  function add(parent: number | null) {
    focusEntry(editor.addChild(parent));
  }

  function Row(props: { entry: TagEntry, depth: number, inList: boolean, index: number }) {
    const container = createMemo(() => isContainer(props.entry.kind));
    const atLimit = createMemo(() => props.depth >= MAX_DEPTH);
    const change = createMemo(() => editor.changeOf(props.entry.id));
    const rowStyle = createMemo(() => depthStyle(props.depth));
    const drillHint = createMemo(() => atLimit() ? "Open" : undefined);

    return <>
      <div class={styles.Row} style={rowStyle()}>
        <span class={styles.Mark} classList={{ [styles.New]: change() === "new", [styles.Changed]: change() === "changed" }} />
        <div class={styles.KeyCell}>
          <Show when={container()} fallback={<span class={styles.Chevron} />}>
            <Show
              when={!atLimit()}
              fallback={
                <button type="button" class={`${styles.Chevron} ${styles.Drill}`} aria-label="Open" onClick={() => setFocusId(props.entry.id)}>
                  <CornerDownRight size={13} />
                </button>
              }
            >
              <button
                type="button"
                class={styles.Chevron}
                classList={{ [styles.Expanded]: props.entry.expanded }}
                aria-label={props.entry.expanded ? "Collapse" : "Expand"}
                onClick={() => editor.toggleExpanded(props.entry.id)}
              >
                <ChevronRight size={14} />
              </button>
            </Show>
          </Show>
          <Show when={!props.inList} fallback={<span class={styles.Index}>Item {props.index + 1}</span>}>
            <TagNameInput entry={props.entry} />
          </Show>
        </div>
        <Select variant="bare" class={styles.Kind} value={props.entry.kind} items={KIND_ITEMS} onItemClick={item => editor.setKind(props.entry.id, item.value)} />
        <TagValueEditor
          entry={props.entry}
          summaryHint={drillHint()}
          onSummaryClick={atLimit() ? () => setFocusId(props.entry.id) : undefined}
        />
        <Button isIcon size="sm" variant="danger" class={styles.Remove} tooltip="Remove" onClick={() => editor.remove(props.entry.id)}>
          <X size={14} />
        </Button>
      </div>
      <Show when={container() && props.entry.expanded && !atLimit()}>
        <div class={styles.Nested}>
          <List entries={props.entry.children} depth={props.depth + 1} inList={props.entry.kind === "array"} parentId={props.entry.id} />
        </div>
      </Show>
    </>;
  }

  function List(props: { entries: TagEntry[], depth: number, inList: boolean, parentId: number | null }) {
    return <>
      <For each={props.entries}>
        {(entry, index) => <Row entry={entry} depth={props.depth} inList={props.inList} index={index()} />}
      </For>
      <div class={styles.AddRow}>
        <Button size="xs" variant="ghost" onClick={() => add(props.parentId)}>
          <Plus size={13} />
          {props.inList ? "Add item" : "Add tag"}
        </Button>
      </div>
    </>;
  }

  return (
    <div class={styles.Table}>
      <Show when={focused()}>
        <div class={styles.Crumbs}>
          <button type="button" onClick={() => setFocusId(null)}><ArrowLeft size={13} />All tags</button>
          <For each={crumbs()}>{(crumb, index) => <>
            <ChevronRight size={12} />
            <Show when={index() < crumbs().length - 1} fallback={<b>{crumb.label}</b>}>
              <button type="button" onClick={() => setFocusId(crumb.id)}>{crumb.label}</button>
            </Show>
          </>}</For>
        </div>
      </Show>
      <div class={styles.Scroll}>
        <div class={`${styles.Row} ${styles.Header}`} style={headerStyle()}>
          <span class={styles.HeaderKey}>Name</span>
          <span>Type</span>
          <span>Value</span>
          <span />
        </div>
        <List entries={rootList()} depth={0} inList={rootInList()} parentId={focused()?.id ?? null} />
      </div>
    </div>
  );
}

export default TagTableView;
