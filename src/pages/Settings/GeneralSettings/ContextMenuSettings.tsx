import styles from "./GeneralSettings.module.scss";
import { Show, createMemo, createSignal, onMount } from "solid-js";
import Button from "@core/components/Button/Button";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { ContextMenuStatus, Windows11MenuStatus } from "@core/types";
import useToastState from "@core/states/toastState";

type ToggleCommand = "set_context_menu" | "set_windows11_context_menu";

function ContextMenuSettings() {
  const [status, setStatus] = createSignal<ContextMenuStatus | null>(null);
  const [busy, setBusy] = createSignal(false);
  const { pushToast } = useToastState;

  onMount(() => {
    safeInvoke("get_context_menu_status")
      .then(setStatus)
      .catch(error => console.error("Failed to read the context menu status", error));
  });

  async function run(action: () => Promise<ContextMenuStatus>, successMessage: string) {
    const previous = status();
    if (!previous) return;

    setBusy(true);
    try {
      setStatus(await action());
      pushToast(successMessage, "success", 3000);
    } catch (error) {
      pushToast(typeof error === "string" ? error : JSON.stringify(error), "error", 6000);
      setStatus(await safeInvoke("get_context_menu_status").catch(() => previous));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(input: HTMLInputElement, command: ToggleCommand, isEnabled: (status: ContextMenuStatus) => boolean) {
    await run(() => safeInvoke(command, { enabled: input.checked }), "Context menu updated");
    const current = status();
    input.checked = current ? isEnabled(current) : false;
  }

  return <Show when={status()}>
    {current => <>
      <label class={styles.SettingRow}>
        <input
          type="checkbox"
          checked={current().enabled}
          disabled={busy() || !current().supported}
          onChange={e => toggle(e.currentTarget, "set_context_menu", s => s.enabled)}
        />
        <div class={styles.SettingText}>
          <span>Add Upload to the right-click menu</span>
          <span class={styles.Hint}>Right-clicking a file in your file manager imports it just like dropping it onto this window.</span>
          <Show when={current().note}>
            {note => <span class={styles.Hint}>{note()}</span>}
          </Show>
          <Show when={!current().supported}>
            <span class={styles.Hint}>Not available on this platform yet.</span>
          </Show>
        </div>
      </label>
      <Show when={current().windows11}>
        {windows11 => <Windows11Menu
          status={windows11()}
          busy={busy()}
          onToggle={input => toggle(input, "set_windows11_context_menu", s => s.windows11?.enabled ?? false)}
          onUpdate={() => run(() => safeInvoke("update_cmrs"), "windows11-context-rs updated")}
        />}
      </Show>
      <Show when={busy()}>
        <span class={styles.Hint}>Applying…</span>
      </Show>
    </>}
  </Show>
}

type Windows11MenuProps = {
  status: Windows11MenuStatus,
  busy: boolean,
  onToggle: (input: HTMLInputElement) => void,
  onUpdate: () => void,
}

function Windows11Menu(props: Windows11MenuProps) {
  const canToggle = createMemo(() => {
    const { enabled, developerMode, cmrs } = props.status;
    return !props.busy && (enabled || (developerMode && (!cmrs.installed || cmrs.compatible)));
  });

  const updateAvailable = createMemo(() =>
    props.status.cmrs.installed && props.status.cmrs.installedVersion !== props.status.cmrs.latestVersion
  );

  const developerModeText = createMemo(() =>
    props.status.developerMode ? "On" : "Off, turn it on in Windows Settings → System → For developers"
  );

  const cmrsText = createMemo(() => {
    const { installed, installedVersion, compatible, latestVersion } = props.status.cmrs;
    if (!installed) return `Not installed, ${latestVersion} is downloaded when the Windows 11 menu is turned on`;
    if (!installedVersion) return "Unrecognized version installed, update it to use the Windows 11 menu";
    if (!compatible) return `${installedVersion} installed, too old for the Windows 11 menu, update it first`;
    return `${installedVersion} installed`;
  });

  return <>
    <label class={styles.SettingRow}>
      <input
        type="checkbox"
        checked={props.status.enabled}
        disabled={!canToggle()}
        onChange={e => props.onToggle(e.currentTarget)}
      />
      <div class={styles.SettingText}>
        <span>Windows 11 menu</span>
        <span class={styles.Hint}>
          Adds it to Explorer's main right-click menu. Needs Developer Mode and uses windows11-context-rs,
          downloaded (about 2 MB) the first time this is turned on.
        </span>
      </div>
    </label>
    <div class={styles.StatusList}>
      <span class={styles.StatusLabel}>Developer Mode</span>
      <span>{developerModeText()}</span>
      <span class={styles.StatusLabel}>windows11-context-rs</span>
      <div class={styles.StatusValue}>
        <span>{cmrsText()}</span>
        <Show when={updateAvailable()}>
          <Button disabled={props.busy} onClick={() => props.onUpdate()}>
            Update to {props.status.cmrs.latestVersion}
          </Button>
        </Show>
      </div>
    </div>
  </>
}

export default ContextMenuSettings;
