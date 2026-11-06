import styles from "./Select.module.scss";
import { SelectProps } from "../../types";
import { For, JSX, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { Check, ChevronDown } from "lucide-solid";

const MENU_MARGIN = 4;
const MENU_MAX_HEIGHT = 300;
const CLOSE_DURATION = 110;

const VARIANT_CLASSES = {
  default: undefined,
  bare: styles.Bare,
  pill: styles.Pill,
  unit: styles.Unit,
};

function Select<T>(props: SelectProps<T>) {
  const [open, setOpen] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);
  const [menuStyle, setMenuStyle] = createSignal<JSX.CSSProperties>({});
  const [upwards, setUpwards] = createSignal(false);
  const selected = createMemo(() => props.items.find(item => item.id === props.value));
  const controlClass = createMemo(() =>
    [styles.Select, VARIANT_CLASSES[props.variant ?? "default"], props.class].filter(Boolean).join(" "),
  );

  let controlRef!: HTMLDivElement;
  let menuRef: HTMLDivElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function openMenu() {
    const rect = controlRef.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN;
    const openUpwards = spaceBelow < Math.min(MENU_MAX_HEIGHT, 160) && rect.top > spaceBelow;

    clearTimeout(closeTimer);
    setUpwards(openUpwards);
    setMenuStyle({
      left: rect.left + "px",
      "min-width": rect.width + "px",
      ...(openUpwards
        ? { bottom: (window.innerHeight - rect.top + MENU_MARGIN) + "px" }
        : { top: (rect.bottom + MENU_MARGIN) + "px" }),
    });
    followHighlight = true;
    setHighlight(Math.max(0, props.items.findIndex(item => item.id === props.value)));
    setMounted(true);
    setOpen(true);
  }

  function closeMenu() {
    if (!open()) return;

    setOpen(false);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setMounted(false), CLOSE_DURATION);
  }

  onCleanup(() => clearTimeout(closeTimer));

  function choose(item: SelectProps<T>["items"][number]) {
    props.onItemClick(item);
    closeMenu();
  }

  // The menu is portaled at a viewport position, so an ancestor scroll or a resize would leave it detached.
  createEffect(() => {
    if (!open()) return;

    const close = (event: Event) => {
      if (menuRef && event.target instanceof Node && menuRef.contains(event.target)) return;
      closeMenu();
    };
    window.addEventListener("scroll", close, { capture: true });
    window.addEventListener("resize", close);
    onCleanup(() => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    });
  });

  // Hover must never scroll the list, or the list shifting under a still pointer re-highlights on its own.
  let followHighlight = false;

  createEffect(() => {
    const index = highlight();
    if (!open() || !menuRef || !followHighlight) return;

    followHighlight = false;
    const item = menuRef.children[index] as HTMLElement | undefined;
    if (!item) return;

    // scrollIntoView would also scroll the page behind the menu.
    if (item.offsetTop < menuRef.scrollTop) {
      menuRef.scrollTop = item.offsetTop;
    } else if (item.offsetTop + item.offsetHeight > menuRef.scrollTop + menuRef.clientHeight) {
      menuRef.scrollTop = item.offsetTop + item.offsetHeight - menuRef.clientHeight;
    }
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
        followHighlight = true;
        return setHighlight(index => Math.min(index + 1, props.items.length - 1));
      case "ArrowUp":
        event.preventDefault();
        followHighlight = true;
        return setHighlight(index => Math.max(index - 1, 0));
      case "Home":
        event.preventDefault();
        followHighlight = true;
        return setHighlight(0);
      case "End":
        event.preventDefault();
        followHighlight = true;
        return setHighlight(props.items.length - 1);
      case "Enter":
      case " ": {
        event.preventDefault();
        const item = props.items[highlight()];
        if (item) choose(item);
        return;
      }
      case "Escape":
        event.stopPropagation();
        return closeMenu();
      case "Tab":
        return closeMenu();
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
        style={props.style}
        class={controlClass()}
        classList={{ [styles.Open]: open(), [styles.Accent]: props.accent ?? false }}
        onClick={() => open() ? closeMenu() : openMenu()}
        onKeyDown={onKeyDown}
        onFocusOut={closeMenu}
      >
        <Show when={selected()} fallback={<span class={styles.Placeholder}>{props.placeholder ?? "Select…"}</span>}>
          {item => <span class={styles.Label} style={props.labelColor ? { color: props.labelColor } : undefined}>{item().label}</span>}
        </Show>
        <ChevronDown class={styles.Chevron} size={props.variant === "unit" ? 11 : 14} />
      </div>
      <Show when={mounted()}>
        <Portal>
          <div
            ref={menuRef}
            role="listbox"
            class={styles.Menu}
            classList={{ [styles.Upwards]: upwards(), [styles.Closing]: !open() }}
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
                <span class={styles.ItemLabel}>{item.label}</span>
                <Show when={item.id === props.value}>
                  <Check class={styles.Check} size={14} />
                </Show>
              </div>
            }</For>
          </div>
        </Portal>
      </Show>
    </>
  );
}

export default Select;
