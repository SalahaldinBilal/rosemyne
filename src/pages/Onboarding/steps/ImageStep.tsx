import settingsStyles from "../../Settings/GeneralSettings/GeneralSettings.module.scss";
import { createMemo } from "solid-js";
import Select from "@core/components/Select/Select";
import { GeneralSettings as GeneralSettingsData, ScreenshotImageFormat, SelectItem } from "@core/types";
import { SCREENSHOT_FORMAT_LABELS, SCREENSHOT_FORMATS } from "@core/helpers/settingsLabels";

function ImageStep(props: { general: GeneralSettingsData, onChange: (update: Partial<GeneralSettingsData>) => void }) {
  const formatItems = createMemo<SelectItem<ScreenshotImageFormat>[]>(() =>
    SCREENSHOT_FORMATS.map(format => ({ id: format, value: format, label: SCREENSHOT_FORMAT_LABELS[format] }))
  );

  return <div class={settingsStyles.GeneralSettings}>
    <div class={settingsStyles.SettingRow}>
      <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
        <span>Screenshot format</span>
        <span class={settingsStyles.Hint}>File format saved screenshots are encoded as. Default: WebP.</span>
        <Select value={props.general.screenshotFormat} items={formatItems()} onItemClick={item => props.onChange({ screenshotFormat: item.value })} />
      </div>
    </div>
    <label class={settingsStyles.SettingRow}>
      <input
        type="checkbox"
        checked={props.general.copyToClipboardOnCapture}
        onChange={e => props.onChange({ copyToClipboardOnCapture: e.currentTarget.checked })}
      />
      <div class={settingsStyles.SettingText}>
        <span>Copy screenshots to the clipboard</span>
        <span class={settingsStyles.Hint}>Every saved screenshot is also placed on the clipboard.</span>
      </div>
    </label>
  </div>
}

export default ImageStep;
