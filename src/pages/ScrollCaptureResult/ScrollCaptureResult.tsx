import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import styles from "./ScrollCaptureResult.module.scss";
import { safeInvoke } from "@core/helpers/safeInvoke";
import useToastState from "@core/states/toastState";
import ImageViewer from "@core/components/ImageViewer/ImageViewer";
import Input from "@core/components/Input/Input";
import Select from "@core/components/Select/Select";
import Button from "@core/components/Button/Button";
import WindowSizeInput from "./WindowSizeInput/WindowSizeInput";
import { saveScreenshot } from "@core/helpers/saveScreenshot";
import { ImageViewerApi, ScrollCaptureSession, SelectItem, StitchMatchMode, StitchParams } from "@core/types";

const MATCH_MODE_ITEMS: SelectItem<StitchMatchMode>[] = [
  { id: "normal", value: "normal", label: "Normal" },
  { id: "edges", value: "edges", label: "Edges" },
];

type Step = "config" | "annotate";

function ScrollCaptureResult() {
  const { pushToast } = useToastState;
  const [session, setSession] = createSignal<ScrollCaptureSession | null>(null);
  const [step, setStep] = createSignal<Step>("config");
  const [imageId, setImageId] = createSignal<number | null>(null);
  const [dimensions, setDimensions] = createSignal<{ width: number, height: number } | null>(null);
  const [params, setParams] = createSignal<StitchParams>({ windowSize: 32, crop: 5, matchMode: "normal" });
  const [busy, setBusy] = createSignal(false);
  const [excludedFrames, setExcludedFrames] = createSignal<Set<number>>(new Set());
  const [previewFrame, setPreviewFrame] = createSignal<{ index: number, left: number, bottom: number, maxWidth: number, maxHeight: number } | null>(null);

  let imageViewerApi: ImageViewerApi | undefined;

  const frameIndices = createMemo(() => Array.from({ length: session()?.frameCount ?? 0 }, (_, i) => i));

  const PREVIEW_MARGIN = 8;

  function showFramePreview(index: number, event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const maxWidth = Math.min(window.innerWidth * 0.8, 640) - PREVIEW_MARGIN * 2;
    const maxHeight = Math.max(rect.top - PREVIEW_MARGIN * 2, 100);

    const center = rect.left + rect.width / 2;
    const left = Math.min(
      Math.max(center - maxWidth / 2, PREVIEW_MARGIN),
      window.innerWidth - maxWidth - PREVIEW_MARGIN,
    );

    setPreviewFrame({ index, left, bottom: window.innerHeight - rect.top + PREVIEW_MARGIN, maxWidth, maxHeight });
  }

  function toggleFrame(index: number) {
    setExcludedFrames(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else if (next.size + 1 >= frameIndices().length) {
        pushToast("Keep at least one frame.", "error", 3000);
        return prev;
      } else {
        next.add(index);
      }
      return next;
    });
  }

  const previewUrl = createMemo(() => imageId() !== null ? `http://rosemyne-photo.localhost/preview/${imageId()}` : null);

  // Pulled on mount rather than pushed, a brand-new webview isn't guaranteed to be listening yet.
  onMount(async () => {
    try {
      const data = await safeInvoke("get_scroll_capture_session");
      if (!data) return;

      setSession(data);
      setImageId(data.imageId);
      setDimensions({ width: data.width, height: data.height });
      setParams(data.defaultParams);
      setStep("config");
    } catch (error) {
      pushToast(`Failed to load the scrolling capture session: ${typeof error === "string" ? error : JSON.stringify(error)}`, "error", 6000);
    }
  });

  function withSession(action: (current: ScrollCaptureSession) => Promise<void>) {
    const current = session();
    if (!current || busy()) return;
    setBusy(true);
    action(current).finally(() => setBusy(false));
  }

  function restitch() {
    withSession(async current => {
      try {
        const result = await safeInvoke("restitch_scroll_capture", {
          sessionId: current.sessionId,
          params: params(),
          excludedFrames: Array.from(excludedFrames()),
        });
        setImageId(result.imageId);
        setDimensions({ width: result.width, height: result.height });
      } catch (error) {
        pushToast(`Failed to restitch: ${typeof error === "string" ? error : JSON.stringify(error)}`, "error", 6000);
      }
    });
  }

  function discard() {
    withSession(async current => {
      try {
        await safeInvoke("cancel_scroll_capture_review", { sessionId: current.sessionId });
      } catch (error) {
        console.error("Failed to discard the scrolling capture review", error);
      }
    });
  }

  function retake() {
    withSession(async current => {
      // Order matters: cancel_scroll_capture_review closes *this* window, and
      // a closed window's JS stops running mid-function, so the overlay has
      // to already be requested before that happens, not after.
      await safeInvoke("scrolling_capture_screen").catch(error =>
        pushToast(`Failed to start scrolling capture: ${typeof error === "string" ? error : JSON.stringify(error)}`, "error", 6000)
      );
      try {
        await safeInvoke("cancel_scroll_capture_review", { sessionId: current.sessionId });
      } catch (error) {
        console.error("Failed to discard the scrolling capture review", error);
      }
    });
  }

  function saveResult(withAnnotations: boolean) {
    withSession(async current => {
      const final = imageViewerApi?.renderFinal?.(withAnnotations);
      if (!final) {
        pushToast("Nothing to save, the selected region is empty.", "error", 6000);
        return;
      }

      try {
        const id = imageId();
        if (id === null) return;
        await saveScreenshot(id, { x: final.x, y: final.y, width: final.width, height: final.height }, final.image, false);
        await safeInvoke("finish_scroll_capture_review", { sessionId: current.sessionId });
      } catch (error) {
        pushToast(`Failed to save: ${typeof error === "string" ? error : JSON.stringify(error)}`, "error", 6000);
      }
    });
  }

  return (
    <div class={styles.Page}>
      <Show when={session()}>
        {current => <>
          <div class={styles.TopBar}>
            <Show
              when={step() === "annotate"}
              fallback={
                <span class={styles.FrameCount}>
                  {excludedFrames().size > 0
                    ? `${current().frameCount - excludedFrames().size} of ${current().frameCount} frames included`
                    : `${current().frameCount} frame${current().frameCount === 1 ? "" : "s"} captured`}
                </span>
              }
            >
              <Button onClick={() => setStep("config")}>Back to stitching</Button>
            </Show>
            <Show when={dimensions()}>
              {dims => <span class={styles.Dimensions}>{dims().width} × {dims().height}</span>}
            </Show>
            <div class={styles.Spacer} />
            <Button color="var(--warning-color)" disabled={busy()} onClick={retake}>Retake</Button>
            <Button color="var(--danger-color)" disabled={busy()} onClick={discard}>Discard</Button>
            <Show when={step() === "annotate"}>
              <Button filled color="var(--base-blue)" disabled={busy()} onClick={() => saveResult(true)}>Save</Button>
            </Show>
          </div>

          <div class={styles.Body}>
            <Show when={previewUrl()}>
              <ImageViewer
                src={previewUrl()!}
                hideRotate
                allowPrimaryPan={step() === "config"}
                onApi={api => imageViewerApi = api}
                editable
                annotating={step() === "annotate"}
              />
            </Show>

            <Show when={step() === "config"}>
              <div class={styles.ConfigPanel}>
                <Show
                  when={current().frameCount >= 2}
                  fallback={<span class={styles.RestitchNote}>Only one frame was captured, nothing to restitch.</span>}
                >
                  <label>
                    Match window (rows)
                    <WindowSizeInput
                      value={params().windowSize}
                      onChange={value => setParams(p => ({ ...p, windowSize: value }))}
                    />
                  </label>
                  <label>
                    Seam crop (px)
                    <Input
                      type="number" min={0} value={params().crop}
                      onChange={e => setParams(p => ({ ...p, crop: Math.max(0, e.currentTarget.valueAsNumber || 0) }))}
                    />
                  </label>
                  <label>
                    Match mode
                    <Select value={params().matchMode} items={MATCH_MODE_ITEMS} onItemClick={item => setParams(p => ({ ...p, matchMode: item.value }))} />
                  </label>
                  <Button filled disabled={busy()} onClick={restitch}>Restitch</Button>
                </Show>

                <div class={styles.ConfigActions}>
                  <Button onClick={() => setStep("annotate")}>Continue to annotate</Button>
                  <Button filled color="var(--base-blue)" disabled={busy()} onClick={() => saveResult(false)}>Save without annotating</Button>
                </div>
              </div>
            </Show>
          </div>

          <Show when={step() === "config" && current().frameCount >= 2}>
            <div class={styles.FrameStrip}>
              <For each={frameIndices()}>
                {index => {
                  const excluded = createMemo(() => excludedFrames().has(index));
                  return (
                    <button
                      type="button"
                      class={styles.FrameThumb}
                      classList={{ [styles.Excluded]: excluded() }}
                      onClick={() => toggleFrame(index)}
                      onMouseEnter={e => showFramePreview(index, e)}
                      onMouseLeave={() => setPreviewFrame(null)}
                      title={excluded() ? "Excluded from stitching, click to include" : "Included in stitching, click to exclude"}
                    >
                      <img src={`http://rosemyne-photo.localhost/scroll-frame/${current().sessionId}/${index}`} draggable={false} />
                      <span class={styles.FrameIndex}>{index + 1}</span>
                    </button>
                  );
                }}
              </For>
            </div>
            <Show when={previewFrame()}>
              {preview => (
                <div
                  class={styles.FramePreview}
                  style={{
                    left: `${preview().left}px`,
                    bottom: `${preview().bottom}px`,
                    "max-width": `${preview().maxWidth}px`,
                    "max-height": `${preview().maxHeight}px`,
                  }}
                >
                  <img src={`http://rosemyne-photo.localhost/scroll-frame/${current().sessionId}/${preview().index}`} draggable={false} />
                </div>
              )}
            </Show>
          </Show>

        </>}
      </Show>
    </div>
  );
}

export default ScrollCaptureResult;
