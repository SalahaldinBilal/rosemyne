import styles from "./PluginSettings.module.scss";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Event as TauriEvent } from "@tauri-apps/api/event";
import { ArrowLeft, RotateCw, Trash2 } from "lucide-solid";
import Button from "@core/components/Button/Button";
import Checkbox from "@core/components/Checkbox/Checkbox";
import Modal from "@core/components/Modal/Modal";
import PluginView from "@core/components/PluginView/PluginView";
import { createPluginSession } from "@core/components/PluginView/pluginSession";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import useToastState from "@core/states/toastState";
import useSettingsSavedState from "@core/states/settingsSavedState";
import useTitleBarState from "@core/states/titleBarState";
import { PluginInfo, PluginLogEvent, PluginLogLine, PluginUiEvent, PluginUploaderInfo } from "@core/types/plugins";
import { SettingRow, SettingsGroup, SettingsPage, ToggleRow } from "../SettingsLayout/SettingsLayout";
import PermissionList from "./PermissionList";
import { PluginIcon, StatusBadge } from "./PluginBadges";

const MAX_LOG_LINES = 500;

function logTime(timeMs: number): string {
  return new Date(timeMs).toLocaleTimeString();
}

function PluginPage(props: { plugin: PluginInfo, onBack: () => void }) {
  const manifest = createMemo(() => props.plugin.manifest);
  const id = manifest().id;
  const [values, setValues] = createStore<Record<string, unknown>>({});
  const [uploaders, setUploaders] = createSignal<PluginUploaderInfo[]>([]);
  const [log, setLog] = createSignal<PluginLogLine[]>([]);
  const [confirmingUninstall, setConfirmingUninstall] = createSignal(false);
  const [deleteData, setDeleteData] = createSignal(true);
  const [removeTags, setRemoveTags] = createSignal(false);
  const [taggedCount, setTaggedCount] = createSignal(0);
  const [working, setWorking] = createSignal(false);
  const { pushToast } = useToastState;
  const { markSettingsSaved } = useSettingsSavedState;
  const { setCrumbTail } = useTitleBarState;
  const session = createPluginSession({ id, name: manifest().name }, "settings");
  let disposed = false;
  let logEl: HTMLDivElement | undefined;

  const usable = createMemo(() => props.plugin.enabled && props.plugin.status !== "changedOnDisk" && props.plugin.status !== "unusable");
  const hasOwnView = createMemo(() => usable() && manifest().hooks.includes("ui_render"));
  const hasStaticSettings = createMemo(() => manifest().settings.length > 0);
  const byline = createMemo(() => [`Version ${manifest().version}`, manifest().author].filter(Boolean).join(" · "));
  const notice = createMemo(() => props.plugin.problem ?? (props.plugin.status === "paused"
    ? "Paused because it kept slowing down saves. Turn it off and on again to resume."
    : props.plugin.lastError));

  function scrollLogToEnd() {
    queueMicrotask(() => {
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    });
  }

  async function refreshUploaders() {
    const all = await safeInvoke("list_plugin_uploaders");
    if (!disposed) setUploaders(all.filter(uploader => uploader.pluginId === id));
  }

  onMount(async () => {
    setCrumbTail([manifest().name]);
    if (hasOwnView()) session.render();

    try {
      const [stored, lines] = await Promise.all([
        safeInvoke("get_plugin_settings", { id }),
        safeInvoke("get_plugin_log", { id }),
        refreshUploaders(),
      ]);
      if (disposed) return;
      setValues(stored);
      setLog(lines);
      scrollLogToEnd();
    } catch (error) {
      pushToast(errorMessage(error), "error", 6000);
    }

    const unlisten = await getCurrentWebview().listen("plugins://log", (event: TauriEvent<PluginLogEvent>) => {
      if (event.payload.pluginId !== id) return;
      setLog(lines => [...lines, event.payload.line].slice(-MAX_LOG_LINES));
      scrollLogToEnd();
    });
    if (disposed) unlisten();
    else onDispose = unlisten;
  });

  let onDispose: (() => void) | undefined;

  onCleanup(() => {
    disposed = true;
    setCrumbTail([]);
    session.dispose();
    onDispose?.();
  });

  async function saveSetting(event: PluginUiEvent) {
    if (event.type !== "change") return;
    try {
      await safeInvoke("set_plugin_setting", { id, settingId: event.id, value: event.value });
      setValues(event.id, event.value);
      markSettingsSaved();
    } catch (error) {
      pushToast(errorMessage(error), "error", 6000);
    }
  }

  async function setAutoUpload(uploader: PluginUploaderInfo, enabled: boolean) {
    try {
      await safeInvoke("set_plugin_uploader_auto_upload", { id: uploader.id, enabled });
      await refreshUploaders();
      markSettingsSaved();
    } catch (error) {
      pushToast(errorMessage(error), "error", 6000);
    }
  }

  async function reload() {
    setWorking(true);
    try {
      await safeInvoke("reload_plugins");
      if (hasOwnView()) session.render();
    } catch (error) {
      pushToast(errorMessage(error), "error", 6000);
    } finally {
      setWorking(false);
    }
  }

  async function askUninstall() {
    setDeleteData(true);
    setRemoveTags(false);
    setTaggedCount(await safeInvoke("count_plugin_tagged", { id }).catch(() => 0));
    setConfirmingUninstall(true);
  }

  async function uninstall() {
    setWorking(true);
    try {
      await safeInvoke("uninstall_plugin", { id, deleteData: deleteData(), removeTags: removeTags() });
      setConfirmingUninstall(false);
      markSettingsSaved();
      props.onBack();
    } catch (error) {
      pushToast(errorMessage(error), "error", 6000);
    } finally {
      setWorking(false);
    }
  }

  return <>
    <SettingsPage title={manifest().name} description={manifest().description ?? byline()}>
      <div class={styles.PageBar}>
        <Button size="sm" variant="ghost" onClick={() => props.onBack()}><ArrowLeft size={14} />All plugins</Button>
        <span class={styles.Spacer} />
        <PluginIcon plugin={props.plugin} size={22} />
        <span class={styles.Byline}>{byline()}</span>
        <StatusBadge plugin={props.plugin} />
      </div>

      <Show when={notice()}>
        {text => <div class={styles.Notice} classList={{ [styles.Bad]: props.plugin.status !== "ok" }}>{text()}</div>}
      </Show>

      <Show when={hasStaticSettings()}>
        <PluginView pluginId={id} nodes={manifest().settings} values={values} onEvent={saveSetting} />
      </Show>

      <Show when={hasOwnView()}>
        <Show when={session.failure()}>
          {text => <div class={styles.Notice} classList={{ [styles.Bad]: true }}>Couldn't show this plugin's view: {text()}</div>}
        </Show>
        <PluginView pluginId={id} nodes={session.nodes} busy={session.busy()} onEvent={session.send} />
      </Show>

      <Show when={uploaders().length > 0}>
        <SettingsGroup title="Uploaders">
          <For each={uploaders()}>
            {uploader => (
              <ToggleRow
                label={uploader.name}
                hint="Upload automatically when this is the default uploader. Pick the default in Settings › Uploaders."
                checked={uploader.autoUpload}
                onChange={enabled => setAutoUpload(uploader, enabled)}
              />
            )}
          </For>
        </SettingsGroup>
      </Show>

      <SettingsGroup title="Permissions">
        <PermissionList manifest={manifest()} />
      </SettingsGroup>

      <SettingsGroup
        title="Log"
        right={<Show when={props.plugin.dev}>
          <Button size="sm" disabled={working()} onClick={reload}><RotateCw size={14} />Reload</Button>
        </Show>}
      >
        <div class={styles.Log} ref={logEl}>
          <For each={log()} fallback={<div class={styles.LogEmpty}>Nothing logged yet.</div>}>
            {line => (
              <div class={styles.LogLine} data-level={line.level}>
                <span class={styles.LogTime}>{logTime(line.timeMs)}</span>
                <span>{line.text}</span>
              </div>
            )}
          </For>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Remove">
        <SettingRow
          label={props.plugin.dev ? "Stop loading this plugin" : "Uninstall this plugin"}
          hint={props.plugin.dev ? "Its folder stays where it is." : "Its files are deleted from Rosemyne's plugins folder."}
        >
          <Button size="sm" variant="danger" onClick={askUninstall}><Trash2 size={14} />Uninstall</Button>
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>

    <Modal
      show={confirmingUninstall()}
      onHide={() => setConfirmingUninstall(false)}
      title={`Uninstall ${manifest().name}?`}
      width={440}
      footer={<>
        <Button onClick={() => setConfirmingUninstall(false)}>Cancel</Button>
        <Button variant="danger-solid" disabled={working()} onClick={uninstall}><Trash2 size={15} />Uninstall</Button>
      </>}
    >
      <div class={styles.UninstallOptions}>
        <Checkbox checked={deleteData()} onChange={checked => setDeleteData(checked)}>Delete this plugin's saved data</Checkbox>
        <Show when={manifest().tagKey && taggedCount() > 0}>
          <Checkbox checked={removeTags()} onChange={checked => setRemoveTags(checked)}>
            Remove its tags from {taggedCount()} {taggedCount() === 1 ? "capture" : "captures"}
          </Checkbox>
        </Show>
      </div>
    </Modal>
  </>;
}

export default PluginPage;
