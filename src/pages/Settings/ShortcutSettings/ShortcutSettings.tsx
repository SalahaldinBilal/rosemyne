import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { listen } from "@tauri-apps/api/event";
import styles from "./ShortcutSettings.module.scss";
import KeyRenderer from "@core/components/KeyRenderer/KeyRenderer";
import ShortcutPicker from "@core/components/ShortcutPicker/ShortcutPicker";
import Button from "@core/components/Button/Button";
import Select from "@core/components/Select/Select";
import NumberField from "@core/components/NumberField/NumberField";
import Segmented from "@core/components/Segmented/Segmented";
import Modal from "@core/components/Modal/Modal";
import { InlineControls, SettingRow, SettingsGroup, SettingsPage } from "../SettingsLayout/SettingsLayout";
import { CaptureTarget, MonitorInfo, ShortcutBinding, ShortcutKeys } from "@core/types";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { findMonitor } from "@core/helpers/monitors";
import useSettingsState from "@core/states/settingsState";
import useToastState from "@core/states/toastState";
import useSettingsSavedState from "@core/states/settingsSavedState";
import { Crop, Monitor, Plus, Trash2, X } from "lucide-solid";

const SCREENSHOT_ID = "screenshot";
const RECORD_ID = "record";
const SCROLLING_CAPTURE_ID = "scrollingCapture";

