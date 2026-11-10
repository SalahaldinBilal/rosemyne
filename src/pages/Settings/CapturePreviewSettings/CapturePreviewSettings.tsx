import styles from "./CapturePreviewSettings.module.scss";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import Select from "@core/components/Select/Select";
import Checkbox from "@core/components/Checkbox/Checkbox";
import DimensionField from "@core/components/NumberField/DimensionField";
import DurationField from "@core/components/DurationField/DurationField";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import { findMonitor } from "@core/helpers/monitors";
import { CapturePreviewSettings as CapturePreviewSettingsData, MonitorInfo, PreviewClickAction, PreviewCorner, SelectItem } from "@core/types";
import useToastState from "@core/states/toastState";
import useSettingsSavedState from "@core/states/settingsSavedState";
import { InlineControls, SettingRow, SettingsGroup, SettingsPage, ToggleRow } from "../SettingsLayout/SettingsLayout";

const PRIMARY_MONITOR_ID = "";
const DEFAULT_DISMISS_MS = 5000;

const CORNERS: { corner: PreviewCorner, label: string }[] = [
  { corner: "topLeft", label: "Top left" },
  { corner: "topRight", label: "Top right" },
  { corner: "bottomLeft", label: "Bottom left" },
  { corner: "bottomRight", label: "Bottom right" },
];

const CLICK_ACTION_ITEMS: SelectItem<PreviewClickAction>[] = [
  { id: "nothing", value: "nothing", label: "Do nothing" },
  { id: "close", value: "close", label: "Close preview" },
  { id: "openFile", value: "openFile", label: "Open file" },
  { id: "openFolder", value: "openFolder", label: "Open containing folder" },
  { id: "copyFile", value: "copyFile", label: "Copy file" },
  { id: "copyLink", value: "copyLink", label: "Copy link" },
];

function CornerPicker(props: { value: PreviewCorner, onChange: (corner: PreviewCorner) => void }) {
  return (
    <div class={styles.Monitor} role="radiogroup" aria-label="Corner">
      <For each={CORNERS}>
        {entry => (
          <button
            type="button"
            role="radio"
            aria-checked={props.value === entry.corner}
            aria-label={entry.label}
            title={entry.label}
            class={styles[entry.corner]}
            classList={{ [styles.On]: props.value === entry.corner }}
            onClick={() => props.onChange(entry.corner)}
          />
        )}
      </For>
    </div>
  );
}

function CapturePreviewSettings() {
  const [settings, setSettings] = createStore<CapturePreviewSettingsData>({
    enabled: true,
    monitorId: null,
    corner: "bottomRight",
    marginX: 25,
    marginY: 25,
    maxWidth: 320,
    maxHeight: 240,
    autoDismissMs: DEFAULT_DISMISS_MS,
    showCountdown: true,
    leftClickAction: "close",
    rightClickAction: "nothing",
  });
  const [monitors, setMonitors] = createSignal<MonitorInfo[]>([]);
  const [lastDismissMs, setLastDismissMs] = createSignal(DEFAULT_DISMISS_MS);
  const { pushToast } = useToastState;
  const { markSettingsSaved } = useSettingsSavedState;

  onMount(async () => {
    const saved = await safeInvoke("get_capture_preview_settings");
    setSettings(reconcile(saved));
    if (saved.autoDismissMs > 0) setLastDismissMs(saved.autoDismissMs);

    try {
      setMonitors(await safeInvoke("list_monitors"));
    } catch {
      // Monitor listing is best-effort; the primary-monitor default still works.
    }
  });

  async function apply(update: Partial<CapturePreviewSettingsData>) {
    const previous = structuredClone(unwrap(settings));
    setSettings(update);

    try {
      await safeInvoke("set_capture_preview_settings", { capturePreview: structuredClone(unwrap(settings)) });
      markSettingsSaved();
    } catch (error) {
      setSettings(reconcile(previous));
      pushToast(errorMessage(error), "error", 6000);
    }
  }

  const selectedMonitorId = createMemo(() => {
    const id = settings.monitorId;
    if (id === null) return PRIMARY_MONITOR_ID;
    return findMonitor(monitors(), id)?.id ?? id;
  });

  const monitorItems = createMemo(() => [
    { id: PRIMARY_MONITOR_ID, value: null as string | null, label: "Primary monitor" },
    ...monitors().map(m => ({ id: m.id, value: m.id as string | null, label: `${m.name}, ${m.width}×${m.height}` })),
  ]);

  const never = createMemo(() => settings.autoDismissMs === 0);

  function setDismiss(ms: number) {
    if (ms > 0) setLastDismissMs(ms);
    apply({ autoDismissMs: ms });
  }

  return <SettingsPage title="Capture preview" description="A small popup with the capture after it's saved, or after the upload if auto upload is on.">
    <SettingsGroup title="Popup">
      <ToggleRow label="Show a capture preview" checked={settings.enabled} onChange={enabled => apply({ enabled })} />
    </SettingsGroup>

    <Show when={settings.enabled}>
      <SettingsGroup title="Position">
        <SettingRow label="Monitor">
          <Select class={styles.WideSelect} value={selectedMonitorId()} items={monitorItems()} onItemClick={item => apply({ monitorId: item.value })} />
        </SettingRow>
        <SettingRow label="Corner" hint="Click a corner of the screen.">
          <CornerPicker value={settings.corner} onChange={corner => apply({ corner })} />
        </SettingRow>
        <SettingRow label="Margin from the edge" hint="Horizontal and vertical.">
          <DimensionField
            value={{ width: settings.marginX, height: settings.marginY }}
            onChange={value => apply({ marginX: value.width, marginY: value.height })}
          />
        </SettingRow>
        <SettingRow label="Maximum size" hint="Shrinks to fit and keeps the aspect ratio.">
          <DimensionField
            min={1}
            value={{ width: settings.maxWidth, height: settings.maxHeight }}
            onChange={value => apply({ maxWidth: value.width, maxHeight: value.height })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Behavior">
        <SettingRow label="Close after">
          <InlineControls>
            <DurationField
              parts={["m", "s"]}
              disabled={never()}
              valueMs={never() ? lastDismissMs() : settings.autoDismissMs}
              onChange={ms => setDismiss(Math.max(1000, ms))}
            />
            <Checkbox checked={never()} onChange={checked => setDismiss(checked ? 0 : lastDismissMs())}>Never</Checkbox>
          </InlineControls>
        </SettingRow>
        <ToggleRow
          label="Show the countdown"
          hint="A thin line along the bottom shrinks until it closes."
          checked={settings.showCountdown}
          disabled={never()}
          onChange={showCountdown => apply({ showCountdown })}
        />
        <SettingRow label="Left click">
          <Select class={styles.WideSelect} value={settings.leftClickAction} items={CLICK_ACTION_ITEMS} onItemClick={item => apply({ leftClickAction: item.value })} />
        </SettingRow>
        <SettingRow label="Right click">
          <Select class={styles.WideSelect} value={settings.rightClickAction} items={CLICK_ACTION_ITEMS} onItemClick={item => apply({ rightClickAction: item.value })} />
        </SettingRow>
      </SettingsGroup>
    </Show>
  </SettingsPage>;
}

export default CapturePreviewSettings;
