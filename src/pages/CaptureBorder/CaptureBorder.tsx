import styles from "./CaptureBorder.module.scss";
import { createSignal, onCleanup, onMount } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { safeInvoke } from "@core/helpers/safeInvoke";

type Mode = "recording" | "scrollCapture";

// Click-through, capture-excluded window inflated by the border width around the active region,
// so the stroke sits entirely outside the captured pixels. Red for recording, violet for scrolling capture.
function CaptureBorder() {
  const [mode, setMode] = createSignal<Mode>("recording");
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    const show = (next: Mode) => () => {
      setMode(next);
      setVisible(false);
      requestAnimationFrame(() => setVisible(true));
    };
    const listeners = [
      listen("recording://overlay-shown", show("recording")),
      listen("scroll-capture://overlay-shown", show("scrollCapture")),
      listen("recording://overlay-hidden", () => setVisible(false)),
      listen("scroll-capture://overlay-hidden", () => setVisible(false)),
    ];
    onCleanup(() => listeners.forEach(promise => promise.then(unlisten => unlisten())));

    // Catch up if this page reloads while a recording is already running.
    safeInvoke("get_recording_status")
      .then(active => active && show("recording")())
      .catch(() => { });
  });

  return <div class={styles.Border} classList={{ [styles.Scroll]: mode() === "scrollCapture", [styles.Visible]: visible() }} />;
}

export default CaptureBorder;
