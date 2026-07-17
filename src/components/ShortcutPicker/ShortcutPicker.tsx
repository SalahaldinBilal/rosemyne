import styles from "./ShortcutPicker.module.scss";
import { batch, createEffect, createMemo, createSignal, on, Show } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { createTrigger } from "@solid-primitives/trigger";
import { beautifyCamelOrPascalCase } from "../../helpers";
import { makeEventListener } from "@solid-primitives/event-listener";
import Button from "@core/components/Button/Button";
import { ShortcutKeys } from "../../types";
import Modal from "@core/components/Modal/Modal";
import KeyRenderer from "../KeyRenderer/KeyRenderer";

function ShortcutPicker(props: { show: boolean, onHide: () => any, onConfirm: (keys: ShortcutKeys) => any, preRegisteredShortcuts?: Array<ShortcutKeys> }) {
  const [pressedKeys, setPressedKeys] = createStore<ShortcutKeys>({ keys: [] });
  const [hasPressedMainKey, setHasPressedMainKey] = createSignal(false);
  const [track, dirty] = createTrigger();

  const shortcutAlreadyExists = createMemo(() => {
    if (!props.preRegisteredShortcuts?.length || !pressedKeys.keys.length) return false;

    return props.preRegisteredShortcuts.some(shortcut =>
      shortcut.keys.length === pressedKeys.keys.length &&
      shortcut.keys.every((key, index) => key.key === pressedKeys.keys[index].key)
    );
  })
  let containerElement: HTMLDivElement;

  // Start each picking session clean, even if keys leaked in beforehand.
  createEffect(on(() => props.show, show => {
    if (show) clear();
  }, { defer: true }))

  makeEventListener(
    window,
    "keydown",
    event => {
      // Escape closes the modal (see Modal) instead of being recordable.
      if (!props.show || event.key === "Escape") return;

      const { pressedKey, userKey } = deriveKeyNames(event);

      if (hasPressedMainKey() || pressedKeys.keys.find(existing => existing.key === pressedKey)) return dirty();

      if (!metaKeys.includes(pressedKey)) setHasPressedMainKey(true);

      addKey(pressedKey, userKey);
    },
    { passive: true }
  )

  // Print Screen (and possibly other OS-intercepted keys) never fires
  // `keydown` in the webview , Windows' "Use PrtScn to open screen snipping"
  // grabs it first , but `keyup` still does. This only ever engages for a key
  // the keydown listener above missed entirely: any key it did see is either
  // already recorded (deduped below) or has already ended the recording via
  // `hasPressedMainKey`, so normal keys are untouched by this.
  makeEventListener(
    window,
    "keyup",
    event => {
      if (!props.show || event.key === "Escape" || hasPressedMainKey()) return;

      const { pressedKey, userKey } = deriveKeyNames(event);

      if (metaKeys.includes(pressedKey) || pressedKeys.keys.find(existing => existing.key === pressedKey)) return;

      setHasPressedMainKey(true);
      addKey(pressedKey, userKey);
    },
    { passive: true }
  )

  createEffect(on(track, () => {
    if (pressedKeys.keys.length === 0) return;

    containerElement!.animate(shakeAnimationKeys, { duration: 250, iterations: 1 });
  }))

  function addKey(key: string, char: string) {
    setPressedKeys("keys", [...pressedKeys.keys, { key, char }]);
  }

  function removeKey(keyIndex: number) {
    batch(() => {
      const keysLength = pressedKeys.keys.length;

      setPressedKeys("keys", pressedKeys.keys.filter((_, index) => index !== keyIndex));

      if (keyIndex === keysLength - 1) setHasPressedMainKey(false)
    })
  }

  function clear() {
    setPressedKeys("keys", []);
    setHasPressedMainKey(false);
  }

  function confirm() {
    props.onConfirm(structuredClone(unwrap(pressedKeys)))
  }

  return (
    <Modal title="Shortcut Picker" show={props.show} onHide={props.onHide}>
      <div class={styles.ShortcutPickerContainer}>
        <div class={styles.KeyRenderer}>
          <KeyRenderer keys={pressedKeys} ref={containerElement!} onRemove={(_, index) => removeKey(index)} placeholder="Type anything to start registering your shortcut ..." />
        </div>
        <Show when={shortcutAlreadyExists()}>
          <div class={styles.Warning}>This shortcut is already in use.</div>
        </Show>
        <div class={styles.Controls}>
          <Button onClick={clear}>
            Clear All
          </Button>
          <Button onClick={confirm} style={{ "margin-left": "auto" }} disabled={!hasPressedMainKey() || shortcutAlreadyExists()}>
            Save Changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default ShortcutPicker;

const metaKeys = ["Shift", "Alt", "Control", "Super"];
const keyReplacements: { [key: string]: string } = {
  " ": "Space",
  "Meta": "Super"
}

function deriveKeyNames(event: KeyboardEvent): { pressedKey: string, userKey: string } {
  const code = event.code.endsWith("Left") || event.code.endsWith("Right") ? beautifyCamelOrPascalCase(event.code).split(" ")[0] : event.code;
  return {
    pressedKey: keyReplacements[code] ?? code,
    userKey: keyReplacements[event.key] ?? event.key,
  };
}

const shakeAnimationKeys = [
  { transform: "translate(0px, 0px)" },
  { transform: "translate(0px, -1px) " },
  { transform: "translate(-2px, 0px)" },
  { transform: "translate(2px, 1px)" },
  { transform: "translate(0px, 0px)" },
  { transform: "translate(0px, 1px) " },
  { transform: "translate(-2px, 0px)" },
  { transform: "translate(2px, 0px) " },
  { transform: "translate(0px, 0px)" },
  { transform: "translate(0px, 1px)" },
  { transform: "translate(0px, -1px) " },
];