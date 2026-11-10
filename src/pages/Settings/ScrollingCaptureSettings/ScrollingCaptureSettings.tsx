import { onMount } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import NumberField from "@core/components/NumberField/NumberField";
import ScrollDistanceInput from "@core/components/ScrollDistanceInput/ScrollDistanceInput";
import DurationField from "@core/components/DurationField/DurationField";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import { ScrollingCaptureSettings as ScrollingCaptureSettingsData } from "@core/types";
import useToastState from "@core/states/toastState";
import useSettingsSavedState from "@core/states/settingsSavedState";
import { SettingRow, SettingsGroup, SettingsPage } from "../SettingsLayout/SettingsLayout";

function ScrollingCaptureSettings() {
  const [settings, setSettings] = createStore<ScrollingCaptureSettingsData>({
    maxFrames: 9,
    frameDelayMs: 400,
    scrollDistance: { type: "percent", data: 80 },
  });
  const { pushToast } = useToastState;
  const { markSettingsSaved } = useSettingsSavedState;

  onMount(async () => {
    setSettings(reconcile(await safeInvoke("get_scrolling_capture_settings")));
  });

  async function apply(update: Partial<ScrollingCaptureSettingsData>) {
    const previous = structuredClone(unwrap(settings));
    setSettings(update);

    try {
      await safeInvoke("set_scrolling_capture_settings", { scrollingCapture: structuredClone(unwrap(settings)) });
      markSettingsSaved();
    } catch (error) {
      setSettings(reconcile(previous));
      pushToast(errorMessage(error), "error", 6000);
    }
  }

  return <SettingsPage title="Scrolling capture" description="Defaults for scrolling captures. The selection panel can change them for one capture.">
    <SettingsGroup title="Capture">
      <SettingRow label="Delay between frames" hint="How long to wait after each scroll for the page to redraw.">
        <DurationField parts={["s", "ms"]} valueMs={settings.frameDelayMs} onChange={ms => apply({ frameDelayMs: Math.max(50, ms) })} />
      </SettingRow>
      <SettingRow
        label="Scroll amount"
        hint="How far one step tries to scroll. A wheel notch has no fixed pixel size, so this is approximate. Percent follows the selection's height."
      >
        <ScrollDistanceInput value={settings.scrollDistance} onChange={value => apply({ scrollDistance: value })} />
      </SettingRow>
      <SettingRow label="Maximum frames" hint="A safety cap. Capturing normally stops once scrolling stops changing the content.">
        <NumberField value={settings.maxFrames} min={2} max={1000} width={100} unit="frames" onChange={maxFrames => apply({ maxFrames })} />
      </SettingRow>
    </SettingsGroup>
  </SettingsPage>;
}

export default ScrollingCaptureSettings;
