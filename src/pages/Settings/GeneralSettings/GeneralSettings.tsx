import { Show, createMemo, createSignal, onMount } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import Input from "@core/components/Input/Input";
import Button from "@core/components/Button/Button";
import Select from "@core/components/Select/Select";
import Badge from "@core/components/Badge/Badge";
import NumberField from "@core/components/NumberField/NumberField";
import DimensionField from "@core/components/NumberField/DimensionField";
import TemplateInput from "@core/components/TemplateInput/TemplateInput";
import { hasBadTokens } from "@core/components/TemplateInput/templateTokens";
import { FILE_NAME_VARIABLES, SAVE_PATH_VARIABLES, TemplateVariable } from "@core/constants/templateVariables";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import { GeneralSettings as GeneralSettingsData, ScreenshotImageFormat, SelectItem, VideoCodec } from "@core/types";
import useToastState from "@core/states/toastState";
import useSettingsSavedState from "@core/states/settingsSavedState";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-solid";
import { BITRATE_MODE_ITEMS, CODEC_LABELS, SCREENSHOT_FORMAT_LABELS, SCREENSHOT_FORMATS } from "@core/helpers/settingsLabels";
import { InlineControls, SettingRow, SettingsGroup, SettingsPage, ToggleRow } from "../SettingsLayout/SettingsLayout";
import ContextMenuSettings from "./ContextMenuSettings";

const IS_WINDOWS = navigator.userAgent.includes("Windows");

