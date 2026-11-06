import styles from "./TagPicker.module.scss";
import { createEffect, createMemo, createSignal, For, JSX, onCleanup, onMount, Show } from "solid-js";
import { Dynamic, Portal } from "solid-js/web";
import { Calendar, ChevronDown, HardDrive, Hash, LucideIcon, Search, Timer, ToggleLeft, Type } from "lucide-solid";
import { FilterValueType, TagValueTypeMap } from "../../../../types";
import { keyLabel, leafPaths, tagPathKey, valueTypeAtPath } from "../../../../states/tagFilterState";
import { KIND_LABELS } from "../filterOperations";
import Tooltip from "../../../../components/Tooltip/Tooltip";

const KIND_ICONS: Record<FilterValueType, LucideIcon> = {
  string: Type,
  number: Hash,
  dateTime: Calendar,
  byteSize: HardDrive,
  time: Timer,
  boolean: ToggleLeft,
};

const POPUP_WIDTH = 340;
const POPUP_MARGIN = 6;
const CLOSE_DURATION = 110;
const TOP_LEVEL_GROUP = "Capture";

type Entry = { path: string[], key: string, group: string, name: string, full: string, valueType: FilterValueType };

function groupOf(path: string[]): string {
  return path.length > 1 ? path.slice(0, -1).map(keyLabel).join(" › ") : TOP_LEVEL_GROUP;
}

function highlighted(name: string, query: string): JSX.Element {
  const at = query ? name.toLowerCase().indexOf(query) : -1;
  if (at < 0) return name;
  return <>{name.slice(0, at)}<mark>{name.slice(at, at + query.length)}</mark>{name.slice(at + query.length)}</>;
}

function TagPicker(props: {
  tagMap: TagValueTypeMap,
  path: string[],
  onPick: (path: string[]) => void,
  autoOpen?: boolean,
  onAutoOpened?: () => void,
}) {
  const [open, setOpen] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal(0);
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});
  let button: HTMLButtonElement | undefined;
  let popup: HTMLDivElement | undefined;
  let list: HTMLDivElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const entries = createMemo<Entry[]>(() => {
    const all = leafPaths(props.tagMap).map(leaf => {
      const group = groupOf(leaf.path);
      const name = keyLabel(leaf.path[leaf.path.length - 1]);
      return { path: leaf.path, key: tagPathKey(leaf.path), group, name, full: `${group} › ${name}`, valueType: leaf.valueType };
    });
    // Groups in first-seen order, so a nested object's leaves don't split their parent's group in two.
    const groupOrder = [...new Set(all.map(entry => entry.group))];
    return groupOrder.flatMap(group => all.filter(entry => entry.group === group));
  });
  const selectedKey = createMemo(() => tagPathKey(props.path));
  const normalizedQuery = createMemo(() => query().trim().toLowerCase());
  const matches = createMemo(() => entries().filter(entry => entry.full.toLowerCase().includes(normalizedQuery())));
  const label = createMemo(() => props.path.map(keyLabel).join(" › "));
  const valueType = createMemo(() => valueTypeAtPath(props.tagMap, props.path));
  const icon = createMemo(() => KIND_ICONS[valueType() ?? "string"]);

  function show() {
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const estimatedHeight = 320;
    const upwards = rect.bottom + estimatedHeight > window.innerHeight && rect.top > estimatedHeight;

    clearTimeout(closeTimer);
    setQuery("");
    setHighlight(Math.max(0, entries().findIndex(entry => entry.key === selectedKey())));
    setPopupStyle({
      left: Math.max(8, Math.min(window.innerWidth - POPUP_WIDTH - 8, rect.left)) + "px",
      ...(upwards
        ? { bottom: (window.innerHeight - rect.top + POPUP_MARGIN) + "px", "transform-origin": "bottom left" }
        : { top: (rect.bottom + POPUP_MARGIN) + "px", "transform-origin": "top left" }),
    });
    setMounted(true);
    setOpen(true);
  }

  function hide() {
    if (!open()) return;
    setOpen(false);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setMounted(false), CLOSE_DURATION);
  }

  onCleanup(() => clearTimeout(closeTimer));

  onMount(() => {
    if (!props.autoOpen) return;
    requestAnimationFrame(show);
    props.onAutoOpened?.();
  });

  function pick(entry: Entry) {
    hide();
    props.onPick(entry.path);
  }

  createEffect(() => {
    if (!open()) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popup?.contains(target) || button?.contains(target)) return;
      hide();
    };
    const onScroll = (event: Event) => {
      if (popup && event.target instanceof Node && popup.contains(event.target)) return;
      hide();
    };
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", hide);
    onCleanup(() => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", hide);
    });
  });

  createEffect(() => {
    const index = highlight();
    if (!open() || !list) return;
    const item = list.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop - 28;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  });

  function onKeyDown(event: KeyboardEvent) {
    const count = matches().length;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (count > 0) setHighlight(index => (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
        return;
      case "Enter": {
        event.preventDefault();
        const entry = matches()[highlight()];
        if (entry) pick(entry);
        return;
      }
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        hide();
        button?.focus();
        return;
    }
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        class={styles.PathButton}
        classList={{ [styles.Open]: open(), [styles.Empty]: props.path.length === 0 }}
        onClick={() => open() ? hide() : show()}
      >
        <Dynamic component={icon()} size={14} class={styles.KindIcon} />
        <span class={styles.PathLabel}>{label() || "Choose a tag"}</span>
        <ChevronDown size={13} class={styles.Chevron} />
      </button>
      <Tooltip anchor={() => button} text={label() || undefined} />
      <Show when={mounted()}>
        <Portal>
          <div ref={popup} class={styles.Popup} classList={{ [styles.Closing]: !open() }} style={popupStyle()}>
            <label class={styles.Search}>
              <Search size={14} />
              <input
                ref={element => queueMicrotask(() => element.focus())}
                placeholder="Find a tag"
                value={query()}
                spellcheck={false}
                onInput={event => { setQuery(event.currentTarget.value); setHighlight(0); }}
                onKeyDown={onKeyDown}
              />
            </label>
            <div ref={list} class={styles.List}>
              <For each={matches()} fallback={<div class={styles.NoMatch}>No tags match</div>}>
                {(entry, index) => (
                  <>
                    <Show when={index() === 0 || matches()[index() - 1].group !== entry.group}>
                      <div class={styles.GroupLabel}>{entry.group}</div>
                    </Show>
                    <button
                      type="button"
                      data-index={index()}
                      class={styles.Item}
                      classList={{ [styles.Active]: index() === highlight(), [styles.Selected]: entry.key === selectedKey() }}
                      title={entry.full}
                      onMouseEnter={() => setHighlight(index())}
                      onClick={() => pick(entry)}
                    >
                      <Dynamic component={KIND_ICONS[entry.valueType]} size={14} class={styles.KindIcon} />
                      <span class={styles.ItemName}>{highlighted(entry.name, normalizedQuery())}</span>
                      <span class={styles.ItemKind}>{KIND_LABELS[entry.valueType]}</span>
                    </button>
                  </>
                )}
              </For>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}

export default TagPicker;
