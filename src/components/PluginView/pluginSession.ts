import { createSignal } from "solid-js";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import useToastState from "@core/states/toastState";
import { PluginNode, PluginToast, PluginUiEvent, PluginUiResponse } from "@core/types/plugins";
import { createPluginTree } from "./PluginView";

const MIN_REFRESH_MS = 500;

// One open view of a plugin (its settings page or a modal): holds the tree and talks to the plugin.
export function createPluginSession(plugin: { id: string, name: string }, view: string) {
  const tree = createPluginTree();
  const [busy, setBusy] = createSignal(false);
  const [closed, setClosed] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const { pushToast } = useToastState;
  let refreshTimer: number | undefined;
  let disposed = false;

  function showToast(toast: PluginToast) {
    const kind = toast.kind ?? "info";
    pushToast(`${plugin.name}: ${toast.text}`, kind, kind === "error" ? 6000 : 4000);
  }

  function handle(response: PluginUiResponse) {
    if (disposed || !response) return;
    if (response.tree) tree.apply(response.tree);
    if (response.toast) showToast(response.toast);
    if (response.close) setClosed(true);

    clearTimeout(refreshTimer);
    if (typeof response.refreshAfterMs === "number" && !response.close) {
      refreshTimer = window.setTimeout(render, Math.max(MIN_REFRESH_MS, response.refreshAfterMs));
    }
  }

  async function render() {
    try {
      handle(await safeInvoke("plugin_ui_render", { id: plugin.id, view }));
      setFailure(null);
    } catch (error) {
      if (!disposed) setFailure(errorMessage(error));
    }
  }

  async function send(event: PluginUiEvent) {
    if (busy()) return;
    if (event.type === "change") tree.setValue(event.id, event.value);

    setBusy(true);
    try {
      handle(await safeInvoke("plugin_ui_event", { id: plugin.id, view, event }));
      setFailure(null);
    } catch (error) {
      if (!disposed) pushToast(`${plugin.name}: ${errorMessage(error)}`, "error", 6000);
    } finally {
      setBusy(false);
    }
  }

  function show(nodes: PluginNode[]) {
    tree.apply(nodes);
  }

  function dispose() {
    disposed = true;
    clearTimeout(refreshTimer);
  }

  return { nodes: tree.nodes, busy, closed, failure, render, send, show, dispose };
}
