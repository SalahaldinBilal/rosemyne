import styles from "./UpdateSettings.module.scss";
import Badge from "@core/components/Badge/Badge";
import Progress, { Spinner } from "@core/components/Progress/Progress";
import { InlineControls, SettingRow, SettingsGroup, SettingsPage } from "../SettingsLayout/SettingsLayout";
import { createMemo, createSignal, Match, onMount, Show, Switch } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { checkForUpdate, Update } from "@core/helpers/updater";
import { DownloadEvent } from "@tauri-apps/plugin-updater";
import { safeInvoke } from "@core/helpers/safeInvoke";
import Button from "@core/components/Button/Button";
import Modal from "@core/components/Modal/Modal";
import { CircleCheck, Download, RefreshCw, ScrollText, TriangleAlert } from "lucide-solid";
import ReleaseNotes from "./ReleaseNotes";
import FullChangelog from "./FullChangelog";

type Phase = "idle" | "checking" | "upToDate" | "available" | "downloading" | "readyToRestart" | "error";

function UpdateSettings() {
  const [currentVersion, setCurrentVersion] = createSignal("");
  const [phase, setPhase] = createSignal<Phase>("idle");
  const [update, setUpdate] = createSignal<Update | null>(null);
  const [progress, setProgress] = createSignal<{ downloaded: number, total: number | null }>({ downloaded: 0, total: null });
  const [errorMessage, setErrorMessage] = createSignal("");

  const [showChangelog, setShowChangelog] = createSignal(false);
  const [changelogText, setChangelogText] = createSignal<string | null>(null);
  const [changelogLoading, setChangelogLoading] = createSignal(false);
  const [changelogError, setChangelogError] = createSignal("");

  onMount(async () => {
    setCurrentVersion(await getVersion());
  });

  // Fetched once and cached, re-opening the modal doesn't re-fetch.
  async function openChangelog() {
    setShowChangelog(true);
    if (changelogText() || changelogLoading()) return;

    setChangelogLoading(true);
    setChangelogError("");
    try {
      setChangelogText(await safeInvoke("fetch_changelog"));
    } catch (error) {
      setChangelogError(typeof error === "string" ? error : JSON.stringify(error));
    } finally {
      setChangelogLoading(false);
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

  const statusLabel = createMemo(() => {
    switch (phase()) {
      case "available": return `Version ${update()?.version} is available`;
      case "downloading": return `Downloading ${update()?.version}`;
      case "readyToRestart": return `${update()?.version} is ready`;
      default: return "Updates";
    }
  });

  return <SettingsPage title="Updates" description="Check for new versions and install them.">
    <SettingsGroup
      title="Version"
      right={<Button size="sm" variant="ghost" onClick={openChangelog}><ScrollText size={14} />Full changelog</Button>}
    >
      <SettingRow label="Current version" hint={`v${currentVersion()}`}>
        <InlineControls>
          <Show when={import.meta.env.DEV}>
            <Button size="sm" variant="ghost" disabled={phase() === "downloading"} onClick={simulateMockUpdate}>Mock update</Button>
          </Show>
          <Button disabled={phase() === "checking" || phase() === "downloading"} onClick={runCheck}>
            <RefreshCw size={15} />Check for updates
          </Button>
        </InlineControls>
      </SettingRow>
      <SettingRow label={statusLabel()}>
        <div class={styles.Status}>
          <Switch fallback={<span class={styles.Faint}>Not checked yet</span>}>
            <Match when={phase() === "checking"}>
              <Spinner size="sm" /><span class={styles.Faint}>Checking</span>
            </Match>
            <Match when={phase() === "upToDate"}>
              <Badge tone="ok"><CircleCheck size={11} />Up to date</Badge>
            </Match>
            <Match when={phase() === "error"}>
              <span class={styles.Error}><TriangleAlert size={14} />{errorMessage()}</span>
            </Match>
            <Match when={phase() === "available"}>
              <Button variant="primary" onClick={downloadAndInstall}><Download size={15} />Download and install</Button>
            </Match>
            <Match when={phase() === "downloading"}>
              <Progress class={styles.DownloadBar} percent={progressPercent()} />
              <span class={styles.Faint}>{progressPercent() !== null ? `${progressPercent()}%` : ""}</span>
            </Match>
            <Match when={phase() === "readyToRestart"}>
              <Button variant="primary" onClick={() => relaunch()}>Restart to finish</Button>
            </Match>
          </Switch>
        </div>
      </SettingRow>
    </SettingsGroup>

    <Show when={showsUpdatePanel() && update()?.body}>
      {body => <SettingsGroup title="What's new">
        <div class={styles.Notes}><ReleaseNotes notes={body()} /></div>
      </SettingsGroup>}
    </Show>

    <Modal show={showChangelog()} onHide={() => setShowChangelog(false)} title="Changelog" width={640} height="75%">
      <Switch>
        <Match when={changelogLoading()}>
          <div class={styles.Status}><Spinner size="sm" /><span class={styles.Faint}>Loading</span></div>
        </Match>
        <Match when={changelogError()}>
          <span class={styles.Error}><TriangleAlert size={14} />{changelogError()}</span>
        </Match>
        <Match when={changelogText()}>
          {text => <FullChangelog text={text()} />}
        </Match>
      </Switch>
    </Modal>
  </SettingsPage>;
}

export default UpdateSettings;
