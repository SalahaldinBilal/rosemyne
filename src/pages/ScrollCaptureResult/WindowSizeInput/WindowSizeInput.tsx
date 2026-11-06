import styles from "./WindowSizeInput.module.scss";
import { createEffect, createSignal, For, JSX, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import NumberField from "@core/components/NumberField/NumberField";

const MENU_MARGIN = 6;
const MENU_MAX_HEIGHT = 210;
const CLOSE_DURATION = 110;

const SUGGESTIONS: number[] = [];
for (let value = 1; value <= 1024; value *= 2) SUGGESTIONS.push(value);

function WindowSizeInput(props: { value: number, onChange: (value: number) => void }) {
  const [open, setOpen] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);
  const [menuStyle, setMenuStyle] = createSignal<JSX.CSSProperties>({});

  let fieldRef: HTMLDivElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function positionMenu() {
    if (!fieldRef) return;
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

  function show() {
    clearTimeout(closeTimer);
    positionMenu();
    setHighlight(Math.max(0, SUGGESTIONS.indexOf(props.value)));
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

  createEffect(() => {
    if (!open()) return;

    const close = (event: Event) => {
      if (menuRef && event.target instanceof Node && menuRef.contains(event.target)) return;
      hide();
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
    hide();
  }

  // While the list is open the arrows move through it. Once it's closed they step the number.
  function onKeyDown(event: KeyboardEvent) {
    if (!open()) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        return setHighlight(index => Math.min(index + 1, SUGGESTIONS.length - 1));
      case "ArrowUp":
        event.preventDefault();
        return setHighlight(index => Math.max(index - 1, 0));
      case "Enter":
        event.preventDefault();
        return choose(SUGGESTIONS[highlight()]);
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        return hide();
    }
  }

  return (
    <>
      <NumberField
        ref={element => fieldRef = element}
        value={props.value}
        min={1}
        max={100_000}
        unit="rows"
        width="100%"
        onChange={props.onChange}
        onKeyDown={onKeyDown}
        onFocus={show}
        onBlur={hide}
      />
      <Show when={mounted()}>
        <Portal>
          <div
            ref={menuRef}
            class={styles.Suggestions}
            classList={{ [styles.Closing]: !open() }}
            style={menuStyle()}
            onMouseDown={event => event.preventDefault()}
          >
            <For each={SUGGESTIONS}>{(value, index) =>
              <div
                class={styles.Item}
                classList={{ [styles.Active]: index() === highlight(), [styles.Selected]: value === props.value }}
                onMouseEnter={() => setHighlight(index())}
                onClick={() => choose(value)}
              >
                {value}
              </div>
            }</For>
          </div>
        </Portal>
      </Show>
    </>
  );
}

export default WindowSizeInput;
