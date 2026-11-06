import { createMemo, createSignal, onMount } from "solid-js";
import Button from "@core/components/Button/Button";
import Select from "@core/components/Select/Select";
import NumberField from "@core/components/NumberField/NumberField";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { GeneralSettings as GeneralSettingsData, SelectItem, VideoCodec } from "@core/types";
import { CODEC_LABELS } from "@core/helpers/settingsLabels";
import { InlineControls, SettingRow, SettingsGroup, ToggleRow } from "../../Settings/SettingsLayout/SettingsLayout";

function VideoStep(props: { general: GeneralSettingsData, onChange: (update: Partial<GeneralSettingsData>) => void }) {
  const [availableCodecs, setAvailableCodecs] = createSignal<VideoCodec[]>(["h264"]);
  const [fps, setFps] = createSignal(props.general.recordFps);

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

  return <SettingsGroup>
    <SettingRow label="Codec" hint="Only codecs your GPU can start are listed.">
      <Select value={props.general.recordCodec} items={codecItems()} onItemClick={item => props.onChange({ recordCodec: item.value })} />
    </SettingRow>
    <SettingRow label="Frame rate" hint="1 to 240 fps. Default 30.">
      <InlineControls>
        <NumberField value={fps()} min={1} max={240} unit="fps" width={100} onChange={setFps} />
        <Button disabled={fps() === props.general.recordFps} onClick={() => props.onChange({ recordFps: fps() })}>Apply</Button>
      </InlineControls>
    </SettingRow>
    <ToggleRow
      label="Record system audio"
      hint="Recordings include what you hear."
      checked={props.general.recordAudio}
      onChange={recordAudio => props.onChange({ recordAudio })}
    />
  </SettingsGroup>;
}

export default VideoStep;
