import styles from "./SavedFilterBar.module.scss";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { SelectItem } from "../../../../types";
import useTagFilterState from "../../../../states/tagFilterState";
import useToastState from "../../../../states/toastState";
import { describeUploaderError } from "../../../../components/UploaderCreator/UploaderCreator";
import Button from "../../../../components/Button/Button";
import Select from "../../../../components/Select/Select";
import Input from "../../../../components/Input/Input";
import Modal from "../../../../components/Modal/Modal";
import { Bookmark, Save, Trash2 } from "lucide-solid";

const NO_FILTER = "";

function SavedFilterBar() {
  const { savedFilters, activeFilterName, isFilterDirty, anyFilterActive, refreshSavedFilters, loadFilter, saveFilterAs, deleteFilter, clearFilter } = useTagFilterState;
  const { pushToast } = useToastState;
  const [naming, setNaming] = createSignal(false);
  const [draftName, setDraftName] = createSignal("");

  onMount(() => refreshSavedFilters().catch(error =>
    pushToast(`Failed to load saved filters: ${describeUploaderError(error)}`, "error", 6000),
  ));

  const items = createMemo<SelectItem<string>[]>(() => [
    { id: NO_FILTER, value: NO_FILTER, label: "No filter" },
    ...savedFilters().map(saved => ({ id: saved.name, value: saved.name, label: saved.name })),
  ]);

  const savable = createMemo(() => anyFilterActive() && (activeFilterName() === null || isFilterDirty()));
  const trimmedName = createMemo(() => draftName().trim());
  const replacing = createMemo(() =>
    savedFilters().some(saved => saved.name.toLowerCase() === trimmedName().toLowerCase()),
  );

  function openNaming() {
    setDraftName("");
    setNaming(true);
  }

  async function saveChanges() {
    const name = activeFilterName();
    if (!name) return;
    try {
      await saveFilterAs(name);
    } catch (error) {
      pushToast(`Failed to save filter: ${describeUploaderError(error)}`, "error", 6000);
    }
  }

  async function confirmSave() {
    if (trimmedName().length === 0) return;
    try {
      await saveFilterAs(trimmedName());
      setNaming(false);
    } catch (error) {
      pushToast(`Failed to save filter: ${describeUploaderError(error)}`, "error", 6000);
    }
  }

  async function removeActive() {
    const name = activeFilterName();
    if (!name) return;
    try {
      await deleteFilter(name);
    } catch (error) {
      pushToast(`Failed to delete filter: ${describeUploaderError(error)}`, "error", 6000);
    }
  }

  return (
    <div class={styles.SavedFilterBar}>
      <span class={styles.Label}>Saved</span>
      <Select
        variant="pill"
        class={styles.Picker}
        value={activeFilterName() ?? NO_FILTER}
        items={items()}
        onItemClick={item => {
          if (item.value === NO_FILTER) return clearFilter();
          const saved = savedFilters().find(entry => entry.name === item.value);
          if (saved) loadFilter(saved);
        }}
      />
      <Show when={activeFilterName() && isFilterDirty()}>
        <span class={styles.Edited}>edited</span>
      </Show>
      <span class={styles.Spacer} />
      <Show when={activeFilterName()}>
        <Button size="sm" variant="danger" onClick={removeActive}><Trash2 size={14} />Delete</Button>
      </Show>
      <Show when={activeFilterName() && isFilterDirty()}>
        <Button size="sm" variant="ghost" onClick={saveChanges}><Save size={14} />Save changes</Button>
      </Show>
      <Show when={savable()}>
        <Button size="sm" variant="ghost" onClick={openNaming}>
          <Bookmark size={14} />{activeFilterName() ? "Save as…" : "Save filter"}
        </Button>
      </Show>

      <Modal
        show={naming()}
        onHide={() => setNaming(false)}
        title="Save filter"
        width={420}
        footer={<>
          <Button onClick={() => setNaming(false)}>Cancel</Button>
          <Button variant="primary" disabled={trimmedName().length === 0} onClick={confirmSave}>
            {replacing() ? "Replace" : "Save"}
          </Button>
        </>}
      >
        <div class={styles.SaveBody} onKeyDown={event => event.key === "Enter" && confirmSave()}>
          <Input
            value={draftName()}
            placeholder="Filter name"
            focusOnCreation
            selectOnClick
            onChange={event => setDraftName(event.currentTarget.value)}
          />
          <span class={styles.SaveHint}>Saves the search, type, date and the advanced conditions.</span>
          <Show when={replacing()}>
            <span class={styles.SaveHint}>A filter named “{trimmedName()}” already exists and will be replaced.</span>
          </Show>
        </div>
      </Modal>
    </div>
  );
}

export default SavedFilterBar;
