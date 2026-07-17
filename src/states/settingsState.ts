import { createRoot, onMount } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { ShortcutBinding } from "../types";
import { safeInvoke } from "@core/helpers/safeInvoke";

function useSettingsStateInner() {
  const [shortcuts, setShortcuts] = createStore<Array<ShortcutBinding>>([]);

  onMount(async () => {
    setShortcuts(await safeInvoke("get_shortcuts"))
  })

  function updateShortcuts(newData: Array<ShortcutBinding>) {
    setShortcuts(reconcile(newData, { merge: true, key: "id" }));
  }

  async function removeShortcut(id: string) {
    await safeInvoke("remove_shortcut", { id });
    setShortcuts(shortcuts.filter(e => e.id !== id));
  }

  async function addShortcut(newShortcut: ShortcutBinding) {
    await safeInvoke("add_shortcut", { newShortcut });
    setShortcuts(produce(shortcuts => {
      const existing = shortcuts.find(e => e.id === newShortcut.id);

      if (existing) {
        existing.keys = newShortcut.keys;
        existing.method = newShortcut.method;
      }
      else shortcuts.push(newShortcut)
    }));
  }

  return {
    shortcuts, updateShortcuts, removeShortcut, addShortcut
  };
}

const useSettingsState = createRoot(useSettingsStateInner);
export default useSettingsState;
