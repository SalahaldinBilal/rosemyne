import styles from "./OverlayDefaultsSettings.module.scss";
import { createMemo, createSignal, For, JSX, Match, onMount, Show, Switch } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import { CursorSource, GeneralSettings, SelectItem } from "@core/types";
import Select from "@core/components/Select/Select";
import Segmented from "@core/components/Segmented/Segmented";
import useOverlayDefaultsState from "@core/states/overlayDefaultsState";
import useOverlayImagesState from "@core/states/overlayImagesState";
import useToastState from "@core/states/toastState";
import useSettingsSavedState from "@core/states/settingsSavedState";
import { CURSOR_IMAGE_NAME, TOOL_TO_OVERLAY } from "@core/constants";
import { ImageOverlay, ImageOverlayAttributeMap } from "@core/types/imageOverlay";
import { beautifyCamelOrPascalCase } from "@core/helpers";
import OverlayAttributeList from "@core/components/OverlayAttributeList/OverlayAttributeList";
import Button from "@core/components/Button/Button";
import Input from "@core/components/Input/Input";
import { ImagePlus, RotateCcw, Trash2 } from "lucide-solid";
import { SettingRow, SettingsGroup, SettingsPage } from "../SettingsLayout/SettingsLayout";

// Every overlay type a tool can place. "draw" has no attributes, see DrawImageOverlay.
type PlaceableType = Exclude<ImageOverlay["type"], "draw">;
const OVERLAY_TYPES = [...new Set(Object.values(TOOL_TO_OVERLAY))] as PlaceableType[];
const TYPE_ITEMS = OVERLAY_TYPES.map(type => ({ id: type, label: beautifyCamelOrPascalCase(type) }));

const CURSOR_SOURCE_ITEMS: SelectItem<CursorSource>[] = [
  { id: "live", value: "live", label: "Copy the cursor as it was" },
  { id: "picked", value: "picked", label: "Always use a chosen cursor" },
];

type Values = { [key: string]: unknown };

function attributeValues(attributes: ImageOverlayAttributeMap): Values {
  return Object.fromEntries(Object.entries(attributes).map(([name, attribute]) => [name, (attribute as { value: unknown }).value]));
}

const num = (value: unknown, fallback: number) => typeof value === "number" ? value : fallback;
const str = (value: unknown, fallback: string) => typeof value === "string" ? value : fallback;

// A rough look at a freshly drawn item, drawn with CSS instead of the canvas renderer.
function Sample(props: { type: PlaceableType, values: Values, imageUrl?: string }) {
  const thickness = createMemo(() => Math.min(num(props.values.thickness, 5), 14));
  const color = createMemo(() => str(props.values.color, "#ff0000"));
  const headSize = createMemo(() => Math.min(num(props.values.headSize, 30), 40));
  const intensity = createMemo(() => num(props.values.intensity, 5));
  const isArrow = createMemo(() => props.type === "arrow");
  const boxStyle = createMemo<JSX.CSSProperties>(() => ({
    "background-color": color(),
    border: `${Math.min(num(props.values.borderThickness, 1), 14)}px solid ${str(props.values.borderColor, "#ff0000")}`,
  }));
  const textStyle = createMemo<JSX.CSSProperties>(() => ({
    color: color(),
    "font-size": `${Math.min(num(props.values.size, 24), 44)}px`,
    "font-family": str(props.values.font, "serif"),
  }));
  const text = createMemo(() => str(props.values.text, "Hello World"));
  const blurStyle = createMemo<JSX.CSSProperties>(() => ({ "backdrop-filter": `blur(${intensity()}px)` }));
  const pixelateStyle = createMemo<JSX.CSSProperties>(() => ({
    "--cell": `${Math.max(2, intensity() * 2)}px`,
    "backdrop-filter": `blur(${intensity() / 2}px)`,
  }));
  const imageOpacity = createMemo(() => num(props.values.opacity, 100) / 100);
  const lineEnd = createMemo(() => isArrow() ? { x: 128 - headSize() * 0.6, y: 12 + headSize() * 0.32 } : { x: 128, y: 12 });
  const arrowHead = createMemo(() =>
    `128,12 ${128 - headSize()},${12 + headSize() * 0.15} ${128 - headSize() * 0.55},${12 + headSize() * 0.75}`,
  );

  return (
    <Switch>
      <Match when={props.type === "box"}>
        <div class={styles.SampleBox} style={boxStyle()} />
      </Match>
      <Match when={props.type === "text"}>
        <span class={styles.SampleText} style={textStyle()}>{text()}</span>
      </Match>
      <Match when={props.type === "blur"}>
        <div class={styles.SampleEffect} style={blurStyle()} />
      </Match>
      <Match when={props.type === "pixelate"}>
        <div class={`${styles.SampleEffect} ${styles.Pixelate}`} style={pixelateStyle()} />
      </Match>
      <Match when={props.type === "image"}>
        <Show when={props.imageUrl}>
          <img class={styles.SampleImage} src={props.imageUrl} style={{ opacity: imageOpacity() }} />
        </Show>
      </Match>
      <Match when={props.type === "arrow" || props.type === "line"}>
        <svg class={styles.SampleLine} viewBox="0 0 140 86">
          <line x1="12" y1="74" x2={lineEnd().x} y2={lineEnd().y} stroke={color()} stroke-width={thickness()} stroke-linecap="round" />
          <Show when={isArrow()}>
            <polygon points={arrowHead()} fill={color()} />
          </Show>
        </svg>
      </Match>
    </Switch>
  );
}

