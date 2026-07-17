import styles from "./Select.module.scss";
import { SelectProps } from "../../types";
import { For, JSX, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { ChevronDown } from "lucide-solid";

const MENU_MARGIN = 4;
const MENU_MAX_HEIGHT = 300;

function Select<T>(props: SelectProps<T>) {
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);
  const [menuStyle, setMenuStyle] = createSignal<JSX.CSSProperties>({});
  const selected = createMemo(() => props.items.find(item => item.id === props.value));

  let controlRef!: HTMLDivElement;
  let menuRef: HTMLDivElement | undefined;

  function openMenu() {
    const rect = controlRef.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN;
    const openUpwards = spaceBelow < Math.min(MENU_MAX_HEIGHT, 160) && rect.top > spaceBelow;

    setMenuStyle({
      left: rect.left + "px",
      "min-width": rect.width + "px",
      ...(openUpwards
        ? { bottom: (window.innerHeight - rect.top + MENU_MARGIN) + "px" }
        : { top: (rect.bottom + MENU_MARGIN) + "px" }),
    });
    setHighlight(Math.max(0, props.items.findIndex(item => item.id === props.value)));
    setOpen(true);
  }

  function choose(item: SelectProps<T>["items"][number]) {
    props.onItemClick(item);
    setOpen(false);
  }

  // The dropdown is portaled with a viewport position; any ancestor scroll or
  // window resize would leave it floating detached, so just close it , but
  // not for a scroll inside the menu's own (possibly overflowing) item list,
  // which the capture-phase listener would otherwise see too.
  createEffect(() => {
    if (!open()) return;

    const close = (event: Event) => {
      if (menuRef && event.target instanceof Node && menuRef.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, { capture: true });
    window.addEventListener("resize", close);
    onCleanup(() => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    });
  });

  createEffect(() => {
    if (!open() || !menuRef) return;
    menuRef.children[highlight()]?.scrollIntoView({ block: "nearest" });
  });

  function onKeyDown(event: KeyboardEvent) {
    if (!open()) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        return setHighlight(index => Math.min(index + 1, props.items.length - 1));
      case "ArrowUp":
        event.preventDefault();
        return setHighlight(index => Math.max(index - 1, 0));
      case "Home":
        event.preventDefault();
        return setHighlight(0);
      case "End":
        event.preventDefault();
        return setHighlight(props.items.length - 1);
      case "Enter":
      case " ": {
        event.preventDefault();
        const item = props.items[highlight()];
        if (item) choose(item);
        return;
      }
      case "Escape":
      case "Tab":
        return setOpen(false);
    }
  }

  return (
    <>
      <div
        ref={controlRef}
        tabIndex={0}
        role="combobox"
        aria-expanded={open()}
        aria-haspopup="listbox"
        style={{ ...(props.style ?? {}), ...(props.color ? { color: props.color } : {}) }}
        class={styles.Select}
        classList={{
          [styles.Open]: open(),
          [styles.Accent]: props.accent ?? false,
          [styles.Borderless]: props.borderless ?? false,
          [styles.NoRadius]: props.noRadius ?? false,
        }}
        onClick={() => open() ? setOpen(false) : openMenu()}
        onKeyDown={onKeyDown}
        onFocusOut={() => setOpen(false)}
      >
        <Show when={selected()} fallback={<span class={styles.Placeholder}>{props.placeholder ?? "Select…"}</span>}>
          {item => <span class={styles.Label}>{item().label}</span>}
        </Show>
        <ChevronDown class={styles.Chevron} size={14} />
      </div>
      <Show when={open()}>
        <Portal>
          <div
            ref={menuRef}
            role="listbox"
            class={styles.Menu}
            style={menuStyle()}
            onMouseDown={event => event.preventDefault()}
          >
            <For each={props.items}>{(item, index) =>
              <div
                role="option"
                aria-selected={item.id === props.value}
                class={styles.Item}
                classList={{ [styles.Active]: index() === highlight(), [styles.Selected]: item.id === props.value }}
                onMouseEnter={() => setHighlight(index())}
                onClick={() => choose(item)}
              >
                {item.label}
              </div>
            }</For>
          </div>
        </Portal>
      </Show>
    </>
  );
}

export default Select;
