import settingsStyles from "../GeneralSettings/GeneralSettings.module.scss";
import { onMount } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import Input from "@core/components/Input/Input";
import ScrollDistanceInput from "@core/components/ScrollDistanceInput/ScrollDistanceInput";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { ScrollingCaptureSettings as ScrollingCaptureSettingsData } from "@core/types";
import useToastState from "@core/states/toastState";
import DurationField from "@core/pages/Main/TagFilter/controls/DurationField";

function ScrollingCaptureSettings() {
  const [settings, setSettings] = createStore<ScrollingCaptureSettingsData>({
    maxFrames: 9,
    frameDelayMs: 400,
    scrollDistance: { type: "percent", data: 80 },
  });
  const { pushToast } = useToastState;

  onMount(async () => {
    setSettings(reconcile(await safeInvoke("get_scrolling_capture_settings")));
  });

  async function apply(update: Partial<ScrollingCaptureSettingsData>) {
    const previous = structuredClone(unwrap(settings));
    setSettings(update);

    try {
      await safeInvoke("set_scrolling_capture_settings", { scrollingCapture: structuredClone(unwrap(settings)) });
    } catch (error) {
      setSettings(reconcile(previous));
      pushToast(typeof error === "string" ? error : JSON.stringify(error), "error", 6000);
    }
  }

  return <div class={settingsStyles.GeneralSettings}>
    <div class={settingsStyles.SettingRow}>
      <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
        <span>Delay between frames</span>
        <span class={settingsStyles.Hint}>How long to wait after each scroll for the content to redraw before capturing.</span>
        <DurationField valueMs={settings.frameDelayMs} onChange={ms => apply({ frameDelayMs: ms })} />
      </div>
    </div>

    <div class={settingsStyles.SettingRow}>
      <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
        <span>Scroll amount</span>
        <span class={settingsStyles.Hint}>
          How far one scroll step tries to move the target. A wheel notch has no defined pixel distance (that's up
          to the app being captured), so this is only ever approximate, percent scales with whatever region you
          select, which is why it's the default.
        </span>
        <ScrollDistanceInput value={settings.scrollDistance} onChange={value => apply({ scrollDistance: value })} />
      </div>
    </div>

    <div class={settingsStyles.SettingRow}>
      <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
        <span>Maximum frames</span>
        <span class={settingsStyles.Hint}>Safety cap, the capture normally stops on its own once scrolling stops changing the content.</span>
        <Input
          type="number" min={2} value={settings.maxFrames}
          onChange={e => apply({ maxFrames: Math.max(2, e.currentTarget.valueAsNumber || 2) })}
          style={{ width: '90px' }}
        />
      </div>
    </div>
  </div>;
}

export default ScrollingCaptureSettings;
