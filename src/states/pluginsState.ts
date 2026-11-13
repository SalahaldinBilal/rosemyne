import { createMemo, createRoot, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Event as TauriEvent } from "@tauri-apps/api/event";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { PluginInfo, PluginNode, PluginToastEvent } from "@core/types/plugins";
import { SettingsSearchEntry } from "@core/constants/settingsSearch";
import useToastState from "./toastState";

const INPUT_TYPES = ["toggle", "select", "segmented", "number", "duration", "fileSize", "dimension", "text", "template", "inline"];

function searchEntries(plugin: PluginInfo, nodes: PluginNode[], group?: string): SettingsSearchEntry[] {
  return nodes.flatMap(node => {
    if (node.type === "group") {
      const title = typeof node.title === "string" ? node.title : group;
      return searchEntries(plugin, node.children ?? [], title);
    }
    if (!INPUT_TYPES.includes(node.type) || typeof node.label !== "string") return [];
    return [{
      page: "plugins",
      plugin: plugin.manifest.id,
      group: [plugin.manifest.name, group].filter(Boolean).join(" › "),
      label: node.label,
      hint: typeof node.hint === "string" ? node.hint : undefined,
    }];
  });
}

function usePluginsStateInner() {
  const [plugins, setPlugins] = createStore<PluginInfo[]>([]);
  // Set by a link to a plugin's page, and cleared by the Plugins page once it has opened that plugin.
  const [requestedOpen, setRequestedOpen] = createSignal<string | null>(null);
  const { pushToast } = useToastState;

  async function refresh() {
    try {
      setPlugins(reconcile(await safeInvoke("list_plugins")));
    } catch (error) {
      console.error("Failed to list plugins", error);
    }
  }

  const running = createMemo(() => plugins.filter(plugin => plugin.enabled && plugin.status !== "changedOnDisk" && plugin.status !== "unusable"));

  const settingsSearchEntries = createMemo(() => running().flatMap(plugin => searchEntries(plugin, plugin.manifest.settings)));

  const requestOpen = (pluginId: string) => setRequestedOpen(pluginId);
  const clearRequestedOpen = () => setRequestedOpen(null);

  const webview = getCurrentWebview();
  webview.listen("plugins://changed", refresh);
  webview.listen("plugins://toast", (event: TauriEvent<PluginToastEvent>) => {
    const { pluginName, kind, text } = event.payload;
    pushToast(`${pluginName}: ${text}`, kind, kind === "error" ? 6000 : 4000);
  });
  refresh();

  return { plugins, running, settingsSearchEntries, refresh, requestedOpen, requestOpen, clearRequestedOpen };
}

const usePluginsState = createRoot(usePluginsStateInner);
export default usePluginsState;