function TemplateRow(props: {
  label: string,
  hint: string,
  value: string,
  saved: string | null,
  placeholder: string,
  variables: readonly TemplateVariable[],
  onChange: (value: string) => void,
  onApply: (value: string | null) => void,
}) {
  const normalized = createMemo(() => props.value.trim() || null);
  const canApply = createMemo(() => normalized() !== props.saved && !hasBadTokens(props.value, props.variables));

  return (
    <SettingRow stack label={props.label} hint={props.hint}>
      <InlineControls grow>
        <TemplateInput value={props.value} placeholder={props.placeholder} variables={props.variables} onChange={props.onChange} />
        <Button disabled={!canApply()} onClick={() => props.onApply(normalized())}>Apply</Button>
      </InlineControls>
    </SettingRow>
  );
}

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
    fitCardThumbnails: false,
  });
  const [availableCodecs, setAvailableCodecs] = createSignal<VideoCodec[]>(["h264"]);
  const [directoryInput, setDirectoryInput] = createSignal("");
  const [uploadPathInput, setUploadPathInput] = createSignal("");
  const [fileNameInput, setFileNameInput] = createSignal("");
  const [fps, setFps] = createSignal(30);
  const [bitrate, setBitrate] = createSignal(60);
  const [minSelection, setMinSelection] = createSignal({ width: 15, height: 15 });
  const { pushToast } = useToastState;
  const { markSettingsSaved } = useSettingsSavedState;

  function syncDrafts(from: GeneralSettingsData) {
    setDirectoryInput(from.saveDirectory ?? "");
    setUploadPathInput(from.uploadPath ?? "");
    setFileNameInput(from.fileNameTemplate ?? "");
    setFps(from.recordFps);
    setBitrate(from.recordBitrateMbps);
    setMinSelection({ width: from.minSelectionWidth, height: from.minSelectionHeight });
  }

  onMount(async () => {
    const saved = await safeInvoke("get_general_settings");
    setGeneral(reconcile(saved));
    syncDrafts(saved);

    // Only codecs the GPU can start are offered, plus the saved one even if the probe didn't confirm it.
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
      markSettingsSaved();
    } catch (error) {
      setGeneral(reconcile(previous));
      syncDrafts(previous);
      pushToast(errorMessage(error), "error", 6000);
    }
  }

  const minSelectionChanged = createMemo(() =>
    minSelection().width !== general.minSelectionWidth || minSelection().height !== general.minSelectionHeight,
  );
  const directoryChanged = createMemo(() => (directoryInput().trim() || null) !== general.saveDirectory);

  const bitrateHint = createMemo(() => general.recordBitrateMode === "constant"
    ? "Every recording uses this much, so files grow with length. 1 to 200 Mbit/s. Default 60."
    : "Busy recordings use about this much, calm ones far less. Higher looks better on busy content and makes bigger files. 1 to 200 Mbit/s. Default 60.");

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

  return <SettingsPage title="General" description="Capture behavior, files and startup.">
    <SettingsGroup title="Capture">
      <ToggleRow
        label="Copy screenshots to the clipboard"
        hint="Every saved screenshot is also put on the clipboard."
        checked={general.copyToClipboardOnCapture}
        onChange={checked => apply({ copyToClipboardOnCapture: checked })}
      />
      <ToggleRow
        label="Include the mouse cursor"
        hint="Adds the cursor as an overlay you can move, resize or delete before saving."
        checked={general.includeCursor}
        onChange={checked => apply({ includeCursor: checked })}
      />
      <Show when={IS_WINDOWS}>
        <ToggleRow
          label="Trim the window border when snapping"
          hint="Windows 11 draws a 1px border blended with what's behind a window. Turn off to keep it."
          checked={general.stripWindowBorder}
          onChange={checked => apply({ stripWindowBorder: checked })}
        />
      </Show>
      <SettingRow
        label="Minimum selection size"
        hint="Smaller drags count as a click and capture the window under the cursor. 0 keeps every drawn region. Default 15 × 15."
      >
        <InlineControls>
          <DimensionField value={minSelection()} max={1000} onChange={setMinSelection} />
          <Button disabled={!minSelectionChanged()} onClick={() => apply({ minSelectionWidth: minSelection().width, minSelectionHeight: minSelection().height })}>
            Apply
          </Button>
        </InlineControls>
      </SettingRow>
    </SettingsGroup>

    <SettingsGroup title="Recording">
      <ToggleRow
        label="Record system audio"
        hint="Recordings include what you hear. Applies when a recording starts."
        checked={general.recordAudio}
        onChange={checked => apply({ recordAudio: checked })}
      />
      <SettingRow label="Video codec" hint="Only codecs your GPU can start are listed. Default H.264.">
        <Select value={general.recordCodec} items={codecItems()} onItemClick={item => apply({ recordCodec: item.value })} />
      </SettingRow>
      <SettingRow label="Frame rate" hint="1 to 240 fps. Default 30.">
        <InlineControls>
          <NumberField value={fps()} min={1} max={240} unit="fps" width={100} onChange={setFps} />
          <Button disabled={fps() === general.recordFps} onClick={() => apply({ recordFps: fps() })}>Apply</Button>
        </InlineControls>
      </SettingRow>
      <SettingRow label="Bitrate mode" hint="Variable spends less on calm recordings. Constant always uses the full bitrate, for GPUs that can't record with Variable. Default Variable.">
        <Select value={general.recordBitrateMode} items={BITRATE_MODE_ITEMS} onItemClick={item => apply({ recordBitrateMode: item.value })} />
      </SettingRow>
      <SettingRow label="Bitrate" hint={bitrateHint()}>
        <InlineControls>
          <NumberField value={bitrate()} min={1} max={200} unit="Mbit/s" width={120} onChange={setBitrate} />
          <Button disabled={bitrate() === general.recordBitrateMbps} onClick={() => apply({ recordBitrateMbps: bitrate() })}>Apply</Button>
        </InlineControls>
      </SettingRow>
    </SettingsGroup>

    <SettingsGroup title="Files">
      <SettingRow label="Screenshot format" hint="Default WebP.">
        <Select value={general.screenshotFormat} items={formatItems()} onItemClick={item => apply({ screenshotFormat: item.value })} />
      </SettingRow>
      <SettingRow stack label="Save directory" hint="Where captures, history and settings live. Existing files are not moved.">
        <InlineControls grow>
          <Input
            mono
            value={directoryInput()}
            placeholder="Documents\Rosemyne (default)"
            onChange={event => setDirectoryInput(event.currentTarget.value)}
          />
          <Button isIcon tooltip="Browse" onClick={browseDirectory}><FolderOpen size={16} /></Button>
          <Button disabled={!directoryChanged()} onClick={() => apply({ saveDirectory: directoryInput().trim() || null })}>Apply</Button>
        </InlineControls>
      </SettingRow>
      <TemplateRow
        label="Save path template"
        hint="Sub-folder under files/. Type $ for variables. Default ${year}-${month}."
        value={uploadPathInput()}
        saved={general.uploadPath}
        placeholder="${year}-${month}"
        variables={SAVE_PATH_VARIABLES}
        onChange={setUploadPathInput}
        onApply={value => apply({ uploadPath: value })}
      />
      <TemplateRow
        label="File name template"
        hint="The extension is added for you. Type $ for variables. Default ${process}_${random:10}."
        value={fileNameInput()}
        saved={general.fileNameTemplate}
        placeholder="${process}_${random:10}"
        variables={FILE_NAME_VARIABLES}
        onChange={setFileNameInput}
        onApply={value => apply({ fileNameTemplate: value })}
      />
    </SettingsGroup>

    <SettingsGroup title="History">
      <ToggleRow
        label="Show whole images on cards"
        hint="Shrinks each image to fit its card, with bars around it, instead of cropping it to fill the card."
        checked={general.fitCardThumbnails}
        onChange={checked => apply({ fitCardThumbnails: checked })}
      />
    </SettingsGroup>

    <SettingsGroup title="Startup">
      <ToggleRow
        label="Start with Windows"
        hint="Launch Rosemyne in the tray when you log in."
        checked={general.autostart}
        onChange={checked => apply({ autostart: checked })}
      />
      <ToggleRow
        label="Check for updates on startup"
        hint="You get a notification when a new version is out."
        checked={general.checkForUpdatesOnStartup}
        onChange={checked => apply({ checkForUpdatesOnStartup: checked })}
      />
    </SettingsGroup>

    <SettingsGroup title="Context menu" right={<Show when={IS_WINDOWS}><Badge>Windows</Badge></Show>}>
      <ContextMenuSettings />
    </SettingsGroup>
  </SettingsPage>;
}

export default GeneralSettings;
