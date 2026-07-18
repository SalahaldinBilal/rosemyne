import styles from "./UpdateSettings.module.scss";
import settingsStyles from "../GeneralSettings/GeneralSettings.module.scss";
import { createMemo, createSignal, Match, onMount, Show, Switch } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { checkForUpdate, Update } from "@core/helpers/updater";
import { DownloadEvent } from "@tauri-apps/plugin-updater";
import Button from "@core/components/Button/Button";
import { CircleCheck, Download, RefreshCw, TriangleAlert } from "lucide-solid";
import ReleaseNotes from "./ReleaseNotes";

type Phase = "idle" | "checking" | "upToDate" | "available" | "downloading" | "readyToRestart" | "error";

function UpdateSettings() {
  const [currentVersion, setCurrentVersion] = createSignal("");
  const [phase, setPhase] = createSignal<Phase>("idle");
  const [update, setUpdate] = createSignal<Update | null>(null);
  const [progress, setProgress] = createSignal<{ downloaded: number, total: number | null }>({ downloaded: 0, total: null });
  const [errorMessage, setErrorMessage] = createSignal("");

  onMount(async () => {
    setCurrentVersion(await getVersion());
  });

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

  const progressPercent = createMemo(() => {
    const { downloaded, total } = progress();
    return total ? Math.round((downloaded / total) * 100) : null;
  });

  const showsUpdatePanel = createMemo(() => phase() === "available" || phase() === "downloading" || phase() === "readyToRestart");

  // Dev-only: lets the "available"/"downloading"/"readyToRestart" states and
  // the release notes rendering be previewed without a real update server.
  function simulateMockUpdate() {
    setErrorMessage("");
    setUpdate({
      version: "9.9.9",
      body:
        "### Added\n" +
        "- A totally new feature that makes screenshots 20% snappier.\n" +
        "- Support for dragging a screenshot card straight out to another app.\n" +
        "### Fixed\n" +
        "- The upload button no longer overwrites an existing link without asking first.\n" +
        "- Context menu items now line up correctly on high-DPI displays.\n",
      downloadAndInstall: async (onEvent?: (event: DownloadEvent) => void) => {
        const contentLength = 5_000_000;
        onEvent?.({ event: "Started", data: { contentLength } });
        for (let sent = 0; sent < contentLength; sent += 500_000) {
          await new Promise(resolve => setTimeout(resolve, 150));
          onEvent?.({ event: "Progress", data: { chunkLength: 500_000 } });
        }
        onEvent?.({ event: "Finished" });
      },
    } as unknown as Update);
    setPhase("available");
  }

  return <div class={settingsStyles.GeneralSettings} style="max-width: 9999px">
    <div class={styles.VersionRow}>
      <div class={styles.VersionText}>
        <span>Current version</span>
        <span class={styles.Hint}>v{currentVersion()}</span>
        <div class={styles.CheckRow}>
          <Button
            disabled={phase() === "checking" || phase() === "downloading"}
            onClick={runCheck}
          >
            <RefreshCw size={16} style={{ "margin-right": '6px' }} />
            Check for updates
          </Button>
          <Show when={import.meta.env.DEV}>
            <Button disabled={phase() === "downloading"} onClick={simulateMockUpdate}>
              Preview mock update (dev)
            </Button>
          </Show>
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

      <Show when={showsUpdatePanel()}>
        <div class={styles.UpdatePanel}>
          <div class={styles.UpdateHeading}>
            <span>Update available</span>
            <span class={styles.Hint}>v{update()?.version}</span>
          </div>
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
      </Show>
    </div>

    <Show when={showsUpdatePanel() && update()?.body}>
      {body => <ReleaseNotes notes={body()} />}
    </Show>
  </div>;
}

export default UpdateSettings;
