import { createRoot, createSignal } from "solid-js";

const SAVED_VISIBLE_MS = 1600;

// Settings changes don't toast. They flip the settings sidebar footer to "Saved" for a moment instead.
function useSettingsSavedStateInner() {
  const [saved, setSaved] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function markSettingsSaved() {
    clearTimeout(timer);
    setSaved(false);
    queueMicrotask(() => setSaved(true));
    timer = setTimeout(() => setSaved(false), SAVED_VISIBLE_MS);
  }

  return { saved, markSettingsSaved };
}

const useSettingsSavedState = createRoot(useSettingsSavedStateInner);
export default useSettingsSavedState;