function OverlayDefaultsSettings() {
  const { merged, setOverrideValue, resetOverrides } = useOverlayDefaultsState;
  const { entries, names, systemCursors, addFromFile, remove, rename } = useOverlayImagesState;
  const { pushToast } = useToastState;
  const { markSettingsSaved } = useSettingsSavedState;
  const [busy, setBusy] = createSignal(false);
  const [general, setGeneral] = createSignal<GeneralSettings | null>(null);
  const [selectedType, setSelectedType] = createSignal<PlaceableType>(OVERLAY_TYPES[0]);

  onMount(async () => {
    try {
      setGeneral(await safeInvoke("get_general_settings"));
    } catch (error) {
      console.error("Failed to load general settings for the cursor options", error);
    }
  });

  async function applyGeneral(update: Partial<GeneralSettings>) {
    const previous = general();
    if (!previous) return;

    const next = { ...previous, ...update };
    setGeneral(next);

    try {
      await safeInvoke("set_general_settings", { general: next });
      markSettingsSaved();
    } catch (error) {
      setGeneral(previous);
      report(error);
    }
  }

  // The image list is the live library, not the static constant the other types carry.
  const attributes = createMemo<ImageOverlayAttributeMap>(() => selectedType() === "image"
    ? { ...merged.image, image: { ...merged.image.image, options: names() } }
    : merged[selectedType()]
  );
  const sampleValues = createMemo(() => attributeValues(attributes()));
  const sampleImageUrl = createMemo(() => entries.find(entry => entry.name === sampleValues().image)?.url);

  const cursorSource = createMemo<CursorSource>(() => general()?.cursorSource ?? "live");

  // The scheme cursors are library images like any other, only never user-removable.
  const systemCursorNames = createMemo(() => new Set(systemCursors().map(cursor => cursor.name)));
  const library = createMemo(() => entries.filter(entry =>
    !entry.hidden && !systemCursorNames().has(entry.name)
  ));

  const systemCursorItems = createMemo<SelectItem<string>[]>(() =>
    systemCursors().map(cursor => ({ id: cursor.id, value: cursor.id, label: cursor.name }))
  );

  // Matches the backend: nothing picked yet means the first of the scheme, which is Arrow.
  const pickedCursor = createMemo(() =>
    systemCursors().find(cursor => cursor.id === general()?.pickedCursor) ?? systemCursors()[0]
  );

  const placedCursor = createMemo(() => {
    const name = cursorSource() === "picked" ? pickedCursor()?.name : CURSOR_IMAGE_NAME;
    return name ? entries.find(entry => entry.name === name) : undefined;
  });

  function report(error: unknown) {
    pushToast(errorMessage(error), "error", 6000);
  }

  async function addImage() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "tiff"] }],
    });
    if (typeof picked !== "string") return;

    setBusy(true);
    try {
      await addFromFile(picked);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  return <SettingsPage title="Overlay defaults" description="Starting values for newly drawn boxes, text and effects. Items you already placed keep their own.">
    <div class={styles.TypeBar}>
      <Segmented items={TYPE_ITEMS} value={selectedType()} onChange={setSelectedType} />
      <Button size="sm" variant="ghost" tooltip={`Reset ${beautifyCamelOrPascalCase(selectedType()).toLowerCase()} to the built-in values`} onClick={() => { resetOverrides(selectedType()); markSettingsSaved(); }}>
        <RotateCcw size={14} />Reset
      </Button>
    </div>

    <div class={styles.Editor}>
      <div class={styles.Attributes}>
        {/* The store slice itself, not a clone: replacing it tears down an open color picker mid-edit. */}
        <OverlayAttributeList
          attributes={attributes()}
          onChange={(name, value) => { setOverrideValue(selectedType(), name as never, value); markSettingsSaved(); }}
        />
      </div>
      <div class={styles.Preview}>
        <div class={`${styles.Half} ${styles.Light}`}><span class={styles.PreviewLabel}>Light</span></div>
        <div class={`${styles.Half} ${styles.Dark}`}><span class={styles.PreviewLabel}>Dark</span></div>
        <div class={styles.SampleSlot}>
          <Sample type={selectedType()} values={sampleValues()} imageUrl={sampleImageUrl()} />
        </div>
      </div>
    </div>

    <SettingsGroup
      title="Image library"
      right={<Button size="sm" disabled={busy()} onClick={addImage}><ImagePlus size={14} />Add image</Button>}
    >
      <SettingRow
        label="Cursor placed on a capture"
        hint="Used when Include the mouse cursor is on, under General."
      >
        <div class={styles.CursorControls}>
          <div class={styles.Thumb}><img src={placedCursor()?.url} /></div>
          <Select value={cursorSource()} items={CURSOR_SOURCE_ITEMS} onItemClick={item => applyGeneral({ cursorSource: item.value })} />
          <Show when={cursorSource() === "picked"}>
            <Select value={pickedCursor()?.id ?? ""} items={systemCursorItems()} onItemClick={item => applyGeneral({ pickedCursor: item.value })} />
          </Show>
        </div>
      </SettingRow>
      <For each={library()} fallback={<SettingRow label="No images added yet" hint="Images the Image tool can stamp onto a capture. They're copied in as WebP." />}>
        {entry => <div class={styles.LibraryRow}>
          <div class={styles.Thumb}><img src={entry.url} /></div>
          <Input
            size="sm"
            class={styles.NameInput}
            value={entry.name}
            onChange={async event => {
              const input = event.currentTarget;
              const next = input.value.trim();
              if (!next || next === entry.name) return;

              try {
                input.value = await rename(entry.name, next);
              } catch (error) {
                input.value = entry.name;
                report(error);
              }
            }}
          />
          <Button isIcon size="sm" variant="danger" tooltip="Remove" onClick={() => remove(entry.name).catch(report)}>
            <Trash2 size={14} />
          </Button>
        </div>}
      </For>
    </SettingsGroup>
  </SettingsPage>;
}

export default OverlayDefaultsSettings;
