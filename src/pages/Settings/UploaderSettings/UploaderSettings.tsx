import styles from "./UploaderSettings.module.scss";
import UploaderCreator from "@core/components/UploaderCreator/UploaderCreator";
import Button from "@core/components/Button/Button";
import Modal from "@core/components/Modal/Modal";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { SavedUploader } from "@core/types/request";
import { createSignal, For, onMount, Show } from "solid-js";
import { Copy, Pencil, Plus, Star, Trash2 } from "lucide-solid";
import useToastState from "@core/states/toastState";

function UploaderSettings() {
  const [uploaders, setUploaders] = createSignal<SavedUploader[]>([]);
  const [defaultId, setDefaultId] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<SavedUploader | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal<SavedUploader | null>(null);
  const { pushToast } = useToastState;

  async function refresh() {
    setUploaders(await safeInvoke("get_uploaders"));
    setDefaultId(await safeInvoke("get_default_uploader"));
  }

  onMount(refresh);

  async function run(action: () => Promise<any>) {
    try {
      await action();
      await refresh();
    } catch (err) {
      pushToast(typeof err === "string" ? err : JSON.stringify(err), "error", 6000);
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

  const makeDefault = (uploader: SavedUploader) => run(() => safeInvoke("set_default_uploader", { id: uploader.id }));

  return <div class={styles.UploaderSettings}>
    <Show when={editing()} keyed fallback={
      <>
        <div class={styles.Toolbar}>
          <Button onClick={() => setEditing("new")}>
            <Plus style={{ "margin-right": '6px' }} /> New uploader
          </Button>
        </div>
        <Show when={uploaders().length > 0} fallback={
          <div class={styles.Empty}>No uploaders yet , create one to start sharing screenshots.</div>
        }>
          <div class={styles.List}>
            <For each={uploaders()}>
              {uploader =>
                <div class={styles.Row}>
                  <div class={styles.Info}>
                    <div class={styles.Name}>
                      {uploader.name}
                      <Show when={uploader.id === defaultId()}>
                        <span class={styles.DefaultBadge}>default</span>
                      </Show>
                    </div>
                    <div class={styles.Summary} title={uploader.options.url}>
                      {uploader.options.method} {uploader.options.url}
                    </div>
                  </div>
                  <div class={styles.Actions}>
                    <Button isIcon tooltip="Set as default" disabled={uploader.id === defaultId()} onClick={() => makeDefault(uploader)}>
                      <Star size={18} />
                    </Button>
                    <Button isIcon tooltip="Edit" onClick={() => setEditing(uploader)}>
                      <Pencil size={18} />
                    </Button>
                    <Button isIcon tooltip="Duplicate" onClick={() => duplicate(uploader)}>
                      <Copy size={18} />
                    </Button>
                    <Button isIcon tooltip="Delete" onClick={() => setPendingDelete(uploader)}>
                      <Trash2 size={18} />
                    </Button>
                  </div>
                </div>
              }
            </For>
          </div>
        </Show>
      </>
    }>
      {editing =>
        <UploaderCreator
          initial={editing === "new" ? undefined : editing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      }
    </Show>
    <Modal show={!!pendingDelete()} onHide={() => setPendingDelete(null)} title="Delete uploader?" width={420}>
      <div class={styles.ConfirmBody}>
        <p>"{pendingDelete()?.name}" will be removed permanently.</p>
        <div class={styles.ConfirmActions}>
          <Button color="var(--danger-color)" onClick={() => remove(pendingDelete()!)}>Delete</Button>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
        </div>
      </div>
    </Modal>
  </div>
}

export default UploaderSettings;
