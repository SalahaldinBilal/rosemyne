import styles from "./WindowSizeInput.module.scss";
import { createEffect, createSignal, For, JSX, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";

const MENU_MARGIN = 8;
const MENU_MAX_HEIGHT = 210;

const SUGGESTIONS: number[] = [];
for (let value = 1; value <= 1024; value *= 2) SUGGESTIONS.push(value);

function WindowSizeInput(props: { value: number, onChange: (value: number) => void }) {
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);
  const [menuStyle, setMenuStyle] = createSignal<JSX.CSSProperties>({});

  let fieldRef!: HTMLDivElement;
  let menuRef: HTMLDivElement | undefined;

  function positionMenu() {
    const rect = fieldRef.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN;
    const openUpwards = spaceBelow < MENU_MAX_HEIGHT && rect.top > spaceBelow;

    setMenuStyle({
      left: rect.left + "px",
      "min-width": rect.width + "px",
      ...(openUpwards
        ? { bottom: (window.innerHeight - rect.top + MENU_MARGIN) + "px" }
        : { top: (rect.bottom + MENU_MARGIN) + "px" }),
    });
  }

  createEffect(() => {
    if (!open()) return;
    positionMenu();
    setHighlight(Math.max(0, SUGGESTIONS.indexOf(props.value)));

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

  function choose(value: number) {
    props.onChange(value);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open()) return setOpen(true);
        return setHighlight(index => Math.min(index + 1, SUGGESTIONS.length - 1));
      case "ArrowUp":
        event.preventDefault();
        return setHighlight(index => Math.max(index - 1, 0));
      case "Enter":
        if (open()) {
          event.preventDefault();
          choose(SUGGESTIONS[highlight()]);
        }
        return;
      case "Escape":
        return setOpen(false);
    }
  }

  return (
    <div class={styles.Field} ref={fieldRef}>
      <input
        class={styles.Input}
        type="number"
        min={1}
        value={props.value}
        onInput={e => props.onChange(Math.max(1, e.currentTarget.valueAsNumber || 1))}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <Show when={open()}>
        <Portal>
          <div ref={menuRef} class={styles.Suggestions} style={menuStyle()} onMouseDown={event => event.preventDefault()}>
            <For each={SUGGESTIONS}>{(value, index) =>
              <div
                class={styles.Item}
                classList={{ [styles.Active]: index() === highlight() }}
                onMouseEnter={() => setHighlight(index())}
                onClick={() => choose(value)}
              >
                {value}
              </div>
            }</For>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

export default WindowSizeInput;
