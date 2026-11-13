import styles from "./PluginSettings.module.scss";
import { createMemo, Show } from "solid-js";
import { Puzzle } from "lucide-solid";
import Badge, { BadgeTone } from "@core/components/Badge/Badge";
import { PluginInfo, PluginStatus } from "@core/types/plugins";

const STATUS_LABELS: Record<PluginStatus, { text: string, tone: BadgeTone }> = {
  ok: { text: "Enabled", tone: "ok" },
  disabled: { text: "Disabled", tone: "neutral" },
  paused: { text: "Paused", tone: "warn" },
  error: { text: "Error", tone: "danger" },
  changedOnDisk: { text: "Changed on disk", tone: "danger" },
  unusable: { text: "Can't load", tone: "danger" },
};

export function StatusBadge(props: { plugin: PluginInfo }) {
  const status = createMemo(() => STATUS_LABELS[props.plugin.status]);

  return <>
    <Badge tone={status().tone}>{status().text}</Badge>
    <Show when={props.plugin.dev}><Badge tone="accent">Dev</Badge></Show>
  </>;
}

export function PluginIcon(props: { plugin: PluginInfo, size: number }) {
  const source = createMemo(() =>
    `http://rosemyne-photo.localhost/plugin-icon/${encodeURIComponent(props.plugin.manifest.id)}?v=${encodeURIComponent(props.plugin.manifest.version)}`);
  const box = createMemo(() => ({ width: `${props.size}px`, height: `${props.size}px` }));
  const glyphSize = createMemo(() => Math.round(props.size * 0.6));

  return (
    <span class={styles.Icon} style={box()}>
      <Show when={props.plugin.hasIcon} fallback={<Puzzle size={glyphSize()} />}>
        <img src={source()} alt="" draggable={false} />
      </Show>
    </span>
  );
}
