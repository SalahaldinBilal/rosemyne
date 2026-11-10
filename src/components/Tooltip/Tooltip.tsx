import styles from "./Tooltip.module.scss";
import { createSignal, For, JSX, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";

const SHOW_DELAY = 380;
const MARGIN = 8;

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
  let tooltipElement: HTMLDivElement | undefined;

  function schedule() {
    if (!props.text) return;

    clearTimeout(timer);
    timer = setTimeout(show, SHOW_DELAY);
  }

  function show() {
    const anchor = props.anchor();
    if (!anchor || !anchor.isConnected) return;

    // Rendered first so its real size is known, then placed in the same task, before it paints.
    setVisible(true);
    if (tooltipElement) place(anchor, tooltipElement);
  }

  // Centered on the anchor, below it when there's room, and always kept inside the window.
  function place(anchor: HTMLElement, tooltip: HTMLDivElement) {
    const rect = anchor.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = tooltip;
    const left = Math.max(MARGIN, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - MARGIN));

    const below = rect.bottom + MARGIN;
    const above = rect.top - MARGIN - height;
    const fitsBelow = below + height <= window.innerHeight - MARGIN;
    const fitsAbove = above >= MARGIN;
    const top = fitsBelow
      ? below
      : fitsAbove
        ? above
        : Math.max(MARGIN, Math.min(below, window.innerHeight - height - MARGIN));

    setAbove(!fitsBelow && fitsAbove);
    setPosition({ left: left + "px", top: top + "px" });
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
        <div ref={tooltipElement} class={styles.Tooltip} classList={{ [styles.Above]: above() }} style={position()}>
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
