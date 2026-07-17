import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { listen } from "@tauri-apps/api/event";
import styles from "./ShortcutSettings.module.scss";
import KeyRenderer from "@core/components/KeyRenderer/KeyRenderer";
import ShortcutPicker from "@core/components/ShortcutPicker/ShortcutPicker";
import Button from "@core/components/Button/Button";
import Select from "@core/components/Select/Select";
import Input from "@core/components/Input/Input";
import Modal from "@core/components/Modal/Modal";
import { CaptureTarget, MonitorInfo, ShortcutBinding, ShortcutKeys } from "@core/types";
import { safeInvoke } from "@core/helpers/safeInvoke";
import useSettingsState from "@core/states/settingsState";
import useToastState from "@core/states/toastState";
import { Crop, Monitor, Plus, X } from "lucide-solid";

const SCREENSHOT_ID = "screenshot";
const RECORD_ID = "record";

type PickerTarget =
  | { kind: "screenshot" }
  | { kind: "record" }
  | { kind: "newInstant" }
  | { kind: "rebind"; id: string };

type RegionData = { x: number; y: number; width: number; height: number };

function cloneTarget(target: CaptureTarget): CaptureTarget {
  return target.type === "monitor"
    ? { type: "monitor", data: { id: target.data.id } }
    : { type: "region", data: { ...target.data } };
}

