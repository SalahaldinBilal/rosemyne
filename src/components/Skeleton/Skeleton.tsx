import styles from "./Skeleton.module.scss";
import { createMemo, JSX } from "solid-js";

function Skeleton(props: { class?: string, style?: JSX.CSSProperties }) {
  const className = createMemo(() => [styles.Skeleton, props.class].filter(Boolean).join(" "));

  return <div class={className()} style={props.style} data-keep-motion />;
}

export default Skeleton;
