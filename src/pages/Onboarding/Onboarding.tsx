import styles from "./Onboarding.module.scss";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { SettingsEmbedded } from "../Settings/SettingsLayout/SettingsLayout";
import { createStore, unwrap } from "solid-js/store";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useNavigate } from "@solidjs/router";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import { GeneralSettings as GeneralSettingsData } from "@core/types";
import Button from "@core/components/Button/Button";
import useToastState from "@core/states/toastState";
import { setOnboardingJustFinished } from "@core/states/onboardingState";
import ShortcutSettings from "../Settings/ShortcutSettings/ShortcutSettings";
import UploaderSettings from "../Settings/UploaderSettings/UploaderSettings";
import ShareXImport from "../Settings/ShareXImport/ShareXImport";
import GeneralStep from "./steps/GeneralStep";
import ContextMenuStep from "./steps/ContextMenuStep";
import ImageStep from "./steps/ImageStep";
import VideoStep from "./steps/VideoStep";

const SEGMENT_GAP = 6;

const DEFAULT_GENERAL: GeneralSettingsData = {
  saveDirectory: null,
  uploadPath: null,
  fileNameTemplate: null,
  copyToClipboardOnCapture: true,
  autostart: false,
  recordAudio: true,
  recordFps: 30,
  recordCodec: "h264",
  recordBitrateMbps: 60,
  recordBitrateMode: "variable",
  screenshotFormat: "webp",
  hasCompletedOnboarding: false,
  checkForUpdatesOnStartup: true,
  stripWindowBorder: true,
  includeCursor: false,
  cursorSource: "live",
  pickedCursor: null,
  minSelectionWidth: 15,
  minSelectionHeight: 15,
  contextMenu: true,
  browserExtension: false,
  fitCardThumbnails: false,
};

function Onboarding() {
  const navigate = useNavigate();
  const { pushToast } = useToastState;
  const [step, setStep] = createSignal(0);
  const [loaded, setLoaded] = createSignal(false);
  const [general, setGeneral] = createStore<GeneralSettingsData>({ ...DEFAULT_GENERAL });

  onMount(async () => {
    // Onboarding owns showing the window for this (first) launch, Main's
    // own `.window.show()` never runs since it redirects here before reaching it.
    await getCurrentWebview().window.show();

    try {
      setGeneral(await safeInvoke("get_general_settings"));
    } catch (error) {
      console.error("Failed to load settings for onboarding", error);
    } finally {
      setLoaded(true);
    }
  });

  async function saveGeneral(update: Partial<GeneralSettingsData>) {
    setGeneral(update);
    try {
      await safeInvoke("set_general_settings", { general: structuredClone(unwrap(general)) });
    } catch (error) {
      pushToast(errorMessage(error), "error", 6000);
    }
  }

  const steps = [
    {
      title: "General",
      description: "A few basics to get started. You can change all of this later in Settings.",
      content: () => <GeneralStep general={general} onChange={saveGeneral} />,
    },
    {
      title: "Context menu",
      description: "Upload files straight from your file manager's right-click menu. On by default, you can change it here or later in Settings.",
      content: () => <ContextMenuStep />,
    },
    {
      title: "Shortcuts",
      description: "Set up keyboard shortcuts for capturing and recording. Optional, skip it and bind them later.",
      content: () => <ShortcutSettings />,
    },
    {
      title: "Image settings",
      description: "How screenshots get saved.",
      content: () => <ImageStep general={general} onChange={saveGeneral} />,
    },
    {
      title: "Video settings",
      description: "How screen recordings get saved.",
      content: () => <VideoStep general={general} onChange={saveGeneral} />,
    },
    {
      title: "Upload",
      description: "Add an image host so captures can be uploaded and shared directly. Optional, skip it and add one later.",
      content: () => <UploaderSettings />,
    },
    {
      title: "Import from ShareX",
      description: "Bring your existing ShareX screenshot history into Rosemyne. Optional, skip it and import later.",
      content: () => <ShareXImport />,
    },
  ];

  const isLast = createMemo(() => step() === steps.length - 1);
  const [direction, setDirection] = createSignal<1 | -1>(1);
  const current = createMemo(() => steps[step()]);
  // One clipped copy of the segment row, so the fill sweeps across the gaps instead of each segment filling alone.
  const fillClip = createMemo(() => {
    const filled = (step() + 1) / steps.length;
    return { "clip-path": `inset(0 calc((100% + ${SEGMENT_GAP}px) * ${1 - filled}) 0 0)` };
  });

  function goTo(index: number) {
    if (index === step()) return;
    setDirection(index > step() ? 1 : -1);
    setStep(index);
  }

  async function finish() {
    // Set before the save so Main doesn't bounce back here if the save is
    // slow or fails, see onboardingState.ts.
    setOnboardingJustFinished(true);

    try {
      await safeInvoke("set_general_settings", {
        general: { ...structuredClone(unwrap(general)), hasCompletedOnboarding: true },
      });
    } catch (error) {
      console.error("Failed to persist onboarding completion", error);
    }

    navigate("/", { replace: true });
  }

  function next() {
    if (isLast()) {
      finish();
      return;
    }
    goTo(step() + 1);
  }

  function back() {
    goTo(Math.max(0, step() - 1));
  }

  return <div class={styles.Onboarding}>
    <div class={styles.Column}>
      <div class={styles.Brand}>
        <img src="/icon.svg" alt="" />
        <div>
          <b>Welcome to Rosemyne</b>
          <span>Step {step() + 1} of {steps.length}</span>
        </div>
      </div>

      <div class={styles.Steps} style={{ "--segments": steps.length }}>
        <div class={styles.Track}>
          <div class={styles.Bars}>
            <For each={steps}>{(_, index) => <i onClick={() => goTo(index())} />}</For>
          </div>
          <div class={`${styles.Bars} ${styles.Filled}`} style={fillClip()} aria-hidden="true">
            <For each={steps}>{() => <i />}</For>
          </div>
        </div>
        <div class={styles.Labels}>
          <For each={steps}>{(item, index) =>
            <button
              type="button"
              classList={{ [styles.Current]: index() === step(), [styles.Done]: index() < step() }}
              onClick={() => goTo(index())}
            >
              {item.title}
            </button>
          }</For>
        </div>
      </div>

      <div class={styles.Body}>
        <Show when={loaded() && current()} keyed>
          {item => (
            <div class={styles.Step} classList={{ [styles.FromLeft]: direction() < 0 }}>
              <div class={styles.StepHeading}>
                <h2>{item.title}</h2>
                <p>{item.description}</p>
              </div>
              <SettingsEmbedded.Provider value={true}>
                {item.content()}
              </SettingsEmbedded.Provider>
            </div>
          )}
        </Show>
      </div>
    </div>

    <div class={styles.Footer}>
      <div class={styles.FooterInner}>
        <Button variant="ghost" onClick={finish}>Skip setup</Button>
        <div class={styles.NavButtons}>
          <Button disabled={step() === 0} onClick={back}>Back</Button>
          <Button variant="primary" onClick={next}>{isLast() ? "Finish" : "Next"}</Button>
        </div>
      </div>
    </div>
  </div>
}

export default Onboarding;
