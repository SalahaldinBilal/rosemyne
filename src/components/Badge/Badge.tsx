import styles from "./Badge.module.scss";
import { createMemo, JSX } from "solid-js";

export type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "danger";

const TONE_CLASSES: Record<BadgeTone, string | undefined> = {
  neutral: undefined,
  accent: styles.Accent,
  ok: styles.Ok,
  warn: styles.Warn,
  danger: styles.Danger,
};

function Badge(props: { tone?: BadgeTone, children: JSX.Element, title?: string }) {
  const className = createMemo(() => [styles.Badge, TONE_CLASSES[props.tone ?? "neutral"]].filter(Boolean).join(" "));

  return (
    <span class={className()} title={props.title}>
      {props.children}
    </span>
  );
}

const METHOD_COLORS: Record<string, string> = {
  GET: "var(--ok)",
  POST: "var(--method-post-color)",
  PUT: "var(--method-put-color)",
  PATCH: "var(--warn)",
  DELETE: "var(--danger)",
};

export function methodColor(method: string): string {
  return METHOD_COLORS[method.toUpperCase()] ?? "var(--text-2)";
}

export function MethodBadge(props: { method: string }) {
  const color = createMemo(() => methodColor(props.method));

  return (
    <span class={styles.Method} style={{ "--method-color": color() }}>
      {props.method || "?"}
    </span>
  );
}

export default Badge;
