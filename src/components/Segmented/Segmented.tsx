import styles from "./Segmented.module.scss";
import { createEffect, createMemo, createSignal, For, JSX, on, onCleanup, onMount } from "solid-js";

export type SegmentedItem<T extends string | number> = {
  id: T;
  label: JSX.Element;
  disabled?: boolean;
};

function Segmented<T extends string | number>(props: {
  items: readonly SegmentedItem<T>[],
  value: T,
  onChange: (value: T) => void,
  size?: "md" | "sm",
  stretch?: boolean,
  class?: string,
}) {
  const buttons = new Map<T, HTMLButtonElement>();
  const [indicator, setIndicator] = createSignal<{ left: number, width: number } | null>(null);
  const [animate, setAnimate] = createSignal(false);
  const className = createMemo(() => [styles.Segmented, props.class].filter(Boolean).join(" "));
  let root: HTMLDivElement | undefined;

  function measure() {
    const button = buttons.get(props.value);
    if (!button) return setIndicator(null);
    setIndicator({ left: button.offsetLeft, width: button.offsetWidth });
  }

  onMount(() => {
    measure();
    requestAnimationFrame(() => setAnimate(true));

    const observer = new ResizeObserver(measure);
    if (root) observer.observe(root);
    onCleanup(() => observer.disconnect());
  });

  createEffect(on([() => props.value, () => props.items.length], measure, { defer: true }));

  return (
    <div
      ref={root}
      role="radiogroup"
      class={className()}
      classList={{ [styles.Small]: props.size === "sm", [styles.Stretch]: props.stretch ?? false }}
    >
      <span
        class={styles.Indicator}
        classList={{ [styles.Animated]: animate(), [styles.Hidden]: !indicator() }}
        style={{
          transform: `translateX(${indicator()?.left ?? 0}px)`,
          width: `${indicator()?.width ?? 0}px`,
        }}
      />
      <For each={props.items}>{item => (
        <button
          type="button"
          role="radio"
          aria-checked={item.id === props.value}
          ref={element => buttons.set(item.id, element)}
          classList={{ [styles.On]: item.id === props.value }}
          disabled={item.disabled}
          onClick={() => item.id !== props.value && props.onChange(item.id)}
        >
          {item.label}
        </button>
      )}</For>
    </div>
  );
}

export default Segmented;
