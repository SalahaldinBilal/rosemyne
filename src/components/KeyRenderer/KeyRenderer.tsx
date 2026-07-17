import styles from "./KeyRenderer.module.scss";
import { createMemo, For, Show } from "solid-js";
import Button from "@core/components/Button/Button";
import { Plus, X } from "lucide-solid";
import { ShortcutKey, ShortcutKeys } from "../../types";

function KeyRenderer(props: { keys: ShortcutKeys, placeholder?: string, size?: number, onRemove?: (key: ShortcutKey, index: number) => any, ref?: HTMLDivElement | ((e: HTMLDivElement) => any) }) {
  const showRemoveIcons = createMemo(() => props.onRemove !== undefined);
  const size = createMemo(() => props.size ?? 35);
  const placeholder = createMemo(() => props.placeholder ?? '')

  return (
    <div class={styles.KeyContainers} classList={{ [styles.WithDeletion]: showRemoveIcons() }} style={{ '--key-size': size() + 'px' }} ref={props.ref}>
      <For each={props.keys.keys} fallback={<div class={styles.Placeholder}>{placeholder()}</div>}>
        {(key, index) => <>
          <div class={styles.KeyContainer}>
            <kbd>{key.char}</kbd>
            <Show when={showRemoveIcons()}>
              <Button style={{ "min-height": 0 }} isIcon noRadius color="var(--danger-color)" onClick={() => props.onRemove?.(key, index())} children={<X />} />
            </Show>
          </div>
          <div class={styles.Plus}>
            <Show when={index() !== props.keys.keys.length - 1}>
              <Plus stroke-width={'2.5px'} />
            </Show>
          </div>
        </>}
      </For>
    </div>
  );
}

export default KeyRenderer;