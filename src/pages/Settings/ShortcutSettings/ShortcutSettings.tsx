import { createMemo, createSignal, For, JSX, onMount, Show } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import { listen } from "@tauri-apps/api/event";
import styles from "./ShortcutSettings.module.scss";
import KeyRenderer from "@core/components/KeyRenderer/KeyRenderer";
import ShortcutPicker from "@core/components/ShortcutPicker/ShortcutPicker";
import Button from "@core/components/Button/Button";
import Select from "@core/components/Select/Select";
import Switch from "@core/components/Switch/Switch";
import Badge from "@core/components/Badge/Badge";
import NumberField from "@core/components/NumberField/NumberField";
import DurationField from "@core/components/DurationField/DurationField";
import ScrollDistanceInput from "@core/components/ScrollDistanceInput/ScrollDistanceInput";
import TemplateInput from "@core/components/TemplateInput/TemplateInput";
import { hasBadTokens } from "@core/components/TemplateInput/templateTokens";
import Segmented from "@core/components/Segmented/Segmented";
import Modal from "@core/components/Modal/Modal";
import { InlineControls, SettingRow, SettingsGroup, SettingsPage } from "../SettingsLayout/SettingsLayout";
import {
  CaptureOverrides, CaptureTarget, GeneralSettings, MonitorInfo, ScreenshotImageFormat, ScrollDistance,
  ScrollingCaptureSettings, SelectItem, ShortcutBinding, ShortcutKeys, ShortcutMethod, SoundSetting, SoundSettings,
  UploadOverride, VideoCodec,
} from "@core/types";
import { SavedUploader } from "@core/types/request";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import { findMonitor } from "@core/helpers/monitors";
import { BITRATE_MODE_ITEMS, BITRATE_MODE_LABELS, CODEC_LABELS, SCREENSHOT_FORMAT_LABELS, SCREENSHOT_FORMATS } from "@core/helpers/settingsLabels";
import { emptyOverrides, keepOverrides, OVERRIDE_KEYS, OverrideKey, overrideCount } from "@core/helpers/captureOverrides";
import { FILE_NAME_VARIABLES, SAVE_PATH_VARIABLES } from "@core/constants/templateVariables";
import useSettingsState from "@core/states/settingsState";
import useToastState from "@core/states/toastState";
import useSettingsSavedState from "@core/states/settingsSavedState";
import { Camera, Crop, Monitor, Plus, RotateCcw, ScrollText, Trash2, Video } from "lucide-solid";

type MethodType = ShortcutMethod["type"];

type PickerTarget =
  | { kind: "new" }
  | { kind: "rebind"; id: string };

type RegionData = { x: number; y: number; width: number; height: number };

type Draft = {
  id: string,
  isNew: boolean,
  method: ShortcutMethod,
  keys: ShortcutKeys,
  overrides: CaptureOverrides,
};

type DefaultValues = { [K in OverrideKey]: NonNullable<CaptureOverrides[K]> };

const DEFAULT_FILE_NAME_TEMPLATE = "${process}_${random:10}";

const METHOD_LABELS: Record<MethodType, string> = {
  screenshot: "Take screenshot",
  instantCapture: "Instant capture",
  record: "Start or stop recording",
  scrollingCapture: "Scrolling capture",
};

const METHOD_HINTS: Record<Exclude<MethodType, "instantCapture">, string> = {
  screenshot: "Freezes the screen and opens the editor.",
  record: "Opens the region picker when idle, stops and saves while recording.",
  scrollingCapture: "Scrolls and captures the selection, then opens the result.",
};

const METHOD_ITEMS: SelectItem<MethodType>[] = (Object.keys(METHOD_LABELS) as MethodType[])
  .map(type => ({ id: type, value: type, label: METHOD_LABELS[type] }));

const FORMAT_ITEMS: SelectItem<ScreenshotImageFormat>[] = SCREENSHOT_FORMATS
  .map(format => ({ id: format, value: format, label: SCREENSHOT_FORMAT_LABELS[format] }));

const SKIP_UPLOAD_ID = "skip";

function soundPlays(setting: SoundSetting, isInstant: boolean): boolean {
  return setting.enabled && (!isInstant || setting.instantCaptureEnabled);
}

