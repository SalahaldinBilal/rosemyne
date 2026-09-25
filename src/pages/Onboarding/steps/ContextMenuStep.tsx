import settingsStyles from "../../Settings/GeneralSettings/GeneralSettings.module.scss";
import ContextMenuSettings from "../../Settings/GeneralSettings/ContextMenuSettings";

function ContextMenuStep() {
  return <div class={settingsStyles.GeneralSettings}>
    <div class={settingsStyles.Section}>
      <ContextMenuSettings />
    </div>
  </div>
}

export default ContextMenuStep;
