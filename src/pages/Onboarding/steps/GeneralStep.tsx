import { GeneralSettings as GeneralSettingsData } from "@core/types";
import { SettingsGroup, ToggleRow } from "../../Settings/SettingsLayout/SettingsLayout";

function GeneralStep(props: { general: GeneralSettingsData, onChange: (update: Partial<GeneralSettingsData>) => void }) {
  return <SettingsGroup>
    <ToggleRow
      label="Start with Windows"
      hint="Launch in the tray when you log in."
      checked={props.general.autostart}
      onChange={autostart => props.onChange({ autostart })}
    />
    <ToggleRow
      label="Copy screenshots to the clipboard"
      hint="Every saved screenshot is also put on the clipboard."
      checked={props.general.copyToClipboardOnCapture}
      onChange={copyToClipboardOnCapture => props.onChange({ copyToClipboardOnCapture })}
    />
    <ToggleRow
      label="Check for updates on startup"
      hint="You get a notification when a new version is out."
      checked={props.general.checkForUpdatesOnStartup}
      onChange={checkForUpdatesOnStartup => props.onChange({ checkForUpdatesOnStartup })}
    />
  </SettingsGroup>;
}

export default GeneralStep;
