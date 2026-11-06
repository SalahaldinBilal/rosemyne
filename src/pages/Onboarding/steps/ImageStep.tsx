import { createMemo } from "solid-js";
import Select from "@core/components/Select/Select";
import { GeneralSettings as GeneralSettingsData, ScreenshotImageFormat, SelectItem } from "@core/types";
import { SCREENSHOT_FORMAT_LABELS, SCREENSHOT_FORMATS } from "@core/helpers/settingsLabels";
import { SettingRow, SettingsGroup, ToggleRow } from "../../Settings/SettingsLayout/SettingsLayout";

function ImageStep(props: { general: GeneralSettingsData, onChange: (update: Partial<GeneralSettingsData>) => void }) {
  const formatItems = createMemo<SelectItem<ScreenshotImageFormat>[]>(() =>
    SCREENSHOT_FORMATS.map(format => ({ id: format, value: format, label: SCREENSHOT_FORMAT_LABELS[format] }))
  );

  return <SettingsGroup>
    <SettingRow label="Format" hint="Default WebP.">
      <Select value={props.general.screenshotFormat} items={formatItems()} onItemClick={item => props.onChange({ screenshotFormat: item.value })} />
    </SettingRow>
    <ToggleRow
      label="Include the mouse cursor"
      hint="Adds the cursor as an overlay you can move or delete before saving."
      checked={props.general.includeCursor}
      onChange={includeCursor => props.onChange({ includeCursor })}
    />
  </SettingsGroup>;
}

export default ImageStep;
