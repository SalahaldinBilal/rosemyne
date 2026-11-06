import ContextMenuSettings from "../../Settings/GeneralSettings/ContextMenuSettings";
import { SettingsGroup } from "../../Settings/SettingsLayout/SettingsLayout";

function ContextMenuStep() {
  return <SettingsGroup>
    <ContextMenuSettings />
  </SettingsGroup>;
}

export default ContextMenuStep;
