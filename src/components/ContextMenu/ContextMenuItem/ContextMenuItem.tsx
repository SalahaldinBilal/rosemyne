import styles from "./ContextMenuItem.module.scss";
import { Show, createMemo } from "solid-js";
import { contextMenuEventHandler } from "../eventHandler";
import { ContextMenuItemProps } from "../../../types";
import { Dynamic } from "solid-js/web";

function ContextMenuItem(props: ContextMenuItemProps) {
  const disabled = createMemo(() => props.disabled ?? false);
  const shouldCloseOnClick = createMemo(() => props.shouldCloseOnClick ?? !disabled());

  return (
    <div
      class={styles.Container}
      role="menuitem"
      aria-disabled={disabled()}
      classList={{ [styles.Disabled]: disabled(), [styles.Danger]: props.danger }}
      onClick={ev => {
        if (disabled()) return;

        props.onClick?.(ev);
        if (shouldCloseOnClick()) contextMenuEventHandler.emit("hideAll");
      }}
    >
      <Show when={props.icon}>
        <span class={styles.Icon}>
          <Dynamic component={props.icon!.icon} size={15} {...(props.icon!.props ?? {})} />
        </span>
      </Show>
      <span class={styles.Label}>{props.children}</span>
      <Show when={props.hint}>
        <span class={styles.Hint}>{props.hint}</span>
      </Show>
    </div>
  );
}

export default ContextMenuItem;
