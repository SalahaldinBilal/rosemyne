import styles from "./SideNavItem.module.scss";
import { JSX } from "solid-js";

function SideNavItem(props: {
  icon?: JSX.Element,
  children: JSX.Element,
  active?: boolean,
  onClick?: () => any,
}) {
  return (
    <button
      type="button"
      class={styles.SideNavItem}
      classList={{ [styles.Active]: props.active ?? false }}
      data-active={props.active ? "" : undefined}
      aria-current={props.active ? "page" : undefined}
      onClick={() => props.onClick?.()}
    >
      <span class={styles.Icon}>{props.icon}</span>
      <span class={styles.Label}>{props.children}</span>
    </button>
  );
}

export default SideNavItem;
