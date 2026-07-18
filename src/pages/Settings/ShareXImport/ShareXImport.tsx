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

  return <div class={styles.ShareXImport}>
    <div class={styles.Intro}>
      <span>Import your ShareX screenshot history into Rosemyne.</span>
      <span class={styles.Hint}>
        Image files are copied into Rosemyne's own storage , your ShareX folder is never modified.
        Uploaders, hotkeys and settings are not imported. Close ShareX before importing.
      </span>
    </div>

    <div class={styles.Field}>
      <span>ShareX folder</span>
      <div class={styles.FieldRow}>
        <Input
          value={sharexPath()}
          placeholder="Documents\ShareX"
          disabled={busy()}
          style={{ 'flex-grow': 1 }}
          onChange={e => setSharexPath(e.currentTarget.value)}
        />
        <Button isIcon tooltip="Browse…" disabled={busy()} onClick={browseFolder}>
          <FolderOpen size={18} />
        </Button>
      </div>
    </div>

    <div class={styles.Actions}>
      <Button
        color="var(--base-font-color)"
        disabled={busy() || !sharexPath().trim()}
        onClick={() => run(true)}
      >
        Dry run
      </Button>
      <Button
        disabled={busy() || !sharexPath().trim()}
        onClick={() => run(false)}
      >
        Import
      </Button>
    </div>

    <Show when={running()}>
      <div class={styles.Progress}>
        <div class={styles.ProgressBar}>
          <div class={styles.ProgressFill} style={{ width: `${percent()}%` }} />
        </div>
        <Show when={progress()} fallback={<span class={styles.Hint}>Reading history…</span>}>
          {current => <span class={styles.Hint}>
            {current().current} / {current().total} , {current().currentFile}
          </span>}
        </Show>
      </div>
    </Show>

    <Show when={summary()}>
      {result => <div class={styles.Summary}>
        <div class={styles.SummaryTitle}>
          {result().dryRun ? "Dry run complete" : "Import complete"}
        </div>
        <div class={styles.SummaryGrid}>
          <div class={styles.Stat}>
            <span class={styles.StatValue}>{result().data.imported}</span>
            <span class={styles.StatLabel}>{result().dryRun ? "Would import" : "Imported"}</span>
          </div>
          <div class={styles.Stat}>
            <span class={styles.StatValue}>{result().data.missingFile}</span>
            <span class={styles.StatLabel}>Missing file</span>
          </div>
          <div class={styles.Stat}>
            <span class={styles.StatValue}>{result().data.skippedNonImage}</span>
            <span class={styles.StatLabel}>Not an image</span>
          </div>
          <div class={styles.Stat}>
            <span class={styles.StatValue}>{result().data.errors}</span>
            <span class={styles.StatLabel}>Errors</span>
          </div>
          <div class={styles.Stat}>
            <span class={styles.StatValue}>{result().data.total}</span>
            <span class={styles.StatLabel}>Total rows</span>
          </div>
        </div>
      </div>}
    </Show>

    <Show when={thumbnailBackfill()}>
      {current => <div class={styles.Progress}>
        <div class={styles.ProgressBar}>
          <div
            class={styles.ProgressFill}
            style={{ width: `${Math.round((current().current / current().total) * 100)}%` }}
          />
        </div>
        <span class={styles.Hint}>
          Generating thumbnails for large videos: {current().current} / {current().total}
        </span>
      </div>}
    </Show>
  </div>
}

export default ShareXImport;
