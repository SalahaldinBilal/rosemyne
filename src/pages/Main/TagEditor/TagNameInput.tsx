import styles from "./TagNameInput.module.scss";
import { createEffect, createMemo, createSignal, For, JSX, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import Tooltip from "../../../components/Tooltip/Tooltip";
import { KIND_ITEMS, TagEntry } from "./tagEntry";
import { useTagEditor } from "./tagEditorContext";

const MENU_MARGIN = 6;
const MENU_MAX_HEIGHT = 240;
const CLOSE_DURATION = 110;

const KIND_LABEL = new Map(KIND_ITEMS.map(item => [item.value, item.label]));

// A quiet name field that suggests names already used at this spot on other captures.
function TagNameInput(props: { entry: TagEntry, class?: string }) {
  const editor = useTagEditor();
  const [open, setOpen] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);
  const [menuStyle, setMenuStyle] = createSignal<JSX.CSSProperties>({});
  const error = createMemo(() => editor.errors().get(props.entry.id));
  const className = createMemo(() => [styles.Name, props.class].filter(Boolean).join(" "));
  const suggestions = createMemo(() => {
    const query = props.entry.key.trim().toLowerCase();
    return editor.suggestionsFor(props.entry.id)
      .filter(item => item.key.toLowerCase().includes(query) && item.key.toLowerCase() !== query);
  });
  const showMenu = createMemo(() => open() && suggestions().length > 0);

  let input: HTMLInputElement | undefined;
  let menu: HTMLDivElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function position() {
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN;
    const upwards = spaceBelow < MENU_MAX_HEIGHT && rect.top > spaceBelow;
    setMenuStyle({
      left: rect.left + "px",
      "min-width": Math.max(rect.width, 240) + "px",
      ...(upwards ? { bottom: (window.innerHeight - rect.top + MENU_MARGIN) + "px" } : { top: (rect.bottom + MENU_MARGIN) + "px" }),
    });
  }

  createEffect(() => {
    if (showMenu()) {
      clearTimeout(closeTimer);
      position();
      setMounted(true);
    } else if (mounted()) {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => setMounted(false), CLOSE_DURATION);
    }
  });

  createEffect(() => {
    suggestions();
    setHighlight(0);
  });

  createEffect(() => {
    if (!showMenu()) return;
    const close = (event: Event) => {
      if (menu && event.target instanceof Node && menu.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, { capture: true });
    window.addEventListener("resize", close);
    onCleanup(() => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    });
  });

  onCleanup(() => clearTimeout(closeTimer));

  function choose(index: number) {
    const picked = suggestions()[index];
    if (!picked) return;
    setOpen(false);
    editor.pickName(props.entry.id, picked);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (showMenu()) {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          return setHighlight(index => Math.min(index + 1, suggestions().length - 1));
        case "ArrowUp":
          event.preventDefault();
          return setHighlight(index => Math.max(index - 1, 0));
        case "Enter":
        case "Tab":
          if (event.ctrlKey) return;
          event.preventDefault();
          return choose(highlight());
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          return setOpen(false);
      }
    }
    if (event.key === "Enter" && !event.ctrlKey) {
      event.preventDefault();
      document.querySelector<HTMLElement>(`[data-tag-value="${props.entry.id}"] input, [data-tag-value="${props.entry.id}"] button`)?.focus();
    }
  }

  return (
    <>
      <input
        ref={input}
        class={className()}
        classList={{ [styles.Invalid]: !!error() }}
        data-tag-name={props.entry.id}
        value={props.entry.key}
        placeholder="Name"
        spellcheck={false}
        onInput={event => { editor.setKey(props.entry.id, event.currentTarget.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); editor.touch(props.entry.id); }}
        onKeyDown={onKeyDown}
      />
      <Tooltip anchor={() => input} text={error()} />
      <Show when={mounted()}>
        <Portal>
          <div
            ref={menu}
            class={styles.Suggestions}
            classList={{ [styles.Closing]: !showMenu() }}
            style={menuStyle()}
            onMouseDown={event => event.preventDefault()}
          >
            <div class={styles.Title}>Used on other captures</div>
            <For each={suggestions()}>{(item, index) =>
              <div
                class={styles.Item}
                classList={{ [styles.Active]: index() === highlight() }}
                onMouseEnter={() => setHighlight(index())}
                onClick={() => choose(index())}
              >
                <span class={styles.ItemName}>{item.key}</span>
                <span class={styles.ItemKind}>{KIND_LABEL.get(item.kind)}</span>
              </div>
            }</For>
          </div>
        </Portal>
      </Show>
    </>
  );
}

export default TagNameInput;
