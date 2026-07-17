import styles from "./UpdateSettings.module.scss";
import settingsStyles from "../GeneralSettings/GeneralSettings.module.scss";
import { createSignal, Match, onMount, Show, Switch } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { checkForUpdate, Update } from "@core/helpers/updater";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { GeneralSettings as GeneralSettingsData } from "@core/types";
import Button from "@core/components/Button/Button";
import useToastState from "@core/states/toastState";
import { CircleCheck, Download, RefreshCw, TriangleAlert } from "lucide-solid";

type Phase = "idle" | "checking" | "upToDate" | "available" | "downloading" | "readyToRestart" | "error";

function UpdateSettings() {
  const { pushToast } = useToastState;
  const [currentVersion, setCurrentVersion] = createSignal("");
  const [phase, setPhase] = createSignal<Phase>("idle");
  const [update, setUpdate] = createSignal<Update | null>(null);
  const [progress, setProgress] = createSignal<{ downloaded: number, total: number | null }>({ downloaded: 0, total: null });
  const [errorMessage, setErrorMessage] = createSignal("");
  const [checkOnStartup, setCheckOnStartup] = createSignal(true);

  onMount(async () => {
    setCurrentVersion(await getVersion());

    try {
      const general = await safeInvoke("get_general_settings");
      setCheckOnStartup(general.checkForUpdatesOnStartup);
    } catch (error) {
      console.error("Failed to load general settings", error);
    }
  });

  async function toggleCheckOnStartup(checked: boolean) {
    setCheckOnStartup(checked);

    try {
      const general = await safeInvoke("get_general_settings");
      const updated: GeneralSettingsData = { ...general, checkForUpdatesOnStartup: checked };
      await safeInvoke("set_general_settings", { general: updated });
    } catch (error) {
      setCheckOnStartup(!checked);
      pushToast(typeof error === "string" ? error : JSON.stringify(error), "error", 6000);
    }
  }

  async function runCheck() {
    setPhase("checking");
    setErrorMessage("");

    try {
      const found = await checkForUpdate();
      if (found) {
        setUpdate(found);
        setPhase("available");
      } else {
        setPhase("upToDate");
      }
    } catch (error) {
      setErrorMessage(typeof error === "string" ? error : JSON.stringify(error));
      setPhase("error");
    }
  }

  async function downloadAndInstall() {
    const current = update();
    if (!current) return;

    setPhase("downloading");
    setProgress({ downloaded: 0, total: null });

    try {
      await current.downloadAndInstall(event => {
        switch (event.event) {
          case "Started":
            setProgress({ downloaded: 0, total: event.data.contentLength ?? null });
            break;
          case "Progress":
            setProgress(prev => ({ ...prev, downloaded: prev.downloaded + event.data.chunkLength }));
            break;
          case "Finished":
            break;
        }
      });
      setPhase("readyToRestart");
    } catch (error) {
      setErrorMessage(typeof error === "string" ? error : JSON.stringify(error));
      setPhase("error");
    }
  }

  const progressPercent = () => {
    const { downloaded, total } = progress();
    return total ? Math.round((downloaded / total) * 100) : null;
  };

  return <div class={settingsStyles.GeneralSettings}>
    <div class={settingsStyles.SettingRow}>
      <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
        <span>Current version</span>
        <span class={settingsStyles.Hint}>v{currentVersion()}</span>
        <div class={styles.CheckRow}>
          <Button
            disabled={phase() === "checking" || phase() === "downloading"}
            onClick={runCheck}
          >
            <RefreshCw size={16} style={{ "margin-right": '6px' }} />
            Check for updates
          </Button>
          <Switch>
            <Match when={phase() === "checking"}>
              <span class={styles.StatusText}>Checking…</span>
            </Match>
            <Match when={phase() === "upToDate"}>
              <span class={styles.StatusText} classList={{ [styles.Success]: true }}>
                <CircleCheck size={14} /> You're up to date
              </span>
            </Match>
            <Match when={phase() === "error"}>
              <span class={styles.StatusText} classList={{ [styles.Error]: true }}>
                <TriangleAlert size={14} /> {errorMessage()}
              </span>
            </Match>
          </Switch>
        </div>
      </div>
    </div>

    <Show when={phase() === "available" || phase() === "downloading" || phase() === "readyToRestart"}>
      <div class={settingsStyles.SettingRow}>
        <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
          <span>Update available , v{update()?.version}</span>
          <Show when={update()?.body}>
            <span class={settingsStyles.Hint}>{update()?.body}</span>
          </Show>
          <div class={styles.CheckRow}>
            <Switch>
              <Match when={phase() === "available"}>
                <Button filled color="var(--base-blue)" onClick={downloadAndInstall}>
                  <Download size={16} style={{ "margin-right": '6px' }} />
                  Download and install
                </Button>
              </Match>
              <Match when={phase() === "downloading"}>
                <div class={styles.ProgressBar}>
                  <div class={styles.ProgressTrack}>
                    <div
                      class={styles.ProgressFill}
                      classList={{ [styles.Indeterminate]: progressPercent() === null }}
                      style={progressPercent() !== null ? { width: `${progressPercent()}%` } : undefined}
                    />
                  </div>
                  <span class={styles.StatusText}>{progressPercent() !== null ? `Downloading ${progressPercent()}%` : "Downloading…"}</span>
                </div>
              </Match>
              <Match when={phase() === "readyToRestart"}>
                <Button filled color="var(--success-color)" onClick={() => relaunch()}>
                  Restart to finish installing
                </Button>
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </Show>

    <label class={settingsStyles.SettingRow}>
      <input
        type="checkbox"
        checked={checkOnStartup()}
        onChange={e => toggleCheckOnStartup(e.currentTarget.checked)}
      />
      <div class={settingsStyles.SettingText}>
        <span>Check for updates on startup</span>
        <span class={settingsStyles.Hint}>Silently checks when the app opens; you'll get a notification if one's found.</span>
      </div>
    </label>
  </div>;
}

export default UpdateSettings;
