import styles from "./Progress.module.scss";
import { createMemo, Show } from "solid-js";

export type ProgressTone = "accent" | "ok" | "danger";

// `percent` null shows an indeterminate sweep.
export function Progress(props: { percent: number | null, tone?: ProgressTone, class?: string }) {
  const width = createMemo(() => `${Math.max(0, Math.min(100, props.percent ?? 0))}%`);
  const className = createMemo(() => [styles.Progress, props.class].filter(Boolean).join(" "));

  return (
    <div
      class={className()}
      classList={{ [styles.Ok]: props.tone === "ok", [styles.Danger]: props.tone === "danger" }}
      role="progressbar"
      aria-valuenow={props.percent ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <Show when={props.percent !== null} fallback={<i class={styles.Indeterminate} data-keep-motion />}>
        <i style={{ width: width() }} />
      </Show>
    </div>
  );
}

export function Spinner(props: { size?: "sm" | "md" }) {
  return <span class={styles.Spinner} classList={{ [styles.SmallSpinner]: props.size === "sm" }} data-keep-motion />;
}

export default Progress;
