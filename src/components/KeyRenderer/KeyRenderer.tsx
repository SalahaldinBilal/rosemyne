import styles from "./KeyRenderer.module.scss";
import { createMemo, For, Show } from "solid-js";
import { ShortcutKey, ShortcutKeys } from "../../types";

export type KeyRendererSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<KeyRendererSize, string> = {
  sm: styles.Small,
  md: styles.Medium,
  lg: styles.Large,
};

function KeyRenderer(props: {
  keys: ShortcutKeys,
  placeholder?: string,
  size?: KeyRendererSize,
  onRemove?: (key: ShortcutKey, index: number) => any,
  ref?: HTMLDivElement | ((e: HTMLDivElement) => any),
}) {
  const className = createMemo(() => `${styles.Keys} ${SIZE_CLASSES[props.size ?? "md"]}`);

  return (
    <div class={className()} ref={props.ref}>
      <For each={props.keys.keys} fallback={<span class={styles.Placeholder}>{props.placeholder ?? ""}</span>}>
        {(key, index) => (
          <Show when={props.onRemove} fallback={<kbd>{key.char}</kbd>}>
            <kbd
              class={styles.Removable}
              title="Click to remove"
              onClick={() => props.onRemove?.(key, index())}
            >
              {key.char}
            </kbd>
          </Show>
        )}
      </For>
    </div>
  );
}

export default KeyRenderer;
