import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import styles from "./CaptureHud.module.scss";
import Button from "@core/components/Button/Button";
import Progress, { Spinner } from "@core/components/Progress/Progress";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { RecordingStatus, ScrollCaptureProgress } from "@core/types";
import { listen } from "@tauri-apps/api/event";
import { Square, Volume2, VolumeX, X } from "lucide-solid";

type SessionKind = "recording" | "scrollCapture";

const HINT_COLLAPSE_MS = 160;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

// Pre-created hidden, reused across both recording and scrolling-capture sessions.
function CaptureHud() {
  const [session, setSession] = createSignal<SessionKind | null>(null);
  const [status, setStatus] = createSignal<RecordingStatus | null>(null);
  const [progress, setProgress] = createSignal<ScrollCaptureProgress | null>(null);
  const [now, setNow] = createSignal(Date.now());
  const [busy, setBusy] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  // Tooltips would be cut off by the window, so hovering grows the pill into the space under it to show a hint.
  const [hintText, setHintText] = createSignal("");
  const [hintShown, setHintShown] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  let collapseTimer: number | undefined;
  const elapsed = createMemo(() => {
    const active = status();
    return active ? formatElapsed(now() - active.startedAtMs) : "";
  });
  const frameText = createMemo(() => {
    const current = progress();
    return `${current?.frame ?? 0}${current?.maxFrames ? ` / ${current.maxFrames}` : ""}`;
  });
  const framePercent = createMemo(() => {
    const current = progress();
    return current && current.maxFrames > 0 ? Math.min(100, (current.frame / current.maxFrames) * 100) : null;
  });
  let fetching = false;
  let timer: number | undefined;

  function showHint(text: string) {
    clearTimeout(collapseTimer);
    setHintText(text);
    setHintShown(true);
    setExpanded(true);
  }

  // Waits for the fade, and so moving between controls doesn't shrink and regrow the pill.
  function hideHint(immediately = false) {
    clearTimeout(collapseTimer);
    setHintShown(false);
    if (immediately) setExpanded(false);
    else collapseTimer = window.setTimeout(() => setExpanded(false), HINT_COLLAPSE_MS);
  }

  function hintOn(text: string) {
    return { onMouseEnter: () => showHint(text), onMouseLeave: () => hideHint() };
  }

  async function refreshRecordingStatus() {
    if (fetching || status()) return;
    fetching = true;
    try {
      // Blocks on the backend until the in-flight start settles, which is
      // exactly the moment the HUD should flip from "Starting…" to the timer.
      setStatus(await safeInvoke("get_recording_status"));
    } catch (error) {
      console.error("Failed to load the recording status", error);
    } finally {
      fetching = false;
    }
  }

  function beginRecording() {
    resetSession();
    setSession("recording");
    setStatus(null);
    setBusy(false);
    setNow(Date.now());
    if (timer === undefined) {
      timer = window.setInterval(() => {
        setNow(Date.now());
        refreshRecordingStatus();
      }, 250);
    }
    refreshRecordingStatus();
  }

  function beginScrollCapture() {
    resetSession();
    setSession("scrollCapture");
    setProgress({ frame: 0, maxFrames: 0 });
    setBusy(false);
  }

  // The window hides a moment after this (capture_overlay's HIDE_DELAY_MS), so the content stays for the fade.
  function endSession() {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
    setLeaving(true);
  }

  function resetSession() {
    setLeaving(false);
    clearTimeout(collapseTimer);
    setHintShown(false);
    setExpanded(false);
    setSession(null);
    setStatus(null);
    setProgress(null);
    setBusy(false);
  }

  onMount(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    const listeners = [
      listen("recording://overlay-shown", beginRecording),
      listen("recording://overlay-hidden", endSession),
      listen("scroll-capture://overlay-shown", beginScrollCapture),
      listen("scroll-capture://overlay-hidden", endSession),
      listen<ScrollCaptureProgress>("scroll-capture://progress", event => setProgress(event.payload)),
    ];

    // Catch up if the page (re)loads while a recording is already active, there's
    // no equivalent for scroll capture, which is a single short-lived command run.
    safeInvoke("get_recording_status")
      .then(active => active && beginRecording())
      .catch(() => { });

    onCleanup(() => {
      endSession();
      listeners.forEach(promise => promise.then(unlisten => unlisten()));
    });
  });

  // The backend hides this window when the session ends; the catch only
  // covers failures that leave it showing.
  async function stop() {
    if (busy()) return;
    setBusy(true);
    hideHint(true);
    try {
      await safeInvoke(session() === "scrollCapture" ? "stop_scrolling_capture" : "stop_recording");
    } catch (error) {
      console.error("Failed to stop the capture", error);
      setBusy(false);
    }
  }

  async function cancel() {
    if (busy()) return;
    setBusy(true);
    hideHint(true);
    try {
      await safeInvoke(session() === "scrollCapture" ? "cancel_scrolling_capture" : "cancel_recording");
    } catch (error) {
      console.error("Failed to cancel the capture", error);
      setBusy(false);
    }
  }

  return <Show when={session()} keyed>
    {kind => (
      <div class={styles.CaptureHud} classList={{ [styles.Leaving]: leaving(), [styles.Expanded]: expanded() }}>
        <div class={styles.Row}>
          <Show when={kind === "recording"}>
            <div class={styles.RecordDot} classList={{ [styles.Starting]: !status() }} />
            <Show when={status()} fallback={<span class={styles.Muted}>Starting</span>}>
              {active => <>
                <span class={styles.Timer}>{elapsed()}</span>
                <span class={styles.Audio} {...hintOn(active().withAudio ? "Recording audio" : "No audio")}>
                  <Show when={active().withAudio} fallback={<VolumeX size={16} />}>
                    <Volume2 size={16} />
                  </Show>
                </span>
              </>}
            </Show>
          </Show>
          <Show when={kind === "scrollCapture"}>
            <div class={styles.RecordDot} classList={{ [styles.Scroll]: true }} />
            <span class={styles.Timer} {...hintOn("Frames captured")}>{frameText()}</span>
            <Show when={framePercent() !== null}>
              <Progress class={styles.FrameProgress} percent={framePercent()} />
            </Show>
          </Show>
          <div class={styles.Spacer} />
          <span class={styles.Divider} />
          <Show when={!busy()} fallback={<span class={styles.Saving}><Spinner size="sm" />Saving</span>}>
            <span class={styles.Hinted} {...hintOn("Stop and save")}>
              <Button isIcon size="sm" onClick={stop}>
                <Square size={14} fill="currentColor" />
              </Button>
            </span>
            <span class={styles.Hinted} {...hintOn("Discard")}>
              <Button isIcon size="sm" variant="danger" onClick={cancel}>
                <X size={16} />
              </Button>
            </span>
          </Show>
        </div>
        <div class={styles.Hint} classList={{ [styles.Shown]: hintShown() }}>{hintText()}</div>
      </div>
    )}
  </Show>;
}

export default CaptureHud;
