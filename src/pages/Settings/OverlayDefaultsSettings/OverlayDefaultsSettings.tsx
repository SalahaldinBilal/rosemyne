import styles from "./OverlayDefaultsSettings.module.scss";
import { createMemo, createSignal, For, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import useOverlayDefaultsState from "@core/states/overlayDefaultsState";
import useOverlayImagesState from "@core/states/overlayImagesState";
import useToastState from "@core/states/toastState";
import { CURSOR_IMAGE_NAME, TOOL_TO_OVERLAY } from "@core/constants";
import { ImageOverlay, ImageOverlayAttributeMap } from "@core/types/imageOverlay";
import { beautifyCamelOrPascalCase } from "@core/helpers";
import OverlayAttributeList from "@core/components/OverlayAttributeList/OverlayAttributeList";
import Button from "@core/components/Button/Button";
import Input from "@core/components/Input/Input";
import { RotateCcw, Trash2 } from "lucide-solid";

// Every overlay type that's actually placeable via a tool (excludes "draw",
// whose attributes are always empty, see DrawImageOverlay).
const OVERLAY_TYPES = [...new Set(Object.values(TOOL_TO_OVERLAY))] as Exclude<ImageOverlay["type"], "draw">[];

function OverlayDefaultsSettings() {
  const { merged, setOverrideValue, resetOverrides } = useOverlayDefaultsState;
  const { entries, names, addFromFile, remove, rename } = useOverlayImagesState;
  const { pushToast } = useToastState;
  const [busy, setBusy] = createSignal(false);

  const cursor = createMemo(() => entries.find(entry => entry.name === CURSOR_IMAGE_NAME));
  const library = createMemo(() => entries.filter(entry => entry.name !== CURSOR_IMAGE_NAME));

  function report(error: unknown) {
    pushToast(typeof error === "string" ? error : JSON.stringify(error), "error", 6000);
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

  return <div class={styles.OverlayDefaultsSettings}>
    <div class={styles.Intro}>
      <span>Starting values for newly placed Box, Text, Blur, Pixelate, Image, Arrow and Line overlays.</span>
      <span class={styles.Hint}>Only affects overlays placed after this point, anything already drawn on a screenshot keeps its own values.</span>
    </div>
    <For each={OVERLAY_TYPES}>
      {type => {
        // The image list is the live library, not the static constant the other types carry.
        const attributes = createMemo<ImageOverlayAttributeMap>(() => type === "image"
          ? { ...merged.image, image: { ...merged.image.image, options: names() } }
          : merged[type]
        );

        return <div class={styles.ToolSection}>
          <div class={styles.ToolHeader}>
            <span>{beautifyCamelOrPascalCase(type)}</span>
            <Button isIcon tooltip="Reset to defaults" onClick={() => resetOverrides(type)}>
              <RotateCcw size={16} />
            </Button>
          </div>
          {/* The store slice itself, not a clone: replacing it tears down an open color picker mid-edit. */}
          <OverlayAttributeList
            attributes={attributes()}
            onChange={(name, value) => setOverrideValue(type, name as never, value)}
          />
        </div>;
      }}
    </For>

    <div class={styles.ToolSection}>
      <div class={styles.ToolHeader}>
        <span>Image library</span>
        <Button disabled={busy()} onClick={addImage}>Add image…</Button>
      </div>

      <div class={styles.LibraryIntro}>
        Images the Image overlay tool can stamp onto a capture. Added images are copied into
        <code> overlay-images/ </code> as WebP, so moving or deleting the original doesn't break them.
      </div>

      <Show when={cursor()}>
        {entry => <div class={styles.Row}>
          <div class={styles.Preview}><img src={entry().url} /></div>
          <div class={styles.RowBody}>
            <span>{CURSOR_IMAGE_NAME}</span>
            <span class={styles.Hint}>Built in. Default.</span>
          </div>
        </div>}
      </Show>

      <For each={library()} fallback={<div class={styles.Empty}>No images added yet.</div>}>
        {entry => <div class={styles.Row}>
          <div class={styles.Preview}><img src={entry.url} /></div>
          <div class={styles.RowBody}>
            <Input
              value={entry.name}
              onChange={async event => {
                const next = event.currentTarget.value.trim();
                if (!next || next === entry.name) {
                  event.currentTarget.value = entry.name;
                  return;
                }

                try {
                  event.currentTarget.value = await rename(entry.name, next);
                } catch (error) {
                  event.currentTarget.value = entry.name;
                  report(error);
                }
              }}
            />
          </div>
          <Button isIcon tooltip="Remove" color="var(--danger-color)" onClick={() => remove(entry.name).catch(report)}>
            <Trash2 size={16} />
          </Button>
        </div>}
      </For>
    </div>
  </div>;
}

export default OverlayDefaultsSettings;
