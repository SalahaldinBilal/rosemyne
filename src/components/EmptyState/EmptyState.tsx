import styles from "./EmptyState.module.scss";
import { JSX, Show } from "solid-js";

function EmptyState(props: { icon: JSX.Element, title: string, children?: JSX.Element, action?: JSX.Element }) {
  return (
    <div class={styles.EmptyState}>
      <div class={styles.Icon}>{props.icon}</div>
      <b>{props.title}</b>
      <Show when={props.children}>
        <div class={styles.Body}>{props.children}</div>
      </Show>
      <Show when={props.action}>
        <div class={styles.Action}>{props.action}</div>
      </Show>
    </div>
  );
}

export default EmptyState;
