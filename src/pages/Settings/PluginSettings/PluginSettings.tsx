import styles from "./PluginSettings.module.scss";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, ChevronUp, FolderOpen, Plus, Puzzle } from "lucide-solid";
import Badge from "@core/components/Badge/Badge";
import Button from "@core/components/Button/Button";
import EmptyState from "@core/components/EmptyState/EmptyState";
import Modal from "@core/components/Modal/Modal";
import Switch from "@core/components/Switch/Switch";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import usePluginsState from "@core/states/pluginsState";
import useToastState from "@core/states/toastState";
import useSettingsSavedState from "@core/states/settingsSavedState";
import { PluginInspection } from "@core/types/plugins";
import { SettingsGroup, SettingsPage } from "../SettingsLayout/SettingsLayout";
import PermissionList from "./PermissionList";
import { PluginIcon, StatusBadge } from "./PluginBadges";
import PluginPage from "./PluginPage";

const PACKAGE_EXTENSION = "rosemyne-plugin";

function PluginSettings() {
  const { plugins, refresh, requestedOpen, clearRequestedOpen } = usePluginsState;
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [review, setReview] = createSignal<{ path: string, inspection: PluginInspection } | null>(null);
  const [working, setWorking] = createSignal(false);
  const [dropActive, setDropActive] = createSignal(false);
  const { pushToast } = useToastState;
  const { markSettingsSaved } = useSettingsSavedState;
  let unlistenDrop: (() => void) | undefined;
  let unmounted = false;

  const openPlugin = createMemo(() => plugins.find(plugin => plugin.manifest.id === openId()) ?? null);
  const isUpdate = createMemo(() => !!review()?.inspection.installedVersion);
  const reviewTitle = createMemo(() => {
    const current = review()?.inspection;
    if (!current) return "";
    return current.installedVersion ? "Update this plugin?" : "Install this plugin?";
  });
  const reviewVersion = createMemo(() => {
    const current = review()?.inspection;
    if (!current) return "";
    return current.installedVersion ? `${current.installedVersion} → ${current.manifest.version}` : current.manifest.version;
  });
  const added = createMemo(() => {
    const current = review()?.inspection;
    return current?.installedVersion ? { permissions: current.addedPermissions, hosts: current.addedHosts } : undefined;
  });
  const asksForMore = createMemo(() => (added()?.permissions.length ?? 0) + (added()?.hosts.length ?? 0) > 0);

  createEffect(() => {
    const requested = requestedOpen();
    if (!requested) return;
    setOpenId(requested);
    clearRequestedOpen();
  });

  onMount(async () => {
    await refresh();

    const unlisten = await getCurrentWebview().onDragDropEvent(event => {
      switch (event.payload.type) {
        case "enter":
        case "over":
          setDropActive(true);
          break;
        case "leave":
          setDropActive(false);
          break;
        case "drop": {
          setDropActive(false);
          const dropped = event.payload.paths.find(path => path.toLowerCase().endsWith(`.${PACKAGE_EXTENSION}`));
          if (dropped) inspect(dropped);
          else pushToast("That is not a Rosemyne plugin file", "error", 6000);
          break;
        }
      }
    });
    if (unmounted) unlisten();
    else unlistenDrop = unlisten;
  });

  onCleanup(() => {
    unmounted = true;
    unlistenDrop?.();
  });

  async function run(action: () => Promise<unknown>) {
    setWorking(true);
    try {
      await action();
      await refresh();
      markSettingsSaved();
    } catch (error) {
      pushToast(errorMessage(error), "error", 6000);
    } finally {
      setWorking(false);
    }
  }

  async function inspect(path: string) {
    try {
      setReview({ path, inspection: await safeInvoke("inspect_plugin_package", { path }) });
    } catch (error) {
      pushToast(errorMessage(error), "error", 6000);
    }
  }

  async function pickPackage() {
    const path = await open({ multiple: false, filters: [{ name: "Rosemyne plugin", extensions: [PACKAGE_EXTENSION] }] });
    if (typeof path === "string") inspect(path);
  }

  async function pickFolder() {
    const path = await open({ directory: true, multiple: false });
    if (typeof path === "string") run(() => safeInvoke("load_unpacked_plugin", { path }));
  }

  function install() {
    const current = review();
    if (!current) return;
    run(async () => {
      await safeInvoke("install_plugin", { path: current.path, wasmSha256: current.inspection.wasmSha256 });
      setReview(null);
    });
  }

  function move(index: number, by: number) {
    const ids = plugins.map(plugin => plugin.manifest.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => safeInvoke("set_plugin_order", { ids }));
  }

  return <>
    <Show when={openPlugin()} keyed fallback={
      <SettingsPage title="Plugins" description="Add-ons that run on your captures. Each one only gets what you allow when you install it.">
        <SettingsGroup
          title="Installed plugins"
          right={<>
            <Button size="sm" tooltip="For plugin authors: load a build folder in place" onClick={pickFolder}><FolderOpen size={14} />Load unpacked</Button>
            <Button size="sm" variant="primary" onClick={pickPackage}><Plus size={14} />Install from file</Button>
          </>}
        >
          <For each={plugins} fallback={
            <div class={styles.Empty}>
              <EmptyState icon={<Puzzle size={20} />} title="No plugins yet">
                Install one from a .rosemyne-plugin file, or drop the file here.
              </EmptyState>
            </div>
          }>
            {(plugin, index) => (
              <div class={styles.Row}>
                <button type="button" class={styles.Open} onClick={() => setOpenId(plugin.manifest.id)}>
                  <PluginIcon plugin={plugin} size={32} />
                  <span class={styles.Info}>
                    <b>
                      {plugin.manifest.name}
                      <span class={styles.Version}>{plugin.manifest.version}</span>
                      <StatusBadge plugin={plugin} />
                    </b>
                    <span class={styles.Summary}>{plugin.problem ?? plugin.lastError ?? plugin.manifest.description ?? plugin.manifest.id}</span>
                  </span>
                  <ChevronRight size={15} class={styles.Chevron} />
                </button>
                <div class={styles.Actions}>
                  <Button isIcon size="sm" tooltip="Run earlier" disabled={working() || index() === 0} onClick={() => move(index(), -1)}>
                    <ChevronUp size={15} />
                  </Button>
                  <Button isIcon size="sm" tooltip="Run later" disabled={working() || index() === plugins.length - 1} onClick={() => move(index(), 1)}>
                    <ChevronDown size={15} />
                  </Button>
                  <Switch
                    checked={plugin.enabled}
                    disabled={working()}
                    label={`Enable ${plugin.manifest.name}`}
                    onChange={enabled => run(() => safeInvoke("set_plugin_enabled", { id: plugin.manifest.id, enabled }))}
                  />
                </div>
              </div>
            )}
          </For>
        </SettingsGroup>
        <Show when={dropActive()}>
          <div class={styles.DropHint}>Drop the plugin file to review it</div>
        </Show>
      </SettingsPage>
    }>
      {plugin => <PluginPage plugin={plugin} onBack={() => setOpenId(null)} />}
    </Show>

    <Modal
      show={!!review()}
      onHide={() => setReview(null)}
      title={reviewTitle()}
      width={480}
      footer={<>
        <Button onClick={() => setReview(null)}>Cancel</Button>
        <Button variant="primary" disabled={working()} onClick={install}>{isUpdate() ? "Update" : "Install"}</Button>
      </>}
    >
      <Show when={review()}>
        {current => (
          <div class={styles.Review}>
            <div class={styles.ReviewHead}>
              <span class={styles.ReviewIcon}><Puzzle size={22} /></span>
              <div class={styles.ReviewTitle}>
                <b>
                  {current().inspection.manifest.name}
                  <Badge>{reviewVersion()}</Badge>
                </b>
                <span>{[current().inspection.manifest.author, current().inspection.manifest.id].filter(Boolean).join(" · ")}</span>
              </div>
            </div>
            <Show when={current().inspection.manifest.description}>
              {description => <p class={styles.ReviewDescription}>{description()}</p>}
            </Show>
            <div class={styles.ReviewLabel}>
              {isUpdate()
                ? asksForMore() ? "This version asks for more than the one you have" : "It asks for the same as the version you have"
                : "It will be able to"}
            </div>
            <div class={styles.ReviewCard}>
              <PermissionList manifest={current().inspection.manifest} added={added()} />
            </div>
          </div>
        )}
      </Show>
    </Modal>
  </>;
}

export default PluginSettings;
