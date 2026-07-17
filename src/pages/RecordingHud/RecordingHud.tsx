import { Show, createSignal, onCleanup, onMount } from "solid-js";
import styles from "./RecordingHud.module.scss";
import Button from "@core/components/Button/Button";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { RecordingStatus } from "@core/types";
import { listen } from "@tauri-apps/api/event";
import { Square, Volume2, VolumeX, X } from "lucide-solid";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

// This window is created hidden at startup and reused across recordings: the
// backend shows it before the engine finishes starting (null status renders
// "Starting…") and hides it again when the recording ends.
function RecordingHud() {
  const [status, setStatus] = createSignal<RecordingStatus | null>(null);
  const [now, setNow] = createSignal(Date.now());
  const [busy, setBusy] = createSignal(false);
  let fetching = false;
  let timer: number | undefined;

  async function refreshStatus() {
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

  function beginSession() {
    setStatus(null);
    setBusy(false);
    setNow(Date.now());
    if (timer === undefined) {
      timer = window.setInterval(() => {
        setNow(Date.now());
        refreshStatus();
      }, 250);
    }
    refreshStatus();
  }

  function endSession() {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
    setStatus(null);
    setBusy(false);
  }

  onMount(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    const listeners = [
      listen("recording://overlay-shown", beginSession),
      listen("recording://overlay-hidden", endSession),
    ];

    // Catch up if the page (re)loads while a recording is already active.
    safeInvoke("get_recording_status")
      .then(active => active && beginSession())
      .catch(() => {});

    onCleanup(() => {
      endSession();
      listeners.forEach(promise => promise.then(unlisten => unlisten()));
    });
  });

  // The backend hides this window when the recording ends; the catch only
  // covers failures that leave it showing.
  async function stop() {
    if (busy()) return;
    setBusy(true);
    try {
      await safeInvoke("stop_recording");
    } catch (error) {
      console.error("Failed to stop the recording", error);
      setBusy(false);
    }
  }

  async function cancel() {
    if (busy()) return;
    setBusy(true);
    try {
      await safeInvoke("cancel_recording");
    } catch (error) {
      console.error("Failed to cancel the recording", error);
      setBusy(false);
    }
  }

  return <div class={styles.RecordingHud}>
    <div class={styles.RecordDot} classList={{ [styles.Starting]: !status() }} />
    <Show when={status()} fallback={<span class={styles.StartingLabel}>Starting…</span>}>
      {active => <>
        <span class={styles.Timer}>{formatElapsed(now() - active().startedAtMs)}</span>
        <span class={styles.Audio} title={active().withAudio ? "System audio is recorded" : "No audio"}>
          <Show when={active().withAudio} fallback={<VolumeX size={16} />}>
            <Volume2 size={16} />
          </Show>
        </span>
      </>}
    </Show>
    <div class={styles.Spacer} />
    <Show when={!busy()} fallback={<span class={styles.Saving}>Saving…</span>}>
      <Button isIcon tooltip="Stop and save" onClick={stop}>
        <Square size={16} fill="currentColor" />
      </Button>
      <Button isIcon tooltip="Discard recording" color="var(--danger-color)" onClick={cancel}>
        <X size={18} />
      </Button>
    </Show>
  </div>;
}

export default RecordingHud;
