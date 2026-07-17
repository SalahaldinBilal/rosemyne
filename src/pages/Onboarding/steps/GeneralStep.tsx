import settingsStyles from "../../Settings/GeneralSettings/GeneralSettings.module.scss";
import { GeneralSettings as GeneralSettingsData } from "@core/types";

function GeneralStep(props: { general: GeneralSettingsData, onChange: (update: Partial<GeneralSettingsData>) => void }) {
  return <div class={settingsStyles.GeneralSettings}>
    <label class={settingsStyles.SettingRow}>
      <input
        type="checkbox"
        checked={props.general.autostart}
        onChange={e => props.onChange({ autostart: e.currentTarget.checked })}
      />
      <div class={settingsStyles.SettingText}>
        <span>Start with Windows</span>
        <span class={settingsStyles.Hint}>Launch Rosemyne automatically when you log in.</span>
      </div>
    </label>
  </div>
}

export default GeneralStep;
