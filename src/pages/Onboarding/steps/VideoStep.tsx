import settingsStyles from "../../Settings/GeneralSettings/GeneralSettings.module.scss";
import { createMemo, createSignal, onMount } from "solid-js";
import Input from "@core/components/Input/Input";
import Button from "@core/components/Button/Button";
import Select from "@core/components/Select/Select";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { GeneralSettings as GeneralSettingsData, SelectItem, VideoCodec } from "@core/types";
import { CODEC_LABELS } from "@core/helpers/settingsLabels";

function VideoStep(props: { general: GeneralSettingsData, onChange: (update: Partial<GeneralSettingsData>) => void }) {
  const [availableCodecs, setAvailableCodecs] = createSignal<VideoCodec[]>(["h264"]);
  const [fpsInput, setFpsInput] = createSignal(String(props.general.recordFps));

  onMount(async () => {
    try {
      const codecs = await safeInvoke("get_available_video_codecs");
      setAvailableCodecs(codecs.includes(props.general.recordCodec) ? codecs : [...codecs, props.general.recordCodec]);
    } catch (error) {
      console.error("Failed to load available video codecs", error);
    }
  });

  const codecItems = createMemo<SelectItem<VideoCodec>[]>(() =>
    availableCodecs().map(codec => ({ id: codec, value: codec, label: CODEC_LABELS[codec] }))
  );

  function normalizedFps(): number {
    const parsed = Math.round(Number(fpsInput()));
    return Number.isFinite(parsed) ? Math.min(240, Math.max(1, parsed)) : props.general.recordFps;
  }

  return <div class={settingsStyles.GeneralSettings}>
    <label class={settingsStyles.SettingRow}>
      <input
        type="checkbox"
        checked={props.general.recordAudio}
        onChange={e => props.onChange({ recordAudio: e.currentTarget.checked })}
      />
      <div class={settingsStyles.SettingText}>
        <span>Record system audio</span>
        <span class={settingsStyles.Hint}>Screen recordings include what you hear (speaker output).</span>
      </div>
    </label>
    <div class={settingsStyles.SettingRow}>
      <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
        <span>Recording video codec</span>
        <span class={settingsStyles.Hint}>Only codecs the current GPU/drivers can actually initialize are listed. Default: H.264.</span>
        <Select value={props.general.recordCodec} items={codecItems()} onItemClick={item => props.onChange({ recordCodec: item.value })} />
      </div>
    </div>
    <div class={settingsStyles.SettingRow}>
      <div class={settingsStyles.SettingText} style={{ width: '100%' }}>
        <span>Recording frame rate</span>
        <span class={settingsStyles.Hint}>Frames per second for screen recordings (1–240). Default: 30.</span>
        <div class={settingsStyles.DirectoryRow}>
          <Input
            type="number"
            min={1}
            max={240}
            value={fpsInput()}
            style={{ width: '110px' }}
            onChange={e => setFpsInput(e.currentTarget.value)}
          />
          <Button
            disabled={normalizedFps() === props.general.recordFps}
            onClick={() => {
              setFpsInput(String(normalizedFps()));
              props.onChange({ recordFps: normalizedFps() });
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  </div>
}

export default VideoStep;
