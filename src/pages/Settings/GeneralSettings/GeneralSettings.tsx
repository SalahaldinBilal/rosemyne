import styles from "./GeneralSettings.module.scss";
import { createMemo, createSignal, onMount } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import Input from "@core/components/Input/Input";
import Button from "@core/components/Button/Button";
import Select from "@core/components/Select/Select";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { GeneralSettings as GeneralSettingsData, ScreenshotImageFormat, SelectItem, VideoCodec } from "@core/types";
import useToastState from "@core/states/toastState";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-solid";
import { CODEC_LABELS, SCREENSHOT_FORMAT_LABELS, SCREENSHOT_FORMATS } from "@core/helpers/settingsLabels";

function GeneralSettings() {
  const [general, setGeneral] = createStore<GeneralSettingsData>({
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
  });
  const [availableCodecs, setAvailableCodecs] = createSignal<VideoCodec[]>(["h264"]);
  const [directoryInput, setDirectoryInput] = createSignal("");
  const [uploadPathInput, setUploadPathInput] = createSignal("");
  const [fileNameInput, setFileNameInput] = createSignal("");
  const [fpsInput, setFpsInput] = createSignal("30");
  const { pushToast } = useToastState;

  onMount(async () => {
    const saved = await safeInvoke("get_general_settings");
    setGeneral(reconcile(saved));
    setDirectoryInput(saved.saveDirectory ?? "");
    setUploadPathInput(saved.uploadPath ?? "");
    setFileNameInput(saved.fileNameTemplate ?? "");
    setFpsInput(String(saved.recordFps));

    // Only offer codecs the running hardware/drivers can actually initialize;
    // always keep the currently-saved one selectable even if the probe didn't
    // confirm it (e.g. it hasn't been re-probed since a driver change).
    try {
      const codecs = await safeInvoke("get_available_video_codecs");
      setAvailableCodecs(codecs.includes(saved.recordCodec) ? codecs : [...codecs, saved.recordCodec]);
    } catch (error) {
      console.error("Failed to load available video codecs", error);
    }
  });

  async function apply(update: Partial<GeneralSettingsData>) {
    const previous = structuredClone(unwrap(general));
    setGeneral(update);

    try {
      await safeInvoke("set_general_settings", { general: structuredClone(unwrap(general)) });
      pushToast("Settings saved", "success", 3000);
    } catch (error) {
      setGeneral(reconcile(previous));
      setDirectoryInput(previous.saveDirectory ?? "");
      setUploadPathInput(previous.uploadPath ?? "");
      setFileNameInput(previous.fileNameTemplate ?? "");
      setFpsInput(String(previous.recordFps));
      pushToast(typeof error === "string" ? error : JSON.stringify(error), "error", 6000);
    }
  }

  function normalizedFps(): number {
    const parsed = Math.round(Number(fpsInput()));
    return Number.isFinite(parsed) ? Math.min(240, Math.max(1, parsed)) : general.recordFps;
  }

  const codecItems = createMemo<SelectItem<VideoCodec>[]>(() =>
    availableCodecs().map(codec => ({ id: codec, value: codec, label: CODEC_LABELS[codec] }))
  );
  const formatItems = createMemo<SelectItem<ScreenshotImageFormat>[]>(() =>
    SCREENSHOT_FORMATS.map(format => ({ id: format, value: format, label: SCREENSHOT_FORMAT_LABELS[format] }))
  );

  async function browseDirectory() {
    const picked = await open({ directory: true, defaultPath: directoryInput() || undefined });
    if (typeof picked === "string") setDirectoryInput(picked);
  }

  return <div class={styles.GeneralSettings}>
    <label class={styles.SettingRow}>
      <input
        type="checkbox"
        checked={general.copyToClipboardOnCapture}
        onChange={e => apply({ copyToClipboardOnCapture: e.currentTarget.checked })}
      />
      <div class={styles.SettingText}>
        <span>Copy screenshots to the clipboard</span>
        <span class={styles.Hint}>Every saved screenshot is also placed on the clipboard.</span>
      </div>
    </label>
    <label class={styles.SettingRow}>
      <input
        type="checkbox"
        checked={general.autostart}
        onChange={e => apply({ autostart: e.currentTarget.checked })}
      />
      <div class={styles.SettingText}>
        <span>Start with Windows</span>
        <span class={styles.Hint}>Launch Rosemyne automatically when you log in.</span>
      </div>
    </label>
    <label class={styles.SettingRow}>
      <input
        type="checkbox"
        checked={general.recordAudio}
        onChange={e => apply({ recordAudio: e.currentTarget.checked })}
      />
      <div class={styles.SettingText}>
        <span>Record system audio</span>
        <span class={styles.Hint}>Screen recordings include what you hear (speaker output). Applied when a recording starts.</span>
      </div>
    </label>
    <div class={styles.SettingRow}>
      <div class={styles.SettingText} style={{ width: '100%' }}>
        <span>Recording video codec</span>
        <span class={styles.Hint}>Only codecs the current GPU/drivers can actually initialize are listed. Default: H.264.</span>
        <Select value={general.recordCodec} items={codecItems()} onItemClick={item => apply({ recordCodec: item.value })} />
      </div>
    </div>
    <div class={styles.SettingRow}>
      <div class={styles.SettingText} style={{ width: '100%' }}>
        <span>Screenshot format</span>
        <span class={styles.Hint}>File format saved screenshots are encoded as. Default: WebP.</span>
        <Select value={general.screenshotFormat} items={formatItems()} onItemClick={item => apply({ screenshotFormat: item.value })} />
      </div>
    </div>
    <div class={styles.SettingRow}>
      <div class={styles.SettingText} style={{ width: '100%' }}>
        <span>Recording frame rate</span>
        <span class={styles.Hint}>Frames per second for screen recordings (1–240). Default: 30.</span>
        <div class={styles.DirectoryRow}>
          <Input
            type="number"
            min={1}
            max={240}
            value={fpsInput()}
            style={{ width: '110px' }}
            onChange={e => setFpsInput(e.currentTarget.value)}
          />
          <Button
            disabled={normalizedFps() === general.recordFps}
            onClick={() => {
              setFpsInput(String(normalizedFps()));
              apply({ recordFps: normalizedFps() });
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
    <div class={styles.SettingRow}>
      <div class={styles.SettingText} style={{ width: '100%' }}>
        <span>Save directory</span>
        <span class={styles.Hint}>Where screenshots, history and settings are stored. Leave empty for the default (Documents\Rosemyne). Existing images are not moved.</span>
        <div class={styles.DirectoryRow}>
          <Input
            value={directoryInput()}
            placeholder="Documents\Rosemyne (default)"
            style={{ 'flex-grow': 1 }}
            onChange={e => setDirectoryInput(e.currentTarget.value)}
          />
          <Button isIcon tooltip="Browse…" onClick={browseDirectory}>
            <FolderOpen size={18} />
          </Button>
          <Button
            disabled={(directoryInput().trim() || null) === general.saveDirectory}
            onClick={() => apply({ saveDirectory: directoryInput().trim() || null })}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
    <div class={styles.SettingRow}>
      <div class={styles.SettingText} style={{ width: '100%' }}>
        <span>Save path template</span>
        <span class={styles.Hint}>
          Sub-folder under <code>files/</code> where captures and imports are stored, organised by date.
          Variables: <code>{"${year}"}</code> <code>{"${month}"}</code> <code>{"${day}"}</code> <code>{"${hour}"}</code> <code>{"${minute}"}</code> <code>{"${second}"}</code> (2-digit, local time) and <code>{"${type}"}</code> (image/video/file). Default: <code>{"${year}-${month}"}</code>.
        </span>
        <div class={styles.DirectoryRow}>
          <Input
            value={uploadPathInput()}
            placeholder="${year}-${month}"
            style={{ 'flex-grow': 1 }}
            onChange={e => setUploadPathInput(e.currentTarget.value)}
          />
          <Button
            disabled={(uploadPathInput().trim() || null) === general.uploadPath}
            onClick={() => apply({ uploadPath: uploadPathInput().trim() || null })}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
    <div class={styles.SettingRow}>
      <div class={styles.SettingText} style={{ width: '100%' }}>
        <span>File name template</span>
        <span class={styles.Hint}>
          Name for saved captures (the screenshot format's extension is appended, <code>.mp4</code> for recordings; collisions get a numeric suffix).
          Variables: <code>{"${process}"}</code> <code>{"${windowTitle}"}</code> (most-captured window),{" "}
          <code>{"${year}"}</code> <code>{"${month}"}</code> <code>{"${day}"}</code> <code>{"${hour}"}</code>{" "}
          <code>{"${minute}"}</code> <code>{"${second}"}</code> <code>{"${millisecond}"}</code>,{" "}
          <code>{"${width}"}</code> <code>{"${height}"}</code>, <code>{"${random}"}</code>{" "}
          (8 chars, or <code>{"${random:N}"}</code>) and <code>{"${guid}"}</code>.
          Default: <code>{"${process}_${random:10}"}</code>.
        </span>
        <div class={styles.DirectoryRow}>
          <Input
            value={fileNameInput()}
            placeholder="${process}_${random:10}"
            style={{ 'flex-grow': 1 }}
            onChange={e => setFileNameInput(e.currentTarget.value)}
          />
          <Button
            disabled={(fileNameInput().trim() || null) === general.fileNameTemplate}
            onClick={() => apply({ fileNameTemplate: fileNameInput().trim() || null })}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  </div>
}

export default GeneralSettings;