type PickerTarget =
  | { kind: "screenshot" }
  | { kind: "record" }
  | { kind: "scrollingCapture" }
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
  const { markSettingsSaved } = useSettingsSavedState;

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
  const scrollingCaptureBinding = createMemo(() => shortcuts.find(s => s.method.type === "scrollingCapture"));
  const scrollingCaptureKeys = createMemo(() => scrollingCaptureBinding()?.keys);
  const hasScrollingCapture = createMemo(() => (scrollingCaptureKeys()?.keys.length ?? 0) > 0);
  const instantBindings = createMemo(() => shortcuts.filter(s => s.method.type === "instantCapture"));
  const monitorItems = createMemo(() =>
    monitors().map(m => ({ id: m.id, value: m, label: `${m.name}, ${m.width}×${m.height}` }))
  );

  function run(action: () => Promise<any>) {
    return action()
      .then(markSettingsSaved)
      .catch(err => pushToast(`Could not update the shortcut: ${typeof err === "string" ? err : JSON.stringify(err)}`, "error", 6000));
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
    if (p.kind === "scrollingCapture") return scrollingCaptureBinding()?.id ?? SCROLLING_CAPTURE_ID;
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
    } else if (p.kind === "scrollingCapture") {
      run(() => addShortcut({ id: scrollingCaptureBinding()?.id ?? SCROLLING_CAPTURE_ID, keys, method: { type: "scrollingCapture" } }));
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

  function targetSummary(target: CaptureTarget): { title: string, detail: string } {
    if (target.type === "monitor") {
      const m = findMonitor(monitors(), target.data.id);
      return m
        ? { title: m.name, detail: `${m.width}×${m.height}, whole monitor` }
        : { title: target.data.id || "No monitor chosen", detail: "Monitor not connected" };
    }
    return { title: "Region", detail: `${target.data.width}×${target.data.height} at (${target.data.x}, ${target.data.y})` };
  }

  function openTargetEditor(binding: ShortcutBinding) {
    if (binding.method.type !== "instantCapture") return;
    const target = cloneTarget(binding.method.data);
    if (target.type === "monitor") {
      target.data.id = findMonitor(monitors(), target.data.id)?.id ?? target.data.id;
    }
    setTargetDraft("target", target);
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

  function KeyButton(props: { keys: ShortcutKeys | undefined, onClick: () => void }) {
    const hasKeys = createMemo(() => (props.keys?.keys.length ?? 0) > 0);
    return (
      <button type="button" class={styles.KeyButton} onClick={() => props.onClick()}>
        <Show when={hasKeys()} fallback={<span class={styles.Placeholder}>Click to set</span>}>
          <KeyRenderer keys={props.keys!} />
        </Show>
      </button>
    );
  }

  function FixedShortcut(props: { label: string, hint?: string, keys: ShortcutKeys | undefined, has: boolean, onPick: () => void, onClear: () => void }) {
    return (
      <SettingRow label={props.label} hint={props.hint}>
        <InlineControls>
          <KeyButton keys={props.keys} onClick={props.onPick} />
          <Button isIcon size="sm" tooltip="Clear" disabled={!props.has} onClick={props.onClear}>
            <X size={15} />
          </Button>
        </InlineControls>
      </SettingRow>
    );
  }

  return <SettingsPage title="Shortcuts" description="Global keys that work from any app.">
    <SettingsGroup title="Capture">
      <FixedShortcut
        label="Take screenshot"
        keys={screenshotKeys()}
        has={hasScreenshot()}
        onPick={() => setPicker({ kind: "screenshot" })}
        onClear={() => screenshotBinding() && run(() => removeShortcut(screenshotBinding()!.id))}
      />
      <FixedShortcut
        label="Start or stop recording"
        hint="Opens the region picker when idle, stops and saves while recording."
        keys={recordKeys()}
        has={hasRecord()}
        onPick={() => setPicker({ kind: "record" })}
        onClear={() => recordBinding() && run(() => removeShortcut(recordBinding()!.id))}
      />
      <FixedShortcut
        label="Scrolling capture"
        hint="Scrolls and captures the selection, then opens the result."
        keys={scrollingCaptureKeys()}
        has={hasScrollingCapture()}
        onPick={() => setPicker({ kind: "scrollingCapture" })}
        onClear={() => scrollingCaptureBinding() && run(() => removeShortcut(scrollingCaptureBinding()!.id))}
      />
    </SettingsGroup>

    <SettingsGroup
      title="Instant captures"
      right={<Button size="sm" onClick={() => setPicker({ kind: "newInstant" })}><Plus size={14} />Add instant capture</Button>}
    >
      <For each={instantBindings()} fallback={
        <SettingRow label="No instant captures yet" hint="Capture a whole monitor or a fixed region with one key, no editor opens." />
      }>
        {binding => {
          const summary = createMemo(() =>
            binding.method.type === "instantCapture" ? targetSummary(binding.method.data) : { title: "", detail: "" }
          );
          const isMonitor = createMemo(() => binding.method.type === "instantCapture" && binding.method.data.type === "monitor");
          return <div class={styles.ListRow}>
            <KeyButton keys={binding.keys} onClick={() => setPicker({ kind: "rebind", id: binding.id })} />
            <div class={styles.Info}>
              <b>{isMonitor() ? <Monitor size={14} /> : <Crop size={14} />} {summary().title}</b>
              <span>{summary().detail}</span>
            </div>
            <div class={styles.Actions}>
              <Button size="sm" variant="ghost" onClick={() => openTargetEditor(binding)}>Edit target</Button>
              <Button isIcon size="sm" variant="danger" tooltip="Delete" onClick={() => run(() => removeShortcut(binding.id))}>
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        }}
      </For>
    </SettingsGroup>

    <ShortcutPicker
      preRegisteredShortcuts={shortcuts.filter(s => s.id !== pickerExcludeId()).map(s => s.keys)}
      show={picker() !== null}
      onHide={() => setPicker(null)}
      onConfirm={onPickerConfirm}
    />

    <Modal
      title="Capture target"
      width={480}
      show={editingTargetId() !== null}
      onHide={() => setEditingTargetId(null)}
      footer={<>
        <Button onClick={() => setEditingTargetId(null)}>Cancel</Button>
        <Button
          variant="primary"
          onClick={saveTarget}
          disabled={targetDraft.target.type === "monitor" && !targetDraft.target.data.id}
        >
          Save
        </Button>
      </>}
    >
      <div class={styles.TargetEditor}>
        <Segmented
          items={[
            { id: "monitor", label: <><Monitor size={14} />Monitor</> },
            { id: "region", label: <><Crop size={14} />Region</> },
          ]}
          value={targetDraft.target.type}
          onChange={type => type === "monitor" ? switchToMonitor() : switchToRegion()}
        />

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
            <label>X<NumberField width="100%" min={-100_000} max={100_000} value={region().x} onChange={value => setRegionField("x", value)} /></label>
            <label>Y<NumberField width="100%" min={-100_000} max={100_000} value={region().y} onChange={value => setRegionField("y", value)} /></label>
            <label>Width<NumberField width="100%" min={1} max={100_000} value={region().width} onChange={value => setRegionField("width", value)} /></label>
            <label>Height<NumberField width="100%" min={1} max={100_000} value={region().height} onChange={value => setRegionField("height", value)} /></label>
          </div>
          <Button class={styles.SelectRegion} onClick={selectRegion}>
            <Crop size={15} />Select region on screen
          </Button>
        </Show>
      </div>
    </Modal>
  </SettingsPage>
}

export default ShortcutSettings;
