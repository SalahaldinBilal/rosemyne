import styles from "./ScrollCaptureLiveParams.module.scss";
import useScreenshotOverlayStateInner from "../../../states/screenshotOverlayState";
import NumberField from "@core/components/NumberField/NumberField";
import DurationField from "@core/components/DurationField/DurationField";
import ScrollDistanceInput from "@core/components/ScrollDistanceInput/ScrollDistanceInput";

// Per-instance scroll-capture tuning, seeded from settings but never written back (see screenshotOverlayState.ts).
function ScrollCaptureLiveParams() {
  const { scrollCaptureParams, setScrollCaptureParams } = useScreenshotOverlayStateInner;

  return (
    <div class={styles.Panel} onMouseDown={e => e.stopPropagation()}>
      <div class={styles.Field}>
        <span>Scroll amount</span>
        <ScrollDistanceInput
          size="sm"
          value={scrollCaptureParams.scrollDistance}
          onChange={value => setScrollCaptureParams("scrollDistance", value)}
        />
      </div>
      <div class={styles.Field}>
        <span>Delay</span>
        <DurationField
          size="sm"
          parts={["s", "ms"]}
          valueMs={scrollCaptureParams.frameDelayMs}
          onChange={ms => setScrollCaptureParams("frameDelayMs", Math.max(50, ms))}
        />
      </div>
      <div class={styles.Field}>
        <span>Max frames</span>
        <NumberField
          size="sm"
          width={90}
          min={2}
          max={1000}
          value={scrollCaptureParams.maxFrames}
          onChange={value => setScrollCaptureParams("maxFrames", value)}
        />
      </div>
    </div>
  );
}

export default ScrollCaptureLiveParams;
