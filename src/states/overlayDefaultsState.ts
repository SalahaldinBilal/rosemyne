import { createRoot, onMount } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { OverlayDefaultOverrides } from "@core/types";
import { ImageOverlay } from "@core/types/imageOverlay";
import { OVERLAY_DEFAULT_ATTRIBUTES } from "@core/constants";

// A color picker drag fires many rapid changes; only the settled value is
// worth persisting to disk.
const SAVE_DEBOUNCE_MS = 200;

const ALL_OVERLAY_TYPES = Object.keys(OVERLAY_DEFAULT_ATTRIBUTES) as ImageOverlay["type"][];

function useOverlayDefaultsStateInner() {
  const [overrides, setOverrides] = createStore<OverlayDefaultOverrides>({});
  // Built-in defaults with any saved overrides merged in, kept as one
  // persistent store mutated in place (never replaced wholesale). The
  // Overlay Defaults settings page binds directly to a slice of this, so an
  // open color picker's identity survives every edit instead of being torn
  // down and rebuilt mid-interaction (which was closing it instantly).
  const [merged, setMerged] = createStore(structuredClone(OVERLAY_DEFAULT_ATTRIBUTES));
  let saveTimer: number | undefined;

  // Rebuilds `merged` from the built-ins + whatever's currently persisted,
  // for every overlay type , authoritative, not incremental, so it also
  // rolls back overrides that were reset since the last load. `reconcile`
  // only touches the leaves that actually changed, so an open color picker
  // elsewhere isn't disturbed by a refresh that changes nothing for its type.
  async function load() {
    const saved = await safeInvoke("get_overlay_defaults");
    setOverrides(reconcile(saved));

    for (const type of ALL_OVERLAY_TYPES) {
      const rebuilt = structuredClone(OVERLAY_DEFAULT_ATTRIBUTES[type]);
      const override = saved[type] as Record<string, unknown> | undefined;

      if (override) {
        for (const [name, value] of Object.entries(override)) {
          if (value !== undefined && name in rebuilt) {
            (rebuilt as any)[name].value = value;
          }
        }
      }

      setMerged(type, reconcile(rebuilt));
    }
  }

  onMount(load);

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      safeInvoke("set_overlay_defaults", { overlayDefaults: unwrap(overrides) });
    }, SAVE_DEBOUNCE_MS);
  }

  function setOverrideValue<Type extends ImageOverlay["type"]>(
    type: Type,
    attribute: keyof typeof OVERLAY_DEFAULT_ATTRIBUTES[Type],
    value: unknown,
  ) {
    setOverrides(type, current => ({ ...current, [attribute]: value }));
    setMerged(type, attribute as never, "value" as never, value as never);
    persist();
  }

  function resetOverrides(type: ImageOverlay["type"]) {
    setOverrides(type, undefined);
    setMerged(type, reconcile(structuredClone(OVERLAY_DEFAULT_ATTRIBUTES[type])));
    persist();
  }

  /** Snapshot for a freshly placed overlay of `type` to start with , built-in defaults with any saved overrides merged in. */
  function defaultAttributesFor<Type extends ImageOverlay["type"]>(type: Type): typeof OVERLAY_DEFAULT_ATTRIBUTES[Type] {
    return structuredClone(unwrap(merged[type]));
  }

  return { overrides, merged, setOverrideValue, resetOverrides, defaultAttributesFor, refresh: load };
}

const useOverlayDefaultsState = createRoot(useOverlayDefaultsStateInner);
export default useOverlayDefaultsState;
