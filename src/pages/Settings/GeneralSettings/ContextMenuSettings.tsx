import styles from "./ContextMenuSettings.module.scss";
import { Show, createMemo, createSignal, onMount } from "solid-js";
import Button from "@core/components/Button/Button";
import Badge from "@core/components/Badge/Badge";
import { Spinner } from "@core/components/Progress/Progress";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import { ContextMenuStatus, Windows11MenuStatus } from "@core/types";
import useToastState from "@core/states/toastState";
import useSettingsSavedState from "@core/states/settingsSavedState";
import { SettingRow, ToggleRow } from "../SettingsLayout/SettingsLayout";
import { Check } from "lucide-solid";

type ToggleCommand = "set_context_menu" | "set_windows11_context_menu";

// Also used by the onboarding step, so it renders rows that sit inside a settings card.
function ContextMenuSettings() {
  const [status, setStatus] = createSignal<ContextMenuStatus | null>(null);
  const [busy, setBusy] = createSignal(false);
  const { pushToast } = useToastState;
  const { markSettingsSaved } = useSettingsSavedState;

  onMount(() => {
    safeInvoke("get_context_menu_status")
      .then(setStatus)
      .catch(error => console.error("Failed to read the context menu status", error));
  });

  async function run(action: () => Promise<ContextMenuStatus>) {
    const previous = status();
    if (!previous) return;

    setBusy(true);
    try {
      setStatus(await action());
      markSettingsSaved();
    } catch (error) {
      pushToast(errorMessage(error), "error", 6000);
      setStatus(await safeInvoke("get_context_menu_status").catch(() => previous));
    } finally {
      setBusy(false);
    }
  }

  function toggle(command: ToggleCommand, enabled: boolean) {
    run(() => safeInvoke(command, { enabled }));
  }

  const mainHint = createMemo(() => {
    const current = status();
    if (!current) return "";
    if (!current.supported) return "Not available on this platform yet.";
    return current.note ?? "Adds Upload image, Upload video and Upload file to your file manager.";
  });

  return <Show when={status()}>
    {current => <>
      <ToggleRow
        label="Upload from the right-click menu"
        hint={mainHint()}
        checked={current().enabled}
        disabled={busy() || !current().supported}
        onChange={enabled => toggle("set_context_menu", enabled)}
      />
      <Show when={current().windows11}>
        {windows11 => <Windows11Menu
          status={windows11()}
          busy={busy()}
          onToggle={enabled => toggle("set_windows11_context_menu", enabled)}
          onUpdate={() => run(() => safeInvoke("update_cmrs"))}
        />}
      </Show>
    </>}
  </Show>
}

function Windows11Menu(props: {
  status: Windows11MenuStatus,
  busy: boolean,
  onToggle: (enabled: boolean) => void,
  onUpdate: () => void,
}) {
  const canToggle = createMemo(() => {
    const { enabled, developerMode, cmrs } = props.status;
    return !props.busy && (enabled || (developerMode && (!cmrs.installed || cmrs.compatible)));
  });

  const updateAvailable = createMemo(() =>
    props.status.cmrs.installed && props.status.cmrs.installedVersion !== props.status.cmrs.latestVersion
  );

  const cmrsText = createMemo(() => {
    const { installed, installedVersion, compatible, latestVersion } = props.status.cmrs;
    if (!installed) return `Not installed. ${latestVersion} is downloaded (about 2 MB) when you turn this on.`;
    if (!installedVersion) return "Unrecognized version installed. Update it to use the Windows 11 menu.";
    if (!compatible) return `${installedVersion} installed, too old for the Windows 11 menu. Update it first.`;
    return `${installedVersion} installed`;
  });

  return <>
    <ToggleRow
      label="Show in the Windows 11 menu"
      hint="Adds it to Explorer's main right-click menu. Needs Developer Mode and uses windows11-context-rs."
      checked={props.status.enabled}
      disabled={!canToggle()}
      onChange={props.onToggle}
    />
    <SettingRow stack label="Windows 11 menu status">
      <div class={styles.StatusList}>
        <span class={styles.Key}>Developer Mode</span>
        <span>
          <Show
            when={props.status.developerMode}
            fallback={<><Badge tone="warn">Off</Badge> <span class={styles.Faint}>Turn it on in Windows Settings › System › For developers</span></>}
          >
            <Badge tone="ok"><Check size={11} />On</Badge>
          </Show>
        </span>
        <span class={styles.Key}>windows11-context-rs</span>
        <span class={styles.Value}>
          {cmrsText()}
          <Show when={props.busy}><Spinner size="sm" /></Show>
          <Show when={updateAvailable()}>
            <Button size="sm" disabled={props.busy} onClick={() => props.onUpdate()}>
              Update to {props.status.cmrs.latestVersion}
            </Button>
          </Show>
        </span>
      </div>
    </SettingRow>
  </>
}

export default ContextMenuSettings;
