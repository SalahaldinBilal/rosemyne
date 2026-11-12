import styles from "./BrowserExtensionSettings.module.scss";
import { Show, createMemo, createSignal, onMount } from "solid-js";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import { BrowserExtensionStatus, ExtensionStore } from "@core/types";
import useToastState from "@core/states/toastState";
import useSettingsSavedState from "@core/states/settingsSavedState";
import Button from "@core/components/Button/Button";
import { InlineControls, SettingRow, ToggleRow } from "../SettingsLayout/SettingsLayout";

function BrowserExtensionSettings() {
  const [status, setStatus] = createSignal<BrowserExtensionStatus | null>(null);
  const [busy, setBusy] = createSignal(false);
  const { pushToast } = useToastState;
  const { markSettingsSaved } = useSettingsSavedState;

  onMount(() => {
    safeInvoke("get_browser_extension_status")
      .then(setStatus)
      .catch(error => console.error("Failed to read the browser extension status", error));
  });

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      setStatus(await safeInvoke("set_browser_extension", { enabled }));
      markSettingsSaved();
    } catch (error) {
      pushToast(errorMessage(error), "error", 6000);
    } finally {
      setBusy(false);
    }
  }

  function openStore(store: ExtensionStore) {
    safeInvoke("open_extension_store", { store }).catch(error => pushToast(errorMessage(error), "error", 6000));
  }

  const statusText = createMemo(() => {
    const current = status();
    if (!current) return "";
    return current.error ?? `Listening on port ${current.port}`;
  });

  const hasStatus = createMemo(() => {
    const current = status();
    return !!current?.enabled && (current.port !== null || current.error !== null);
  });

  const failed = createMemo(() => !!status()?.error);

  return <Show when={status()}>
    {current => <>
      <ToggleRow
        label="Browser extension support"
        hint="Lets the Rosemyne browser extension send images and videos to the app."
        checked={current().enabled}
        disabled={busy()}
        onChange={toggle}
      />
      <SettingRow label="Get the extension" hint="Chrome, Edge and other Chromium browsers use the Chrome Web Store.">
        <InlineControls>
          <Button size="sm" onClick={() => openStore("chrome")}>Chrome Web Store</Button>
          <Button size="sm" onClick={() => openStore("firefox")}>Firefox Add-ons</Button>
        </InlineControls>
      </SettingRow>
      <Show when={hasStatus()}>
        <SettingRow label="Status">
          <div class={styles.Status}>
            <span class={styles.Dot} classList={{ [styles.Failed]: failed() }} />
            {statusText()}
          </div>
        </SettingRow>
      </Show>
    </>}
  </Show>
}

export default BrowserExtensionSettings;