function ShortcutSettings() {
  const { shortcuts, addShortcut, removeShortcut } = useSettingsState;
  const { pushToast } = useToastState;

  const [monitors, setMonitors] = createSignal<MonitorInfo[]>([]);
  const [picker, setPicker] = createSignal<PickerTarget | null>(null);
  const [editingTargetId, setEditingTargetId] = createSignal<string | null>(null);
  const [targetDraft, setTargetDraft] = createStore<{ target: CaptureTarget }>({
    target: { type: "monitor", data: { id: "" } },
  });

  onMount(async () => {
    try {
      setMonitors(await safeInvoke("list_monitors"));
    } catch {
      // Monitor listing is best-effort; the region mode still works without it.
    }
  });

  const screenshotBinding = createMemo(() => shortcuts.find(s => s.method.type === "screenshot"));
  const screenshotKeys = createMemo(() => screenshotBinding()?.keys);
  const hasScreenshot = createMemo(() => (screenshotKeys()?.keys.length ?? 0) > 0);
  const recordBinding = createMemo(() => shortcuts.find(s => s.method.type === "record"));
  const recordKeys = createMemo(() => recordBinding()?.keys);
  const hasRecord = createMemo(() => (recordKeys()?.keys.length ?? 0) > 0);
  const instantBindings = createMemo(() => shortcuts.filter(s => s.method.type === "instantCapture"));
  const monitorItems = createMemo(() =>
    monitors().map(m => ({ id: m.id, value: m, label: `${m.name} , ${m.width}×${m.height}` }))
  );

  function run(action: () => Promise<any>) {
    return action().catch(err =>
      pushToast(`Could not update the shortcut: ${typeof err === "string" ? err : JSON.stringify(err)}`, "error", 6000)
    );
  }

  function defaultTarget(): CaptureTarget {
    const first = monitors()[0];
    return first
      ? { type: "monitor", data: { id: first.id } }
      : { type: "region", data: { x: 0, y: 0, width: 100, height: 100 } };
  }

  function pickerExcludeId(): string | undefined {
    const p = picker();
    if (!p) return undefined;
    if (p.kind === "rebind") return p.id;
    if (p.kind === "screenshot") return screenshotBinding()?.id ?? SCREENSHOT_ID;
    if (p.kind === "record") return recordBinding()?.id ?? RECORD_ID;
    return undefined;
  }

  function onPickerConfirm(keys: ShortcutKeys) {
    const p = picker();
    setPicker(null);
    if (!p) return;

    if (p.kind === "screenshot") {
      run(() => addShortcut({ id: screenshotBinding()?.id ?? SCREENSHOT_ID, keys, method: { type: "screenshot" } }));
    } else if (p.kind === "record") {
      run(() => addShortcut({ id: recordBinding()?.id ?? RECORD_ID, keys, method: { type: "record" } }));
    } else if (p.kind === "newInstant") {
      run(() => addShortcut({ id: crypto.randomUUID(), keys, method: { type: "instantCapture", data: defaultTarget() } }));
    } else {
      const binding = shortcuts.find(s => s.id === p.id);
      if (binding) run(() => addShortcut({ id: binding.id, keys, method: cloneMethod(binding) }));
    }
  }

  function cloneMethod(binding: ShortcutBinding): ShortcutBinding["method"] {
    if (binding.method.type === "instantCapture") {
      return { type: "instantCapture", data: cloneTarget(binding.method.data) };
    }
    return { type: binding.method.type };
  }

  function targetSummary(target: CaptureTarget): string {
    if (target.type === "monitor") {
      const m = monitors().find(x => x.id === target.data.id);
      return m ? `Monitor: ${m.name}` : `Monitor: ${target.data.id || "unset"}`;
    }
    return `Region ${target.data.width}×${target.data.height} @ (${target.data.x}, ${target.data.y})`;
  }

  function openTargetEditor(binding: ShortcutBinding) {
    if (binding.method.type !== "instantCapture") return;
    setTargetDraft("target", cloneTarget(binding.method.data));
    setEditingTargetId(binding.id);
  }

  function saveTarget() {
    const id = editingTargetId();
    const binding = id ? shortcuts.find(s => s.id === id) : undefined;
    setEditingTargetId(null);
    if (!binding) return;
    run(() =>
      addShortcut({
        id: binding.id,
        keys: binding.keys,
        method: { type: "instantCapture", data: cloneTarget(targetDraft.target) },
      })
    );
  }

  function switchToMonitor() {
    if (targetDraft.target.type === "monitor") return;
    setTargetDraft("target", { type: "monitor", data: { id: monitors()[0]?.id ?? "" } });
  }

  function switchToRegion() {
    if (targetDraft.target.type === "region") return;
    setTargetDraft("target", { type: "region", data: { x: 0, y: 0, width: 100, height: 100 } });
  }

  function setRegionField(field: keyof RegionData, value: number) {
    const target = targetDraft.target;
    if (target.type !== "region") return;
    setTargetDraft("target", {
      type: "region",
      data: { ...target.data, [field]: Number.isFinite(value) ? value : 0 },
    });
  }

  async function selectRegion() {
    try {
      const unlisten = await listen<RegionData | null>("region-pick://result", event => {
        unlisten();
        if (event.payload) setTargetDraft("target", { type: "region", data: event.payload });
      });
      await safeInvoke("start_region_pick");
    } catch (err) {
      pushToast(`Could not start region selection: ${typeof err === "string" ? err : JSON.stringify(err)}`, "error", 6000);
    }
  }

  const region = createMemo<RegionData>(() =>
    targetDraft.target.type === "region" ? targetDraft.target.data : { x: 0, y: 0, width: 0, height: 0 }
  );

  return <div class={styles.ShortcutsContainer}>
    <div class={styles.Section}>
      <div class={styles.SectionTitle}>Screenshot</div>
      <div class={styles.ShortcutItem}>
        <span>Take screenshot</span>
        <div class={styles.KeyContainer} onClick={() => setPicker({ kind: "screenshot" })}>
          <KeyRenderer keys={screenshotKeys() ?? { keys: [] }} size={20} placeholder="No key assigned" />
        </div>
        <Show when={hasScreenshot()}>
          <Button isIcon tooltip="Clear shortcut" onClick={() => screenshotBinding() && run(() => removeShortcut(screenshotBinding()!.id))}>
            <X size={18} />
          </Button>
        </Show>
      </div>
    </div>

    <div class={styles.Section}>
      <div class={styles.SectionTitle}>Screen recording</div>
      <div class={styles.ShortcutItem}>
        <span>Start / stop recording</span>
        <div class={styles.KeyContainer} onClick={() => setPicker({ kind: "record" })}>
          <KeyRenderer keys={recordKeys() ?? { keys: [] }} size={20} placeholder="No key assigned" />
        </div>
        <Show when={hasRecord()}>
          <Button isIcon tooltip="Clear shortcut" onClick={() => recordBinding() && run(() => removeShortcut(recordBinding()!.id))}>
            <X size={18} />
          </Button>
        </Show>
      </div>
      <div class={styles.SectionDescription}>
        Opens the region selector when idle; stops and saves when a recording is running.
      </div>
    </div>

    <div class={styles.Section}>
      <div class={styles.SectionHeader}>
        <div class={styles.SectionTitle}>Instant captures</div>
        <Button onClick={() => setPicker({ kind: "newInstant" })}>
          <span class={styles.ButtonWithIcon}><Plus size={16} /> Add instant capture</span>
        </Button>
      </div>
      <div class={styles.SectionDescription}>
        Capture a whole monitor or a fixed region instantly , no editor window opens.
      </div>

      <For each={instantBindings()} fallback={<div class={styles.Empty}>No instant capture shortcuts yet.</div>}>
        {binding => {
          const summary = createMemo(() =>
            binding.method.type === "instantCapture" ? targetSummary(binding.method.data) : ""
          );
          return <div class={styles.ShortcutItem}>
            <div class={styles.KeyContainer} onClick={() => setPicker({ kind: "rebind", id: binding.id })}>
              <KeyRenderer keys={binding.keys} size={20} placeholder="No key assigned" />
            </div>
            <div class={styles.TargetSummary} onClick={() => openTargetEditor(binding)}>
              {summary()}
            </div>
            <Button onClick={() => openTargetEditor(binding)}>Edit target</Button>
            <Button isIcon tooltip="Delete shortcut" onClick={() => run(() => removeShortcut(binding.id))}>
              <X size={18} />
            </Button>
          </div>
        }}
      </For>
    </div>

    <ShortcutPicker
      preRegisteredShortcuts={shortcuts.filter(s => s.id !== pickerExcludeId()).map(s => s.keys)}
      show={picker() !== null}
      onHide={() => setPicker(null)}
      onConfirm={onPickerConfirm}
    />

    <Modal title="Capture target" show={editingTargetId() !== null} onHide={() => setEditingTargetId(null)}>
      <div class={styles.TargetEditor}>
        <div class={styles.TargetTypeToggle}>
          <Button
            color={targetDraft.target.type === "monitor" ? undefined : "var(--secondary-bg-color)"}
            onClick={switchToMonitor}
          >
            <span class={styles.ButtonWithIcon}><Monitor size={16} /> Monitor</span>
          </Button>
          <Button
            color={targetDraft.target.type === "region" ? undefined : "var(--secondary-bg-color)"}
            onClick={switchToRegion}
          >
            <span class={styles.ButtonWithIcon}><Crop size={16} /> Region</span>
          </Button>
        </div>

        <Show when={targetDraft.target.type === "monitor"}>
          <Select
            items={monitorItems()}
            value={targetDraft.target.type === "monitor" ? targetDraft.target.data.id : ""}
            placeholder={monitorItems().length ? "Select a monitor" : "No monitors found"}
            onItemClick={item => setTargetDraft("target", { type: "monitor", data: { id: String(item.id) } })}
          />
        </Show>

        <Show when={targetDraft.target.type === "region"}>
          <div class={styles.RegionFields}>
            <label>X<Input type="number" value={region().x} onChange={e => setRegionField("x", +e.currentTarget.value)} /></label>
            <label>Y<Input type="number" value={region().y} onChange={e => setRegionField("y", +e.currentTarget.value)} /></label>
            <label>Width<Input type="number" min={1} value={region().width} onChange={e => setRegionField("width", +e.currentTarget.value)} /></label>
            <label>Height<Input type="number" min={1} value={region().height} onChange={e => setRegionField("height", +e.currentTarget.value)} /></label>
          </div>
          <Button onClick={selectRegion}>
            <span class={styles.ButtonWithIcon}><Crop size={16} /> Select region on screen</span>
          </Button>
        </Show>

        <div class={styles.TargetEditorControls}>
          <Button color="var(--secondary-bg-color)" onClick={() => setEditingTargetId(null)}>Cancel</Button>
          <Button
            onClick={saveTarget}
            disabled={targetDraft.target.type === "monitor" && !targetDraft.target.data.id}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  </div>
}

export default ShortcutSettings;
