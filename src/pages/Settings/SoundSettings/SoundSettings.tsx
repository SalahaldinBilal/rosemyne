import styles from "./SoundSettings.module.scss";
import { For, Show, createMemo, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { open } from "@tauri-apps/plugin-dialog";
import Button from "@core/components/Button/Button";
import Switch from "@core/components/Switch/Switch";
import Checkbox from "@core/components/Checkbox/Checkbox";
import useSettingsSavedState from "@core/states/settingsSavedState";
import { SettingsGroup, SettingsPage } from "../SettingsLayout/SettingsLayout";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import { SoundKind, SoundSettings as SoundSettingsData } from "@core/types";
import { FolderOpen, Play, RotateCcw } from "lucide-solid";
import useToastState from "@core/states/toastState";

const SOUND_ROWS: Array<{ kind: SoundKind, title: string, hint: string, instantHint: string }> = [
  {
    kind: "capture",
    title: "Screenshot captured",
    hint: "Plays right after a screenshot is saved to history.",
    instantHint: "Play the capture sound when using an instant-capture shortcut.",
  },
  {
    kind: "taskSuccess",
    title: "Task finished successfully",
    hint: "Plays when a background task completes.",
    instantHint: "Play the task-finished sound when an instant capture's auto-upload completes.",
  },
];

const AUDIO_EXTENSIONS = ["mp3", "wav", "flac", "ogg", "m4a", "aac", "weba", "webm"];
const VOLUME_SAVE_DEBOUNCE_MS = 200;

function SoundSettings() {
  const [settings, setSettings] = createStore<SoundSettingsData>({
    capture: { enabled: true, instantCaptureEnabled: true, customFile: null, volume: 100 },
    taskSuccess: { enabled: true, instantCaptureEnabled: true, customFile: null, volume: 80 },
  });
  const { pushToast } = useToastState;
  const { markSettingsSaved } = useSettingsSavedState;
  const volumeTimers: { [key in SoundKind]?: number } = {};

  onMount(async () => {
    setSettings(await safeInvoke("get_sound_settings"));
  });

  onCleanup(() => {
    for (const timer of Object.values(volumeTimers)) clearTimeout(timer);
  });

  async function toggleEnabled(kind: SoundKind, enabled: boolean) {
    setSettings(kind, "enabled", enabled);
    try {
      await safeInvoke("set_sound_enabled", { kind, enabled });
      markSettingsSaved();
    } catch (error) {
      pushToast(`Failed to update the setting: ${errorMessage(error)}`, "error", 6000);
    }
  }

  async function toggleInstantCaptureEnabled(kind: SoundKind, enabled: boolean) {
    setSettings(kind, "instantCaptureEnabled", enabled);
    try {
      await safeInvoke("set_instant_capture_sound_enabled", { kind, enabled });
      markSettingsSaved();
    } catch (error) {
      pushToast(`Failed to update the setting: ${errorMessage(error)}`, "error", 6000);
    }
  }

  function changeVolume(kind: SoundKind, volume: number) {
    setSettings(kind, "volume", volume);
    clearTimeout(volumeTimers[kind]);
    volumeTimers[kind] = window.setTimeout(async () => {
      try {
        await safeInvoke("set_sound_volume", { kind, volume });
        markSettingsSaved();
      } catch (error) {
        pushToast(`Failed to update the volume: ${errorMessage(error)}`, "error", 6000);
      }
    }, VOLUME_SAVE_DEBOUNCE_MS);
  }

  async function chooseFile(kind: SoundKind) {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (typeof picked !== "string") return;

    try {
      const setting = await safeInvoke("set_custom_sound", { kind, path: picked });
      setSettings(kind, setting);
      markSettingsSaved();
      await safeInvoke("preview_sound", { kind });
    } catch (error) {
      pushToast(`Failed to set the custom sound: ${errorMessage(error)}`, "error", 6000);
    }
  }

  async function resetFile(kind: SoundKind) {
    try {
      const setting = await safeInvoke("reset_custom_sound", { kind });
      setSettings(kind, setting);
      markSettingsSaved();
    } catch (error) {
      pushToast(`Failed to reset the sound: ${errorMessage(error)}`, "error", 6000);
    }
  }

  async function preview(kind: SoundKind) {
    try {
      await safeInvoke("preview_sound", { kind });
    } catch (error) {
      pushToast(`Failed to play the sound: ${errorMessage(error)}`, "error", 6000);
    }
  }

  return <SettingsPage title="Sounds" description="What plays after a capture or a task.">
    <SettingsGroup title="Sounds">
      <For each={SOUND_ROWS}>
        {row => {
          const setting = createMemo(() => settings[row.kind]);
          const fileLabel = createMemo(() => setting().customFile ?? "Default");
          return <div class={styles.Sound} classList={{ [styles.Off]: !setting().enabled }} data-setting={row.title}>
            <Switch label={row.title} checked={setting().enabled} onChange={enabled => toggleEnabled(row.kind, enabled)} />
            <div class={styles.Text}>
              <b title={row.hint}>{row.title}</b>
              <div class={styles.Meta}>
                <span class={styles.File} title={setting().customFile ?? undefined}>{fileLabel()}</span>
                <span class={styles.Instant} title={row.instantHint}>
                  <Checkbox
                    checked={setting().instantCaptureEnabled}
                    disabled={!setting().enabled}
                    onChange={enabled => toggleInstantCaptureEnabled(row.kind, enabled)}
                  >
                    Instant captures too
                  </Checkbox>
                </span>
              </div>
            </div>
            <div class={styles.Volume}>
              <input
                type="range"
                min="0"
                max="100"
                aria-label={`${row.title} volume`}
                value={setting().volume}
                style={{ "--fill": `${setting().volume}%` }}
                onInput={e => changeVolume(row.kind, e.currentTarget.valueAsNumber)}
              />
              <span>{setting().volume}%</span>
            </div>
            <div class={styles.Actions}>
              <Button isIcon size="sm" tooltip="Play" onClick={() => preview(row.kind)}>
                <Play size={15} />
              </Button>
              <Button isIcon size="sm" tooltip="Choose file" onClick={() => chooseFile(row.kind)}>
                <FolderOpen size={15} />
              </Button>
              <Show when={setting().customFile}>
                <Button isIcon size="sm" tooltip="Reset to default" onClick={() => resetFile(row.kind)}>
                  <RotateCcw size={14} />
                </Button>
              </Show>
            </div>
          </div>;
        }}
      </For>
    </SettingsGroup>
  </SettingsPage>
}

export default SoundSettings;
