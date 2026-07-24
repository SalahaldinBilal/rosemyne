import styles from "./ScrollCaptureLiveParams.module.scss";
import useScreenshotOverlayStateInner from "../../../states/screenshotOverlayState";
import Input from "@core/components/Input/Input";
import ScrollDistanceInput from "@core/components/ScrollDistanceInput/ScrollDistanceInput";

// Per-instance scroll-capture tuning, seeded from settings but never written back (see screenshotOverlayState.ts).
function ScrollCaptureLiveParams() {
  const { scrollCaptureParams, setScrollCaptureParams } = useScreenshotOverlayStateInner;

  return (
    <div class={styles.Panel} onMouseDown={e => e.stopPropagation()}>
      <label class={styles.Field}>
        Scroll amount
        <ScrollDistanceInput
          value={scrollCaptureParams.scrollDistance}
          onChange={value => setScrollCaptureParams("scrollDistance", value)}
        />
      </label>
      <label class={styles.Field}>
        Delay (ms)
        <Input
          type="number" min={50} value={scrollCaptureParams.frameDelayMs}
          onChange={e => setScrollCaptureParams("frameDelayMs", Math.max(50, e.currentTarget.valueAsNumber || 50))}
          style={{ width: "80px" }}
        />
      </label>
      <label class={styles.Field}>
        Max frames
        <Input
          type="number" min={2} value={scrollCaptureParams.maxFrames}
          onChange={e => setScrollCaptureParams("maxFrames", Math.max(2, e.currentTarget.valueAsNumber || 2))}
          style={{ width: "80px" }}
        />
      </label>
    </div>
  );
}

export default ScrollCaptureLiveParams;
