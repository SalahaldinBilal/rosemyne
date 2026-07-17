import styles from "./SoundSettings.module.scss";
import { For, Show, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { open } from "@tauri-apps/plugin-dialog";
import Button from "@core/components/Button/Button";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { SoundKind, SoundSettings as SoundSettingsData } from "@core/types";
import { FolderOpen, Play, RotateCcw } from "lucide-solid";
import useToastState from "@core/states/toastState";

const SOUND_ROWS: Array<{ kind: SoundKind, title: string, hint: string }> = [
  { kind: "capture", title: "Screenshot captured", hint: "Plays right after a screenshot is saved to history." },
  { kind: "taskSuccess", title: "Task finished successfully", hint: "Plays when a background task completes." },
];

const AUDIO_EXTENSIONS = ["mp3", "wav", "flac", "ogg", "m4a", "aac", "weba", "webm"];
const VOLUME_SAVE_DEBOUNCE_MS = 200;

function SoundSettings() {
  const [settings, setSettings] = createStore<SoundSettingsData>({
    capture: { enabled: true, customFile: null, volume: 100 },
    taskSuccess: { enabled: true, customFile: null, volume: 80 },
  });
  const { pushToast } = useToastState;
  const volumeTimers: { [key in SoundKind]?: number } = {};

  onMount(async () => {
    setSettings(await safeInvoke("get_sound_settings"));
  });

  onCleanup(() => {
    for (const timer of Object.values(volumeTimers)) clearTimeout(timer);
  });

  function errorText(error: unknown): string {
    return typeof error === "string" ? error : JSON.stringify(error);
  }

  async function toggleEnabled(kind: SoundKind, enabled: boolean) {
    setSettings(kind, "enabled", enabled);
    try {
      await safeInvoke("set_sound_enabled", { kind, enabled });
    } catch (error) {
      pushToast(`Failed to update the setting: ${errorText(error)}`, "error", 6000);
    }
  }

  function changeVolume(kind: SoundKind, volume: number) {
    setSettings(kind, "volume", volume);
    clearTimeout(volumeTimers[kind]);
    volumeTimers[kind] = window.setTimeout(async () => {
      try {
        await safeInvoke("set_sound_volume", { kind, volume });
      } catch (error) {
        pushToast(`Failed to update the volume: ${errorText(error)}`, "error", 6000);
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
      await safeInvoke("preview_sound", { kind });
    } catch (error) {
      pushToast(`Failed to set the custom sound: ${errorText(error)}`, "error", 6000);
    }
  }

  async function resetFile(kind: SoundKind) {
    try {
      const setting = await safeInvoke("reset_custom_sound", { kind });
      setSettings(kind, setting);
    } catch (error) {
      pushToast(`Failed to reset the sound: ${errorText(error)}`, "error", 6000);
    }
  }

  async function preview(kind: SoundKind) {
    try {
      await safeInvoke("preview_sound", { kind });
    } catch (error) {
      pushToast(`Failed to play the sound: ${errorText(error)}`, "error", 6000);
    }
  }

  return <div class={styles.SoundSettings}>
    <For each={SOUND_ROWS}>
      {row => <div class={styles.SoundRow}>
        <div class={styles.SoundHeader}>
          <label class={styles.SettingRow}>
            <input
              type="checkbox"
              checked={settings[row.kind].enabled}
              onChange={e => toggleEnabled(row.kind, e.currentTarget.checked)}
            />
            <div class={styles.SettingText}>
              <span>{row.title}</span>
              <span class={styles.Hint}>{row.hint}</span>
            </div>
          </label>
          <div class={styles.SoundControls}>
            <span class={styles.FileLabel} title={settings[row.kind].customFile ?? undefined}>
              {settings[row.kind].customFile ?? "Default"}
            </span>
            <Button isIcon tooltip="Preview" onClick={() => preview(row.kind)}>
              <Play size={16} />
            </Button>
            <Button isIcon tooltip="Choose file…" onClick={() => chooseFile(row.kind)}>
              <FolderOpen size={16} />
            </Button>
            <Show when={settings[row.kind].customFile}>
              <Button isIcon tooltip="Reset to default" onClick={() => resetFile(row.kind)}>
                <RotateCcw size={16} />
              </Button>
            </Show>
          </div>
        </div>
        <div class={styles.VolumeRow}>
          <span class={styles.VolumeLabel}>Volume</span>
          <input
            type="range"
            min="0"
            max="100"
            value={settings[row.kind].volume}
            onInput={e => changeVolume(row.kind, e.currentTarget.valueAsNumber)}
          />
          <span class={styles.VolumeValue}>{settings[row.kind].volume}%</span>
        </div>
      </div>}
    </For>
  </div>
}

export default SoundSettings;
