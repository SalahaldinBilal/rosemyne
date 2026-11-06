import styles from "./ShareXImport.module.scss";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import Input from "@core/components/Input/Input";
import Button from "@core/components/Button/Button";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { MigrationProgress, MigrationSummary } from "@core/types";
import { documentDir, join } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Event as TauriEvent, UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-solid";
import useToastState from "@core/states/toastState";
import { LARGE_VIDEO_BYTES, generateVideoThumbnail } from "@core/helpers/videoThumbnail";
import Progress from "@core/components/Progress/Progress";
import { InlineControls, SettingRow, SettingsGroup, SettingsPage } from "../SettingsLayout/SettingsLayout";

function ShareXImport() {
  const [sharexPath, setSharexPath] = createSignal("");
  const [running, setRunning] = createSignal(false);
  const [progress, setProgress] = createSignal<MigrationProgress | null>(null);
  const [summary, setSummary] = createSignal<{ data: MigrationSummary, dryRun: boolean } | null>(null);
  const [thumbnailBackfill, setThumbnailBackfill] = createSignal<{ current: number, total: number } | null>(null);
  const { pushToast } = useToastState;
  let unlisten: UnlistenFn | undefined;

  onMount(async () => {
    try {
      setSharexPath(await join(await documentDir(), "ShareX"));
    } catch {
      // Leave the field empty; the user can type the path manually.
    }

    unlisten = await getCurrentWebview().listen(
      "migration://progress",
      (event: TauriEvent<MigrationProgress>) => setProgress(event.payload),
    );
  });

  onCleanup(() => unlisten?.());

  async function run(dryRun: boolean) {
    const path = sharexPath().trim();
    if (!path || running()) return;

    setRunning(true);
    setSummary(null);
    setProgress(null);

    try {
      const data = await safeInvoke("migrate_from_sharex", { sharexPath: path, dryRun });
      setSummary({ data, dryRun });
      if (!dryRun) backfillLargeVideoThumbnails();
    } catch (err) {
      pushToast(typeof err === "string" ? err : JSON.stringify(err), "error", 8000);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  // Imported videos don't get a thumbnail at import time (unlike recordings);
  // small ones preview fine as a <video> fallback in the meantime, but large
  // ones just show a placeholder until someone scrolls past them in the main
  // list. Proactively generate thumbnails for those right after import so a
  // big migration doesn't leave a wall of placeholders.
  async function backfillLargeVideoThumbnails() {
    let fileNames: string[];
    try {
      fileNames = await safeInvoke("list_videos_missing_thumbnail", { minSizeBytes: LARGE_VIDEO_BYTES });
    } catch (error) {
      console.error("Failed to check for large videos missing thumbnails", error);
      return;
    }

    if (fileNames.length === 0) return;

    setThumbnailBackfill({ current: 0, total: fileNames.length });
    for (const [index, fileName] of fileNames.entries()) {
      await generateVideoThumbnail(fileName);
      setThumbnailBackfill({ current: index + 1, total: fileNames.length });
    }
    setThumbnailBackfill(null);
  }

  async function browseFolder() {
    const picked = await open({ directory: true, defaultPath: sharexPath() || undefined });
    if (typeof picked === "string") setSharexPath(picked);
  }

  const percent = createMemo(() => {
    const current = progress();
    if (!current || current.total === 0) return 0;
    return Math.round((current.current / current.total) * 100);
  });

  const busy = createMemo(() => running() || thumbnailBackfill() !== null);

  const backfillPercent = createMemo(() => {
    const current = thumbnailBackfill();
    return current ? Math.round((current.current / current.total) * 100) : 0;
  });

  return <SettingsPage
    title="ShareX import"
    description="Bring your ShareX history over. Files are copied, your ShareX folder isn't touched. Uploaders, hotkeys and settings aren't imported."
  >
    <SettingsGroup title="Source">
      <SettingRow stack label="ShareX folder" hint="Close ShareX before importing.">
        <InlineControls grow>
          <Input
            mono
            value={sharexPath()}
            placeholder="Documents\ShareX"
            disabled={busy()}
            onChange={e => setSharexPath(e.currentTarget.value)}
          />
          <Button isIcon tooltip="Browse" disabled={busy()} onClick={browseFolder}>
            <FolderOpen size={16} />
          </Button>
        </InlineControls>
        <div class={styles.Actions}>
          <Button disabled={busy() || !sharexPath().trim()} onClick={() => run(true)}>Dry run</Button>
          <Button variant="primary" disabled={busy() || !sharexPath().trim()} onClick={() => run(false)}>Import</Button>
        </div>
      </SettingRow>
      <Show when={running()}>
        <SettingRow stack label={progress() ? "Importing" : "Reading history"}>
          <Progress percent={progress() ? percent() : null} />
          <Show when={progress()}>
            {current => <span class={styles.Hint}>{current().current} / {current().total}, {current().currentFile}</span>}
          </Show>
        </SettingRow>
      </Show>
      <Show when={thumbnailBackfill()}>
        {current => <SettingRow stack label="Generating thumbnails for large videos">
          <Progress percent={backfillPercent()} />
          <span class={styles.Hint}>{current().current} / {current().total}</span>
        </SettingRow>}
      </Show>
    </SettingsGroup>

    <Show when={summary()}>
      {result => <SettingsGroup title={result().dryRun ? "Dry run result" : "Import result"}>
        <div class={styles.Stats}>
          <div class={styles.Stat}><b>{result().data.imported}</b><span>{result().dryRun ? "Would import" : "Imported"}</span></div>
          <div class={styles.Stat}><b>{result().data.missingFile}</b><span>Missing file</span></div>
          <div class={styles.Stat}><b>{result().data.skippedNonImage}</b><span>Not an image</span></div>
          <div class={styles.Stat}><b>{result().data.errors}</b><span>Errors</span></div>
          <div class={styles.Stat}><b>{result().data.total}</b><span>Total rows</span></div>
        </div>
      </SettingsGroup>}
    </Show>
  </SettingsPage>
}

export default ShareXImport;
