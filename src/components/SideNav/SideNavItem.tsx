import styles from "./SideNavItem.module.scss";
import { JSX } from "solid-js";

function SideNavItem(props: {
  icon?: JSX.Element,
  children: JSX.Element,
  active?: boolean,
  // Colors the item like an action without the active nav bar.
  highlight?: boolean,
  color?: string,
  onClick?: () => any,
}) {
  return (
    <button
      class={styles.SideNavItem}
      classList={{ [styles.Active]: props.active ?? false, [styles.Highlight]: props.highlight ?? false }}
      style={{ '--nav-color': props.color ?? 'var(--base-blue)' }}
      onClick={() => props.onClick?.()}
    >
      <span class={styles.Icon}>{props.icon}</span>
      {props.children}
    </button>
  );
}

export default SideNavItem;
