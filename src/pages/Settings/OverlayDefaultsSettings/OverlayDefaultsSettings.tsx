import styles from "./OverlayDefaultsSettings.module.scss";
import { For } from "solid-js";
import useOverlayDefaultsState from "@core/states/overlayDefaultsState";
import { TOOL_TO_OVERLAY } from "@core/constants";
import { ImageOverlay } from "@core/types/imageOverlay";
import { beautifyCamelOrPascalCase } from "@core/helpers";
import OverlayAttributeList from "@core/components/OverlayAttributeList/OverlayAttributeList";
import Button from "@core/components/Button/Button";
import { RotateCcw } from "lucide-solid";

// Every overlay type that's actually placeable via a tool (excludes "draw",
// whose attributes are always empty , see DrawImageOverlay).
const OVERLAY_TYPES = [...new Set(Object.values(TOOL_TO_OVERLAY))] as Exclude<ImageOverlay["type"], "draw">[];

function OverlayDefaultsSettings() {
  const { merged, setOverrideValue, resetOverrides } = useOverlayDefaultsState;

  return <div class={styles.OverlayDefaultsSettings}>
    <div class={styles.Intro}>
      <span>Starting values for newly placed Box, Text, Blur and Pixelate overlays.</span>
      <span class={styles.Hint}>Only affects overlays placed after this point , anything already drawn on a screenshot keeps its own values.</span>
    </div>
    <For each={OVERLAY_TYPES}>
      {type => <div class={styles.ToolSection}>
        <div class={styles.ToolHeader}>
          <span>{beautifyCamelOrPascalCase(type)}</span>
          <Button isIcon tooltip="Reset to defaults" onClick={() => resetOverrides(type)}>
            <RotateCcw size={16} />
          </Button>
        </div>
        {/* Bound directly to the persistent, in-place-mutated store slice ,
            not a recomputed clone , so an open color picker keeps its
            identity across edits instead of being torn down mid-interaction. */}
        <OverlayAttributeList
          attributes={merged[type]}
          onChange={(name, value) => setOverrideValue(type, name as never, value)}
        />
      </div>}
    </For>
  </div>;
}

export default OverlayDefaultsSettings;
