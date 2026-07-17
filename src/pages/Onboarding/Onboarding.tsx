import styles from "./Onboarding.module.scss";
import { createSignal, For, onMount, Show } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useNavigate } from "@solidjs/router";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { GeneralSettings as GeneralSettingsData } from "@core/types";
import Button from "@core/components/Button/Button";
import useToastState from "@core/states/toastState";
import { setOnboardingJustFinished } from "@core/states/onboardingState";
import ShortcutSettings from "../Settings/ShortcutSettings/ShortcutSettings";
import UploaderSettings from "../Settings/UploaderSettings/UploaderSettings";
import ShareXImport from "../Settings/ShareXImport/ShareXImport";
import GeneralStep from "./steps/GeneralStep";
import ImageStep from "./steps/ImageStep";
import VideoStep from "./steps/VideoStep";

const DEFAULT_GENERAL: GeneralSettingsData = {
  saveDirectory: null,
  uploadPath: null,
  fileNameTemplate: null,
  copyToClipboardOnCapture: true,
  autostart: false,
  recordAudio: true,
  recordFps: 30,
  recordCodec: "h264",
  screenshotFormat: "webp",
  hasCompletedOnboarding: false,
  checkForUpdatesOnStartup: true,
};

function Onboarding() {
  const navigate = useNavigate();
  const { pushToast } = useToastState;
  const [step, setStep] = createSignal(0);
  const [loaded, setLoaded] = createSignal(false);
  const [general, setGeneral] = createStore<GeneralSettingsData>({ ...DEFAULT_GENERAL });

  onMount(async () => {
    // Onboarding owns showing the window for this (first) launch , Main's
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
      pushToast(typeof error === "string" ? error : JSON.stringify(error), "error", 6000);
    }
  }

  const steps = [
    {
      title: "General",
      description: "A couple of basics to get started , you can change any of this later in Settings.",
      content: () => <GeneralStep general={general} onChange={saveGeneral} />,
    },
    {
      title: "Shortcuts",
      description: "Set up keyboard shortcuts for capturing and recording. Optional , skip it and bind them later.",
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
      description: "Add an image host so captures can be uploaded and shared directly. Optional , skip it and add one later.",
      content: () => <UploaderSettings />,
    },
    {
      title: "Import from ShareX",
      description: "Bring your existing ShareX screenshot history into Rosemyne. Optional , skip it and import later.",
      content: () => <ShareXImport />,
    },
  ];

  const isLast = () => step() === steps.length - 1;

  async function finish() {
    // Set before the save so Main doesn't bounce back here if the save is
    // slow or fails , see onboardingState.ts.
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
    setStep(current => current + 1);
  }

  function back() {
    setStep(current => Math.max(0, current - 1));
  }

  return <div class={styles.Onboarding}>
    <div class={styles.Header}>
      <div class={styles.Brand}>
        <img src="/icon.svg" alt="" />
        <span>Welcome to Rosemyne</span>
      </div>
      <div class={styles.Progress}>
        <For each={steps}>{(item, index) =>
          <div
            class={styles.Dot}
            classList={{ [styles.DotActive]: index() === step(), [styles.DotDone]: index() < step() }}
            title={item.title}
          />
        }</For>
      </div>
    </div>

    <div class={styles.Body}>
      <Show when={loaded()}>
        <div class={styles.StepHeading}>
          <h2>{steps[step()].title}</h2>
          <p>{steps[step()].description}</p>
        </div>
        <div class={styles.StepContent}>
          {steps[step()].content()}
        </div>
      </Show>
    </div>

    <div class={styles.Footer}>
      <Button onClick={finish}>Skip onboarding</Button>
      <div class={styles.NavButtons}>
        <Button disabled={step() === 0} onClick={back}>Back</Button>
        <Button filled color="var(--base-blue)" onClick={next}>{isLast() ? "Finish" : "Next"}</Button>
      </div>
    </div>
  </div>
}

export default Onboarding;
