import styles from "./UploaderSettings.module.scss";
import UploaderCreator from "@core/components/UploaderCreator/UploaderCreator";
import Button from "@core/components/Button/Button";
import Badge, { MethodBadge } from "@core/components/Badge/Badge";
import Modal from "@core/components/Modal/Modal";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import { SavedUploader } from "@core/types/request";
import { createSignal, For, onMount, Show } from "solid-js";
import { Copy, Pencil, Plus, Puzzle, Star, Trash2 } from "lucide-solid";
import { useNavigate } from "@solidjs/router";
import usePluginsState from "@core/states/pluginsState";
import { PluginUploaderInfo } from "@core/types/plugins";
import useToastState from "@core/states/toastState";
import useSettingsSavedState from "@core/states/settingsSavedState";
import { SettingRow, SettingsGroup, SettingsPage } from "../SettingsLayout/SettingsLayout";

function UploaderSettings() {
  const [uploaders, setUploaders] = createSignal<SavedUploader[]>([]);
  const [pluginUploaders, setPluginUploaders] = createSignal<PluginUploaderInfo[]>([]);
  const [defaultId, setDefaultId] = createSignal<string | null>(null);
  const { requestOpen } = usePluginsState;
  const navigate = useNavigate();
  const [editing, setEditing] = createSignal<SavedUploader | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal<SavedUploader | null>(null);
  const { pushToast } = useToastState;
  const { markSettingsSaved } = useSettingsSavedState;

  async function refresh() {
    setUploaders(await safeInvoke("get_uploaders"));
    setPluginUploaders(await safeInvoke("list_plugin_uploaders"));
    setDefaultId(await safeInvoke("get_default_uploader"));
  }

  function openPlugin(uploader: PluginUploaderInfo) {
    requestOpen(uploader.pluginId);
    navigate("/settings/plugins");
  }

  onMount(refresh);

  async function run(action: () => Promise<any>) {
    try {
      await action();
      await refresh();
      markSettingsSaved();
    } catch (err) {
      pushToast(errorMessage(err), "error", 6000);
    }
  }

  const save = (uploader: SavedUploader) => run(async () => {
    await safeInvoke("save_uploader", { uploader });
    setEditing(null);
  });

  const duplicate = (uploader: SavedUploader) => run(() => safeInvoke("save_uploader", {
    uploader: { ...structuredClone(uploader), id: crypto.randomUUID(), name: `${uploader.name} (copy)` },
  }));

  const remove = (uploader: SavedUploader) => run(async () => {
    await safeInvoke("delete_uploader", { id: uploader.id });
    setPendingDelete(null);
  });

  const makeDefault = (uploader: { id: string }) => run(() => safeInvoke("set_default_uploader", { id: uploader.id }));

  return <>
    <Show when={editing()} keyed fallback={
      <SettingsPage title="Uploaders" description="Where captures go when you upload them.">
        <SettingsGroup
          title="Saved uploaders"
          right={<Button size="sm" variant="primary" onClick={() => setEditing("new")}><Plus size={14} />New uploader</Button>}
        >
          <For each={uploaders()} fallback={
            <SettingRow label="No uploaders yet" hint="Add one to share captures with a link." />
          }>
            {uploader => (
              <div class={styles.Row}>
                <div class={styles.Info}>
                  <b>
                    {uploader.name}
                    <Show when={uploader.id === defaultId()}>
                      <Badge tone="accent"><Star size={10} />Default</Badge>
                    </Show>
                    <Show when={uploader.autoUpload}>
                      <Badge>Auto upload</Badge>
                    </Show>
                  </b>
                  <div class={styles.Url} title={uploader.options.url}>
                    <MethodBadge method={uploader.options.method} />
                    <span>{uploader.options.url}</span>
                  </div>
                </div>
                <div class={styles.Actions}>
                  <Show when={uploader.id !== defaultId()}>
                    <Button isIcon size="sm" tooltip="Set as default" onClick={() => makeDefault(uploader)}>
                      <Star size={15} />
                    </Button>
                  </Show>
                  <Button isIcon size="sm" tooltip="Edit" onClick={() => setEditing(uploader)}>
                    <Pencil size={15} />
                  </Button>
                  <Button isIcon size="sm" tooltip="Duplicate" onClick={() => duplicate(uploader)}>
                    <Copy size={15} />
                  </Button>
                  <Button isIcon size="sm" variant="danger" tooltip="Delete" onClick={() => setPendingDelete(uploader)}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            )}
          </For>
        </SettingsGroup>
        <Show when={pluginUploaders().length > 0}>
          <SettingsGroup title="From plugins">
            <For each={pluginUploaders()}>
              {uploader => (
                <div class={styles.Row}>
                  <div class={styles.Info}>
                    <b>
                      {uploader.name}
                      <Show when={uploader.id === defaultId()}>
                        <Badge tone="accent"><Star size={10} />Default</Badge>
                      </Show>
                      <Show when={uploader.autoUpload}>
                        <Badge>Auto upload</Badge>
                      </Show>
                    </b>
                    <div class={styles.Url}>
                      <span>Plugin: {uploader.pluginName}</span>
                    </div>
                  </div>
                  <div class={styles.Actions}>
                    <Show when={uploader.id !== defaultId()}>
                      <Button isIcon size="sm" tooltip="Set as default" onClick={() => makeDefault(uploader)}>
                        <Star size={15} />
                      </Button>
                    </Show>
                    <Button isIcon size="sm" tooltip="Open the plugin's settings" onClick={() => openPlugin(uploader)}>
                      <Puzzle size={15} />
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </SettingsGroup>
        </Show>
      </SettingsPage>
    }>
      {editing =>
        <UploaderCreator
          initial={editing === "new" ? undefined : editing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      }
    </Show>
    <Modal
      show={!!pendingDelete()}
      onHide={() => setPendingDelete(null)}
      title="Delete uploader?"
      width={420}
      footer={<>
        <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
        <Button variant="danger-solid" onClick={() => remove(pendingDelete()!)}><Trash2 size={15} />Delete</Button>
      </>}
    >
      <p>"{pendingDelete()?.name}" is removed for good.</p>
    </Modal>
  </>
}

export default UploaderSettings;
