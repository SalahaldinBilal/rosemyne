import styles from "./CapturePreviewSettings.module.scss";
import settingsStyles from "../GeneralSettings/GeneralSettings.module.scss";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import Input from "@core/components/Input/Input";
import Select from "@core/components/Select/Select";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { CapturePreviewSettings as CapturePreviewSettingsData, MonitorInfo, PreviewClickAction, PreviewCorner, SelectItem } from "@core/types";
import useToastState from "@core/states/toastState";
import DurationField from "@core/pages/Main/TagFilter/controls/DurationField";

const PRIMARY_MONITOR_ID = "";

const CORNER_ITEMS: SelectItem<PreviewCorner>[] = [
  { id: "topLeft", value: "topLeft", label: "Top left" },
  { id: "topRight", value: "topRight", label: "Top right" },
  { id: "bottomLeft", value: "bottomLeft", label: "Bottom left" },
  { id: "bottomRight", value: "bottomRight", label: "Bottom right" },
];

const CLICK_ACTION_ITEMS: SelectItem<PreviewClickAction>[] = [
  { id: "nothing", value: "nothing", label: "Do nothing" },
  { id: "close", value: "close", label: "Close preview" },
  { id: "openFile", value: "openFile", label: "Open file" },
  { id: "openFolder", value: "openFolder", label: "Open containing folder" },
  { id: "copyFile", value: "copyFile", label: "Copy file" },
  { id: "copyLink", value: "copyLink", label: "Copy link" },
];

function CapturePreviewSettings() {
  const [settings, setSettings] = createStore<CapturePreviewSettingsData>({
    enabled: true,
    monitorId: null,
    corner: "bottomRight",
    marginX: 25,
    marginY: 25,
    maxWidth: 320,
    maxHeight: 240,
    autoDismissMs: 5000,
    leftClickAction: "close",
    rightClickAction: "nothing",
  });
  const [monitors, setMonitors] = createSignal<MonitorInfo[]>([]);
  const { pushToast } = useToastState;

  onMount(async () => {
    setSettings(reconcile(await safeInvoke("get_capture_preview_settings")));

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
    } catch (error) {
      setSettings(reconcile(previous));
      pushToast(typeof error === "string" ? error : JSON.stringify(error), "error", 6000);
    }
  }

  const monitorItems = createMemo(() => [
    { id: PRIMARY_MONITOR_ID, value: null as string | null, label: "Primary monitor" },
    ...monitors().map(m => ({ id: m.id, value: m.id as string | null, label: `${m.name} , ${m.width}×${m.height}` })),
  ]);

  return <div class={settingsStyles.GeneralSettings}>
    <label class={settingsStyles.SettingRow}>
      <input
        type="checkbox"
        checked={settings.enabled}
        onChange={e => apply({ enabled: e.currentTarget.checked })}
      />
      <div class={settingsStyles.SettingText}>
        <span>Show a capture preview</span>
        <span class={settingsStyles.Hint}>A small popup showing the screenshot/recording after it's saved (or uploaded, if auto-upload is on).</span>
      </div>
    </label>

    <Show when={settings.enabled}>
      <div class={settingsStyles.SettingRow}>
        <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
          <span>Monitor</span>
          <span class={settingsStyles.Hint}>Which screen the preview appears on.</span>
          <Select
            value={settings.monitorId ?? PRIMARY_MONITOR_ID}
            items={monitorItems()}
            onItemClick={item => apply({ monitorId: item.value })}
          />
        </div>
      </div>

      <div class={settingsStyles.SettingRow}>
        <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
          <span>Corner</span>
          <span class={settingsStyles.Hint}>Which corner of the monitor it's anchored to.</span>
          <Select value={settings.corner} items={CORNER_ITEMS} onItemClick={item => apply({ corner: item.value })} />
        </div>
      </div>

      <div class={settingsStyles.SettingRow}>
        <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
          <span>Margin from the edge</span>
          <span class={settingsStyles.Hint}>Distance (px) from the chosen corner.</span>
          <div class={styles.MarginRow}>
            <Input
              type="number" min={0} value={settings.marginX}
              onChange={e => apply({ marginX: Math.max(0, e.currentTarget.valueAsNumber || 0) })}
              style={{ width: '90px' }}
            />
            <span class={styles.MarginSep}>×</span>
            <Input
              type="number" min={0} value={settings.marginY}
              onChange={e => apply({ marginY: Math.max(0, e.currentTarget.valueAsNumber || 0) })}
              style={{ width: '90px' }}
            />
          </div>
        </div>
      </div>

      <div class={settingsStyles.SettingRow}>
        <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
          <span>Maximum size</span>
          <span class={settingsStyles.Hint}>The preview never exceeds this (px); it shrinks to fit, keeping its aspect ratio.</span>
          <div class={styles.MarginRow}>
            <Input
              type="number" min={1} value={settings.maxWidth}
              onChange={e => apply({ maxWidth: Math.max(1, e.currentTarget.valueAsNumber || 1) })}
              style={{ width: '90px' }}
            />
            <span class={styles.MarginSep}>×</span>
            <Input
              type="number" min={1} value={settings.maxHeight}
              onChange={e => apply({ maxHeight: Math.max(1, e.currentTarget.valueAsNumber || 1) })}
              style={{ width: '90px' }}
            />
          </div>
        </div>
      </div>

      <div class={settingsStyles.SettingRow}>
        <input
          type="checkbox"
          checked={settings.autoDismissMs > 0}
          onChange={e => apply({ autoDismissMs: e.currentTarget.checked ? 5000 : 0 })}
        />
        <div class={settingsStyles.SettingText}>
          <span>Auto-dismiss</span>
          <span class={settingsStyles.Hint}>Closes the preview on its own after a delay, instead of leaving it until clicked.</span>
          <Show when={settings.autoDismissMs > 0}>
            <div class={styles.MarginRow}>
              <DurationField valueMs={settings.autoDismissMs} onChange={ms => apply({ autoDismissMs: ms })} />
            </div>
          </Show>
        </div>
      </div>

      <div class={settingsStyles.SettingRow}>
        <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
          <span>Left click</span>
          <Select value={settings.leftClickAction} items={CLICK_ACTION_ITEMS} onItemClick={item => apply({ leftClickAction: item.value })} />
        </div>
      </div>

      <div class={settingsStyles.SettingRow}>
        <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
          <span>Right click</span>
          <Select value={settings.rightClickAction} items={CLICK_ACTION_ITEMS} onItemClick={item => apply({ rightClickAction: item.value })} />
        </div>
      </div>
    </Show>
  </div>;
}

export default CapturePreviewSettings;
