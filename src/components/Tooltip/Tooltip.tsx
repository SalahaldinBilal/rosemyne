import styles from "./Tooltip.module.scss";
import { createSignal, For, JSX, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";

const SHOW_DELAY = 380;
const MARGIN = 8;
const ESTIMATED_HEIGHT = 30;

export type TooltipProps = {
  anchor: () => HTMLElement | undefined;
  text?: string;
  keys?: string[];
};

function Tooltip(props: TooltipProps) {
  const [visible, setVisible] = createSignal(false);
  const [position, setPosition] = createSignal<JSX.CSSProperties>({});
  const [above, setAbove] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    if (!props.text) return;

    clearTimeout(timer);
    timer = setTimeout(show, SHOW_DELAY);
  }

  function show() {
    const anchor = props.anchor();
    if (!anchor || !anchor.isConnected) return;

    const rect = anchor.getBoundingClientRect();
    const showAbove = rect.bottom + ESTIMATED_HEIGHT + MARGIN > window.innerHeight;

    setAbove(showAbove);
    setPosition({
      left: (rect.left + rect.width / 2) + "px",
      top: (showAbove ? rect.top - MARGIN : rect.bottom + MARGIN) + "px",
    });
    setVisible(true);
  }

  function hide() {
    clearTimeout(timer);
    setVisible(false);
  }

  onMount(() => {
    const anchor = props.anchor();
    if (!anchor) return;

    anchor.addEventListener("mouseenter", schedule);
    anchor.addEventListener("mouseleave", hide);
    anchor.addEventListener("mousedown", hide);
    onCleanup(() => {
      anchor.removeEventListener("mouseenter", schedule);
      anchor.removeEventListener("mouseleave", hide);
      anchor.removeEventListener("mousedown", hide);
    });
  });

  onCleanup(() => clearTimeout(timer));

  return (
    <Show when={props.text && visible()}>
      <Portal>
        <div class={styles.Tooltip} classList={{ [styles.Above]: above() }} style={position()}>
          <span>{props.text}</span>
          <Show when={props.keys?.length}>
            <span class={styles.Keys}>
              <For each={props.keys}>{key => <kbd>{key}</kbd>}</For>
            </span>
          </Show>
        </div>
      </Portal>
    </Show>
  );
}

export default Tooltip;