function onOff(value: boolean): string {
  return value ? "On" : "Off";
}

function describeDistance(distance: ScrollDistance): string {
  return distance.type === "percent" ? `${distance.data}% of the selection` : `${distance.data} px`;
}

function describeUpload(upload: UploadOverride, uploaders: SavedUploader[]): string {
  if (upload.type === "skip") return "Don't upload";
  const uploader = uploaders.find(u => u.id === upload.data);
  return uploader ? `Upload with ${uploader.name}` : "Uploader no longer exists";
}

function describeDefaults(values: DefaultValues, uploaders: SavedUploader[]): Record<OverrideKey, string> {
  return {
    copyToClipboard: onOff(values.copyToClipboard),
    showCapturePreview: onOff(values.showCapturePreview),
    captureSound: onOff(values.captureSound),
    uploadSound: onOff(values.uploadSound),
    upload: describeUpload(values.upload, uploaders),
    fileNameTemplate: values.fileNameTemplate,
    savePathTemplate: values.savePathTemplate || "The files folder itself",
    screenshotFormat: SCREENSHOT_FORMAT_LABELS[values.screenshotFormat],
    includeCursor: onOff(values.includeCursor),
    recordAudio: onOff(values.recordAudio),
    recordFps: `${values.recordFps} fps`,
    recordCodec: CODEC_LABELS[values.recordCodec],
    recordBitrateMbps: `${values.recordBitrateMbps} Mbit/s`,
    recordBitrateMode: BITRATE_MODE_LABELS[values.recordBitrateMode],
    scrollMaxFrames: `${values.scrollMaxFrames} frames`,
    scrollFrameDelayMs: `${values.scrollFrameDelayMs} ms`,
    scrollDistance: describeDistance(values.scrollDistance),
  };
}

