import styles from "./PluginSettings.module.scss";
import { createMemo, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Bell, ClipboardCopy, Eye, Globe, LucideIcon, Paintbrush, ShieldCheck, Tag, Tags, TriangleAlert } from "lucide-solid";
import Badge from "@core/components/Badge/Badge";
import { PluginManifest, PluginPermissionName } from "@core/types/plugins";

const ORDER: PluginPermissionName[] = ["capturesRead", "capturesEdit", "tagsRead", "tagsWrite", "clipboardWrite", "toast"];

const ICONS: Record<PluginPermissionName, LucideIcon> = {
  capturesRead: Eye,
  capturesEdit: Paintbrush,
  tagsRead: Tags,
  tagsWrite: Tag,
  clipboardWrite: ClipboardCopy,
  toast: Bell,
};

function describe(name: PluginPermissionName, manifest: PluginManifest): string {
  switch (name) {
    case "capturesRead": return "Read the captures it is run on";
    case "capturesEdit": return "Change screenshots before they are saved";
    case "tagsRead": return "Read tags (includes window titles and program names)";
    case "tagsWrite": return `Add its own tags under ${manifest.tagKey ?? "its own name"}`;
    case "clipboardWrite": return "Put text on the clipboard";
    case "toast": return "Show notifications";
  }
}

// `added` marks what an update asks for on top of the installed version.
function PermissionList(props: { manifest: PluginManifest, added?: { permissions: PluginPermissionName[], hosts: string[] } }) {
  const permissions = createMemo(() => props.manifest.permissions);
  const granted = createMemo(() => ORDER.filter(name => permissions()[name]));
  const hosts = createMemo(() => permissions().network);
  const nothing = createMemo(() => granted().length === 0 && hosts().length === 0);
  // The sandbox can't stop a plugin that may read and may connect from sending what it read.
  const leak = createMemo(() => {
    if (hosts().length === 0) return null;
    if (permissions().capturesRead) return "Can send your captures to";
    if (permissions().tagsRead) return "Can send your tags (window titles, program names) to";
    return null;
  });

  return (
    <div class={styles.Permissions}>
      <Show when={leak()}>
        {text => (
          <div class={styles.Leak}>
            <TriangleAlert size={16} />
            <span>{text()}: <b>{hosts().join(", ")}</b></span>
          </div>
        )}
      </Show>
      <Show when={!nothing()} fallback={
        <div class={styles.Permission}>
          <span class={styles.PermissionIcon}><ShieldCheck size={15} /></span>
          <span class={styles.PermissionText}>Needs no permissions</span>
        </div>
      }>
        <For each={granted()}>
          {name => (
            <div class={styles.Permission}>
              <span class={styles.PermissionIcon}><Dynamic component={ICONS[name]} size={15} /></span>
              <span class={styles.PermissionText}>{describe(name, props.manifest)}</span>
              <Show when={props.added?.permissions.includes(name)}><Badge tone="warn">New</Badge></Show>
            </div>
          )}
        </For>
        <Show when={hosts().length > 0}>
          <div class={styles.Permission}>
            <span class={styles.PermissionIcon}><Globe size={15} /></span>
            <span class={styles.PermissionText}>
              Connect to:{" "}
              <For each={hosts()}>
                {(host, index) => <>
                  <Show when={index() > 0}>, </Show>
                  <code classList={{ [styles.NewHost]: props.added?.hosts.includes(host) ?? false }}>{host}</code>
                </>}
              </For>
            </span>
            <Show when={(props.added?.hosts.length ?? 0) > 0}><Badge tone="warn">New hosts</Badge></Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}

export default PermissionList;
