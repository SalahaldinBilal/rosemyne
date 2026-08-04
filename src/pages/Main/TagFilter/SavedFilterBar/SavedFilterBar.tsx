import styles from "./SavedFilterBar.module.scss";
import ghost from "../controls/ghost.module.scss";
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
  const { savedFilters, activeFilterName, isFilterDirty, ruleCount, refreshSavedFilters, loadFilter, saveFilterAs, deleteFilter, clearFilter } = useTagFilterState;
  const { pushToast } = useToastState;
  const [naming, setNaming] = createSignal(false);
  const [draftName, setDraftName] = createSignal("");

  onMount(() => refreshSavedFilters().catch(error =>
    pushToast(`Failed to load saved filters: ${describeUploaderError(error)}`, "error", 6000),
  ));

  const items = createMemo<SelectItem<string>[]>(() => [
    { id: NO_FILTER, value: NO_FILTER, label: "No filter" },
    ...savedFilters().map(saved => ({
      id: saved.name,
      value: saved.name,
      label: saved.name === activeFilterName() && isFilterDirty() ? `${saved.name} (edited)` : saved.name,
    })),
  ]);

  const savable = createMemo(() => ruleCount() > 0 && (activeFilterName() === null || isFilterDirty()));

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
      <div class={styles.Title}>
        <Bookmark size={15} /> Saved filter
      </div>
      <Select
        borderless
        style={{ "min-width": "180px" }}
        value={activeFilterName() ?? NO_FILTER}
        items={items()}
        onItemClick={item => {
          if (item.value === NO_FILTER) return clearFilter();
          const saved = savedFilters().find(entry => entry.name === item.value);
          if (saved) loadFilter(saved);
        }}
      />
      <div class={styles.Actions}>
        <Show when={activeFilterName()}>
          <button class={ghost.Ghost} onClick={removeActive}>
            <Trash2 size={15} /> Delete
          </button>
        </Show>
        <Show when={activeFilterName() && isFilterDirty()}>
          <button class={ghost.Ghost} onClick={saveChanges}>
            <Save size={15} /> Save changes
          </button>
        </Show>
        <Show when={savable()}>
          <button class={ghost.Ghost} onClick={openNaming}>
            <Bookmark size={15} /> {activeFilterName() ? "Save as…" : "Save filter"}
          </button>
        </Show>
      </div>

      <Modal show={naming()} onHide={() => setNaming(false)} title="Save filter" width={420}>
        <div class={styles.SaveBody} onKeyDown={event => event.key === "Enter" && confirmSave()}>
          <Input
            value={draftName()}
            placeholder="Filter name"
            focusOnCreation
            selectOnClick
            onChange={event => setDraftName(event.currentTarget.value)}
          />
          <Show when={replacing()}>
            <div class={styles.SaveHint}>A filter named “{trimmedName()}” already exists and will be replaced.</div>
          </Show>
          <div class={styles.SaveFooter}>
            <Button onClick={() => setNaming(false)}>Cancel</Button>
            <Button filled color="var(--base-blue)" disabled={trimmedName().length === 0} onClick={confirmSave}>
              {replacing() ? "Replace" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default SavedFilterBar;