function ShortcutSettings() {
  const { shortcuts, addShortcut, removeShortcut } = useSettingsState;
  const { pushToast } = useToastState;
  const { markSettingsSaved } = useSettingsSavedState;

  const [monitors, setMonitors] = createSignal<MonitorInfo[]>([]);
  const [general, setGeneral] = createSignal<GeneralSettings | null>(null);
  const [sounds, setSounds] = createSignal<SoundSettings | null>(null);
  const [scrolling, setScrolling] = createSignal<ScrollingCaptureSettings | null>(null);
  const [previewEnabled, setPreviewEnabled] = createSignal<boolean | null>(null);
  const [uploaders, setUploaders] = createSignal<SavedUploader[]>([]);
  const [defaultUploaderId, setDefaultUploaderId] = createSignal<string | null>(null);
  const [codecs, setCodecs] = createSignal<VideoCodec[]>(["h264"]);

  const [picker, setPicker] = createSignal<PickerTarget | null>(null);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [pendingNew, setPendingNew] = createSignal<ShortcutBinding | null>(null);
  const [draft, setDraft] = createStore<Draft>({
    id: "",
    isNew: false,
    method: { type: "screenshot" },
    keys: { keys: [] },
    overrides: emptyOverrides(),
  });

  onMount(async () => {
    try {
      setMonitors(await safeInvoke("list_monitors"));
    } catch {
      // Monitor listing is best-effort; the region mode still works without it.
    }

    try {
      const [generalSettings, soundSettings, scrollingSettings, preview, savedUploaders, defaultId] = await Promise.all([
        safeInvoke("get_general_settings"),
        safeInvoke("get_sound_settings"),
        safeInvoke("get_scrolling_capture_settings"),
        safeInvoke("get_capture_preview_settings"),
        safeInvoke("get_uploaders"),
        safeInvoke("get_default_uploader"),
      ]);
      setGeneral(generalSettings);
      setSounds(soundSettings);
      setScrolling(scrollingSettings);
      setPreviewEnabled(preview.enabled);
      setUploaders(savedUploaders);
      setDefaultUploaderId(defaultId);
    } catch (error) {
      console.error("Failed to load the settings shortcuts can override", error);
    }

    try {
      setCodecs(await safeInvoke("get_available_video_codecs"));
    } catch (error) {
      console.error("Failed to load available video codecs", error);
    }
  });

  function run(action: () => Promise<any>) {
    return action()
      .then(markSettingsSaved)
      .catch(err => pushToast(`Could not update the shortcut: ${errorMessage(err)}`, "error", 6000));
  }

  function defaultTarget(): CaptureTarget {
    const first = monitors()[0];
    return first
      ? { type: "monitor", data: { id: first.id } }
      : { type: "region", data: { x: 0, y: 0, width: 100, height: 100 } };
  }

  function targetSummary(target: CaptureTarget): { title: string, detail: string } {
    if (target.type === "monitor") {
      const m = findMonitor(monitors(), target.data.id);
      return m
        ? { title: m.name, detail: `${m.width}×${m.height}, whole monitor` }
        : { title: target.data.id || "No monitor chosen", detail: "Monitor not connected" };
    }
    return { title: "Region", detail: `${target.data.width}×${target.data.height} at (${target.data.x}, ${target.data.y})` };
  }

  function cloneBinding(binding: ShortcutBinding): ShortcutBinding {
    return structuredClone(unwrap(binding));
  }

  function openNew() {
    setDraft({ id: crypto.randomUUID(), isNew: true, method: { type: "screenshot" }, keys: { keys: [] }, overrides: emptyOverrides() });
    setEditorOpen(true);
  }

  function openEditor(binding: ShortcutBinding) {
    const copy = cloneBinding(binding);
    if (copy.method.type === "instantCapture" && copy.method.data.type === "monitor") {
      copy.method.data.data.id = findMonitor(monitors(), copy.method.data.data.id)?.id ?? copy.method.data.data.id;
    }
    setDraft({ id: copy.id, isNew: false, method: copy.method, keys: copy.keys, overrides: copy.overrides });
    setEditorOpen(true);
  }

  // Reconciled, not merged: a merge would leave an instant capture's `data` on a screenshot method.
  function setMethod(type: MethodType) {
    if (type === draft.method.type) return;
    const method: ShortcutMethod = type === "instantCapture" ? { type, data: defaultTarget() } : { type };
    setDraft("method", reconcile(method));
  }

  function setOverride<K extends OverrideKey>(key: K, value: CaptureOverrides[K]) {
    setDraft("overrides", produce(overrides => { overrides[key] = value; }));
  }

  function saveDraft() {
    const binding: ShortcutBinding = {
      id: draft.id,
      method: structuredClone(unwrap(draft.method)),
      keys: structuredClone(unwrap(draft.keys)),
      overrides: structuredClone(keepOverrides(unwrap(draft.overrides), OVERRIDE_KEYS[draft.method.type])),
    };
    setEditorOpen(false);

    if (draft.isNew) {
      setPendingNew(binding);
      setPicker({ kind: "new" });
    } else {
      run(() => addShortcut(binding));
    }
  }

  function onPickerConfirm(keys: ShortcutKeys) {
    const p = picker();
    setPicker(null);
    if (!p) return;

    if (p.kind === "new") {
      const binding = pendingNew();
      setPendingNew(null);
      if (binding) run(() => addShortcut({ ...binding, keys }));
      return;
    }

    const binding = shortcuts.find(s => s.id === p.id);
    if (binding) run(() => addShortcut({ ...cloneBinding(binding), keys }));
  }

  function onPickerHide() {
    setPicker(null);
    setPendingNew(null);
  }

  const pickerExcludeId = createMemo(() => {
    const p = picker();
    return p?.kind === "rebind" ? p.id : undefined;
  });

  const draftTarget = createMemo(() => draft.method.type === "instantCapture" ? draft.method.data : null);
  const region = createMemo<RegionData>(() => {
    const target = draftTarget();
    return target?.type === "region" ? target.data : { x: 0, y: 0, width: 0, height: 0 };
  });
  const monitorItems = createMemo(() =>
    monitors().map(m => ({ id: m.id, value: m, label: `${m.name}, ${m.width}×${m.height}` }))
  );
  const monitorId = createMemo(() => {
    const target = draftTarget();
    return target?.type === "monitor" ? target.data.id : "";
  });

  function setTarget(target: CaptureTarget) {
    const method: ShortcutMethod = { type: "instantCapture", data: target };
    setDraft("method", reconcile(method));
  }

  function switchToMonitor() {
    if (draftTarget()?.type === "monitor") return;
    setTarget({ type: "monitor", data: { id: monitors()[0]?.id ?? "" } });
  }

  function switchToRegion() {
    if (draftTarget()?.type === "region") return;
    setTarget({ type: "region", data: { x: 0, y: 0, width: 100, height: 100 } });
  }

  function setRegionField(field: keyof RegionData, value: number) {
    setTarget({ type: "region", data: { ...region(), [field]: Number.isFinite(value) ? value : 0 } });
  }

  async function selectRegion() {
    try {
      const unlisten = await listen<RegionData | null>("region-pick://result", event => {
        unlisten();
        if (event.payload) setTarget({ type: "region", data: event.payload });
      });
      await safeInvoke("start_region_pick");
    } catch (err) {
      pushToast(`Could not start region selection: ${errorMessage(err)}`, "error", 6000);
    }
  }

  const relevant = createMemo(() => new Set(OVERRIDE_KEYS[draft.method.type]));

  const defaultValues = createMemo<DefaultValues | null>(() => {
    const generalSettings = general();
    const soundSettings = sounds();
    const scrollingSettings = scrolling();
    const preview = previewEnabled();
    if (!generalSettings || !soundSettings || !scrollingSettings || preview === null) return null;

    const isInstant = draft.method.type === "instantCapture";
    const autoUploader = uploaders().find(u => u.id === defaultUploaderId() && u.autoUpload);

    return {
      copyToClipboard: generalSettings.copyToClipboardOnCapture,
      showCapturePreview: preview,
      captureSound: soundPlays(soundSettings.capture, isInstant),
      uploadSound: soundPlays(soundSettings.taskSuccess, isInstant),
      upload: autoUploader ? { type: "uploader", data: autoUploader.id } : { type: "skip" },
      fileNameTemplate: generalSettings.fileNameTemplate ?? DEFAULT_FILE_NAME_TEMPLATE,
      savePathTemplate: generalSettings.uploadPath ?? "",
      screenshotFormat: generalSettings.screenshotFormat,
      includeCursor: generalSettings.includeCursor,
      recordAudio: generalSettings.recordAudio,
      recordFps: generalSettings.recordFps,
      recordCodec: generalSettings.recordCodec,
      recordBitrateMbps: generalSettings.recordBitrateMbps,
      recordBitrateMode: generalSettings.recordBitrateMode,
      scrollMaxFrames: scrollingSettings.maxFrames,
      scrollFrameDelayMs: scrollingSettings.frameDelayMs,
      scrollDistance: scrollingSettings.scrollDistance,
    };
  });

  const defaultTexts = createMemo(() => {
    const values = defaultValues();
    return values ? describeDefaults(values, uploaders()) : null;
  });

  const uploadItems = createMemo<SelectItem<UploadOverride>[]>(() => [
    { id: SKIP_UPLOAD_ID, value: { type: "skip" }, label: "Don't upload" },
    ...uploaders().map(u => ({ id: u.id, value: { type: "uploader", data: u.id } as UploadOverride, label: `Upload with ${u.name}` })),
  ]);
  const uploadValue = createMemo(() => {
    const upload = draft.overrides.upload;
    return !upload || upload.type === "skip" ? SKIP_UPLOAD_ID : upload.data;
  });

  const codecItems = createMemo<SelectItem<VideoCodec>[]>(() => {
    const chosen = draft.overrides.recordCodec;
    const available = chosen && !codecs().includes(chosen) ? [...codecs(), chosen] : codecs();
    return available.map(codec => ({ id: codec, value: codec, label: CODEC_LABELS[codec] }));
  });

  const templatesValid = createMemo(() =>
    !hasBadTokens(draft.overrides.fileNameTemplate ?? "", FILE_NAME_VARIABLES) &&
    !hasBadTokens(draft.overrides.savePathTemplate ?? "", SAVE_PATH_VARIABLES)
  );
  const targetValid = createMemo(() => {
    const target = draftTarget();
    return !target || target.type !== "monitor" || target.data.id !== "";
  });
  const canSave = createMemo(() => templatesValid() && targetValid());
  const editorTitle = createMemo(() => draft.isNew ? "New shortcut" : "Edit shortcut");

  function KeyButton(props: { keys: ShortcutKeys | undefined, onClick: () => void }) {
    const hasKeys = createMemo(() => (props.keys?.keys.length ?? 0) > 0);
    return (
      <button type="button" class={styles.KeyButton} onClick={() => props.onClick()}>
        <Show when={hasKeys()} fallback={<span class={styles.Placeholder}>Click to set</span>}>
          <KeyRenderer keys={props.keys!} />
        </Show>
      </button>
    );
  }

  function MethodIcon(props: { method: ShortcutMethod }) {
    return <>
      <Show when={props.method.type === "screenshot"}><Camera size={14} /></Show>
      <Show when={props.method.type === "record"}><Video size={14} /></Show>
      <Show when={props.method.type === "scrollingCapture"}><ScrollText size={14} /></Show>
      <Show when={props.method.type === "instantCapture" && props.method.data.type === "monitor"}><Monitor size={14} /></Show>
      <Show when={props.method.type === "instantCapture" && props.method.data.type === "region"}><Crop size={14} /></Show>
    </>;
  }

  function ShortcutRow(props: { binding: ShortcutBinding }) {
    const summary = createMemo(() => {
      const method = props.binding.method;
      if (method.type !== "instantCapture") return { title: METHOD_LABELS[method.type], detail: METHOD_HINTS[method.type] };
      const target = targetSummary(method.data);
      return { title: `${METHOD_LABELS.instantCapture}, ${target.title}`, detail: target.detail };
    });
    const overrides = createMemo(() => overrideCount(props.binding.overrides));

    return (
      <div class={styles.ListRow}>
        <KeyButton keys={props.binding.keys} onClick={() => setPicker({ kind: "rebind", id: props.binding.id })} />
        <div class={styles.Info}>
          <b>
            <MethodIcon method={props.binding.method} />
            {summary().title}
            <Show when={overrides() > 0}>
              <Badge tone="accent">{overrides() === 1 ? "1 override" : `${overrides()} overrides`}</Badge>
            </Show>
          </b>
          <span>{summary().detail}</span>
        </div>
        <div class={styles.Actions}>
          <Button size="sm" variant="ghost" onClick={() => openEditor(props.binding)}>Edit</Button>
          <Button isIcon size="sm" variant="danger" tooltip="Delete" onClick={() => run(() => removeShortcut(props.binding.id))}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    );
  }

  // Shows the default until overridden, then the control seeded with that default.
  function OverrideRow(props: { field: OverrideKey, label: string, hint?: string, stack?: boolean, children: JSX.Element }) {
    const overridden = createMemo(() => draft.overrides[props.field] !== null);
    const stacked = createMemo(() => overridden() && (props.stack ?? false));
    const defaultText = createMemo(() => defaultTexts()?.[props.field] ?? "Loading…");

    function override() {
      const values = defaultValues();
      if (values) setOverride(props.field, structuredClone(values[props.field]));
    }

    return (
      <Show when={relevant().has(props.field)}>
        <SettingRow label={props.label} hint={props.hint} stack={stacked()}>
          <Show
            when={overridden()}
            fallback={
              <InlineControls>
                <span class={styles.DefaultValue} title={defaultText()}>{defaultText()}</span>
                <Button size="sm" variant="ghost" disabled={!defaultValues()} onClick={override}>Override</Button>
              </InlineControls>
            }
          >
            <InlineControls grow={props.stack}>
              {props.children}
              <Button isIcon size="sm" variant="ghost" tooltip="Use the default" onClick={() => setOverride(props.field, null)}>
                <RotateCcw size={14} />
              </Button>
            </InlineControls>
          </Show>
        </SettingRow>
      </Show>
    );
  }

  const showCaptureGroup = createMemo(() => relevant().has("includeCursor"));
  const showRecordingGroup = createMemo(() => relevant().has("recordAudio"));
  const showScrollingGroup = createMemo(() => relevant().has("scrollMaxFrames"));

  return <SettingsPage title="Shortcuts" description="Global keys that work from any app. Each one can override settings for its own captures.">
    <SettingsGroup
      title="All shortcuts"
      right={<Button size="sm" onClick={openNew}><Plus size={14} />Add shortcut</Button>}
    >
      <For each={shortcuts} fallback={
        <SettingRow label="No shortcuts yet" hint="Add one to take screenshots, record or capture a fixed area from any app." />
      }>
        {binding => <ShortcutRow binding={binding} />}
      </For>
    </SettingsGroup>

    <ShortcutPicker
      preRegisteredShortcuts={shortcuts.filter(s => s.id !== pickerExcludeId()).map(s => s.keys)}
      show={picker() !== null}
      onHide={onPickerHide}
      onConfirm={onPickerConfirm}
    />

    <Modal
      title={editorTitle()}
      width={640}
      show={editorOpen()}
      onHide={() => setEditorOpen(false)}
      footer={<>
        <Button onClick={() => setEditorOpen(false)}>Cancel</Button>
        <Button variant="primary" disabled={!canSave()} onClick={saveDraft}>{draft.isNew ? "Next: pick keys" : "Save"}</Button>
      </>}
    >
      <div class={styles.Editor}>
        <SettingsGroup title="Action">
          <SettingRow label="When pressed">
            <Select class={styles.WideSelect} value={draft.method.type} items={METHOD_ITEMS} onItemClick={item => setMethod(item.value)} />
          </SettingRow>

          <Show when={draftTarget()}>
            {target => (
              <SettingRow stack label="Capture target">
                <div class={styles.TargetEditor}>
                  <Segmented
                    items={[
                      { id: "monitor", label: <><Monitor size={14} />Monitor</> },
                      { id: "region", label: <><Crop size={14} />Region</> },
                    ]}
                    value={target().type}
                    onChange={type => type === "monitor" ? switchToMonitor() : switchToRegion()}
                  />

                  <Show when={target().type === "monitor"}>
                    <Select
                      items={monitorItems()}
                      value={monitorId()}
                      placeholder={monitorItems().length ? "Select a monitor" : "No monitors found"}
                      onItemClick={item => setTarget({ type: "monitor", data: { id: String(item.id) } })}
                    />
                  </Show>

                  <Show when={target().type === "region"}>
                    <div class={styles.RegionFields}>
                      <label>X<NumberField width="100%" min={-100_000} max={100_000} value={region().x} onChange={value => setRegionField("x", value)} /></label>
                      <label>Y<NumberField width="100%" min={-100_000} max={100_000} value={region().y} onChange={value => setRegionField("y", value)} /></label>
                      <label>Width<NumberField width="100%" min={1} max={100_000} value={region().width} onChange={value => setRegionField("width", value)} /></label>
                      <label>Height<NumberField width="100%" min={1} max={100_000} value={region().height} onChange={value => setRegionField("height", value)} /></label>
                    </div>
                    <Button class={styles.SelectRegion} onClick={selectRegion}>
                      <Crop size={15} />Select region on screen
                    </Button>
                  </Show>
                </div>
              </SettingRow>
            )}
          </Show>
        </SettingsGroup>

        <SettingsGroup title="After saving">
          <OverrideRow field="copyToClipboard" label="Copy to the clipboard">
            <Switch checked={draft.overrides.copyToClipboard!} onChange={value => setOverride("copyToClipboard", value)} />
          </OverrideRow>
          <OverrideRow field="showCapturePreview" label="Show the capture preview">
            <Switch checked={draft.overrides.showCapturePreview!} onChange={value => setOverride("showCapturePreview", value)} />
          </OverrideRow>
          <OverrideRow field="upload" label="Upload">
            <Select class={styles.WideSelect} value={uploadValue()} items={uploadItems()} onItemClick={item => setOverride("upload", item.value)} />
          </OverrideRow>
        </SettingsGroup>

        <SettingsGroup title="Sounds">
          <OverrideRow field="captureSound" label="Capture sound" hint="Plays when the capture is saved.">
            <Switch checked={draft.overrides.captureSound!} onChange={value => setOverride("captureSound", value)} />
          </OverrideRow>
          <OverrideRow field="uploadSound" label="Upload sound" hint="Plays when the upload finishes.">
            <Switch checked={draft.overrides.uploadSound!} onChange={value => setOverride("uploadSound", value)} />
          </OverrideRow>
        </SettingsGroup>

        <SettingsGroup title="Files">
          <OverrideRow field="savePathTemplate" label="Save path template" hint="Sub-folder under files/. Type $ for variables." stack>
            <TemplateInput
              value={draft.overrides.savePathTemplate!}
              placeholder="${year}-${month}"
              variables={SAVE_PATH_VARIABLES}
              onChange={value => setOverride("savePathTemplate", value)}
            />
          </OverrideRow>
          <OverrideRow field="fileNameTemplate" label="File name template" hint="The extension is added for you. Type $ for variables." stack>
            <TemplateInput
              value={draft.overrides.fileNameTemplate!}
              placeholder={DEFAULT_FILE_NAME_TEMPLATE}
              variables={FILE_NAME_VARIABLES}
              onChange={value => setOverride("fileNameTemplate", value)}
            />
          </OverrideRow>
          <OverrideRow field="screenshotFormat" label="Screenshot format">
            <Select value={draft.overrides.screenshotFormat!} items={FORMAT_ITEMS} onItemClick={item => setOverride("screenshotFormat", item.value)} />
          </OverrideRow>
        </SettingsGroup>

        <Show when={showCaptureGroup()}>
          <SettingsGroup title="Capture">
            <OverrideRow field="includeCursor" label="Include the mouse cursor">
              <Switch checked={draft.overrides.includeCursor!} onChange={value => setOverride("includeCursor", value)} />
            </OverrideRow>
          </SettingsGroup>
        </Show>

        <Show when={showRecordingGroup()}>
          <SettingsGroup title="Recording">
            <OverrideRow field="recordAudio" label="Record system audio">
              <Switch checked={draft.overrides.recordAudio!} onChange={value => setOverride("recordAudio", value)} />
            </OverrideRow>
            <OverrideRow field="recordFps" label="Frame rate">
              <NumberField value={draft.overrides.recordFps!} min={1} max={240} unit="fps" width={100} onChange={value => setOverride("recordFps", value)} />
            </OverrideRow>
            <OverrideRow field="recordCodec" label="Video codec">
              <Select value={draft.overrides.recordCodec!} items={codecItems()} onItemClick={item => setOverride("recordCodec", item.value)} />
            </OverrideRow>
            <OverrideRow field="recordBitrateMode" label="Bitrate mode">
              <Select value={draft.overrides.recordBitrateMode!} items={BITRATE_MODE_ITEMS} onItemClick={item => setOverride("recordBitrateMode", item.value)} />
            </OverrideRow>
            <OverrideRow field="recordBitrateMbps" label="Bitrate">
              <NumberField value={draft.overrides.recordBitrateMbps!} min={1} max={200} unit="Mbit/s" width={120} onChange={value => setOverride("recordBitrateMbps", value)} />
            </OverrideRow>
          </SettingsGroup>
        </Show>

        <Show when={showScrollingGroup()}>
          <SettingsGroup title="Scrolling capture">
            <OverrideRow field="scrollFrameDelayMs" label="Delay between frames">
              <DurationField
                parts={["s", "ms"]}
                valueMs={draft.overrides.scrollFrameDelayMs!}
                onChange={ms => setOverride("scrollFrameDelayMs", Math.max(50, ms))}
              />
            </OverrideRow>
            <OverrideRow field="scrollDistance" label="Scroll amount">
              <ScrollDistanceInput value={draft.overrides.scrollDistance!} onChange={value => setOverride("scrollDistance", value)} />
            </OverrideRow>
            <OverrideRow field="scrollMaxFrames" label="Maximum frames">
              <NumberField value={draft.overrides.scrollMaxFrames!} min={2} max={1000} width={100} unit="frames" onChange={value => setOverride("scrollMaxFrames", value)} />
            </OverrideRow>
          </SettingsGroup>
        </Show>
      </div>
    </Modal>
  </SettingsPage>
}

export default ShortcutSettings;
