import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import styles from "./ScrollCaptureResult.module.scss";
import { safeInvoke } from "@core/helpers/safeInvoke";
import useToastState from "@core/states/toastState";
import ImageViewer from "@core/components/ImageViewer/ImageViewer";
import NumberField from "@core/components/NumberField/NumberField";
import Segmented from "@core/components/Segmented/Segmented";
import Button from "@core/components/Button/Button";
import Badge from "@core/components/Badge/Badge";
import Modal from "@core/components/Modal/Modal";
import { Spinner } from "@core/components/Progress/Progress";
import WindowSizeInput from "./WindowSizeInput/WindowSizeInput";
import { saveScreenshot } from "@core/helpers/saveScreenshot";
import { ImageViewerApi, ScrollCaptureSession, StitchMatchMode, StitchParams } from "@core/types";
import { EyeOff, Layers, RefreshCw } from "lucide-solid";

const MATCH_MODE_ITEMS: { id: StitchMatchMode, label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "edges", label: "Edges" },
];

const PREVIEW_MARGIN = 8;

type Step = "config" | "annotate";

function errorText(error: unknown): string {
  return typeof error === "string" ? error : JSON.stringify(error);
}

function ScrollCaptureResult() {
  const { pushToast } = useToastState;
  const [session, setSession] = createSignal<ScrollCaptureSession | null>(null);
  const [step, setStep] = createSignal<Step>("config");
  const [imageId, setImageId] = createSignal<number | null>(null);
  const [dimensions, setDimensions] = createSignal<{ width: number, height: number } | null>(null);
  const [params, setParams] = createSignal<StitchParams>({ windowSize: 32, crop: 5, matchMode: "normal" });
  const [busy, setBusy] = createSignal(false);
  const [restitching, setRestitching] = createSignal(false);
  const [confirmingDiscard, setConfirmingDiscard] = createSignal(false);
  const [excludedFrames, setExcludedFrames] = createSignal<Set<number>>(new Set());
  const [previewFrame, setPreviewFrame] = createSignal<{ index: number, left: number, bottom: number, maxWidth: number, maxHeight: number } | null>(null);
  const [toolbarMount, setToolbarMount] = createSignal<HTMLDivElement>();

  let imageViewerApi: ImageViewerApi | undefined;

  const frameIndices = createMemo(() => Array.from({ length: session()?.frameCount ?? 0 }, (_, i) => i));
  const includedCount = createMemo(() => (session()?.frameCount ?? 0) - excludedFrames().size);
  const multiFrame = createMemo(() => (session()?.frameCount ?? 0) >= 2);
  const previewUrl = createMemo(() => imageId() !== null ? `http://rosemyne-photo.localhost/preview/${imageId()}` : null);
  const frameLabel = createMemo(() => {
    const total = session()?.frameCount ?? 0;
    return excludedFrames().size > 0 ? `${includedCount()} of ${total} frames` : `${total} frame${total === 1 ? "" : "s"}`;
  });
  const sizeLabel = createMemo(() => {
    const dims = dimensions();
    return dims ? `${dims.width} × ${dims.height}` : null;
  });
  const stepItems = createMemo(() => [
    { id: "config" as const, label: <><span class={styles.StepNumber} classList={{ [styles.On]: step() === "config" }}>1</span>Stitch</> },
    { id: "annotate" as const, label: <><span class={styles.StepNumber} classList={{ [styles.On]: step() === "annotate" }}>2</span>Annotate</> },
  ]);
  const framePreviewStyle = createMemo(() => {
    const preview = previewFrame();
    return preview ? {
      left: `${preview.left}px`,
      bottom: `${preview.bottom}px`,
      "max-width": `${preview.maxWidth}px`,
      "max-height": `${preview.maxHeight}px`,
    } : undefined;
  });

  function frameUrl(index: number): string {
    return `http://rosemyne-photo.localhost/scroll-frame/${session()!.sessionId}/${index}`;
  }

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
      pushToast(`Failed to load the scrolling capture session: ${errorText(error)}`, "error", 6000);
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
      setRestitching(true);
      try {
        const result = await safeInvoke("restitch_scroll_capture", {
          sessionId: current.sessionId,
          params: params(),
          excludedFrames: Array.from(excludedFrames()),
        });
        setImageId(result.imageId);
        setDimensions({ width: result.width, height: result.height });
      } catch (error) {
        pushToast(`Failed to restitch: ${errorText(error)}`, "error", 6000);
      } finally {
        setRestitching(false);
      }
    });
  }

  function discard() {
    setConfirmingDiscard(false);
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
      // cancel_scroll_capture_review closes this window and its JS stops there, so the overlay is requested first.
      await safeInvoke("scrolling_capture_screen").catch(error =>
        pushToast(`Failed to start scrolling capture: ${errorText(error)}`, "error", 6000)
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
        pushToast(`Failed to save: ${errorText(error)}`, "error", 6000);
      }
    });
  }

  return (
    <div class={styles.Page}>
      <Show when={session()}>
        <>
          <div class={styles.TopBar}>
            <Segmented items={stepItems()} value={step()} onChange={setStep} />
            <Badge><Layers size={11} />{frameLabel()}</Badge>
            <Show when={sizeLabel()}>{label => <Badge>{label()}</Badge>}</Show>
            <div class={styles.Spacer} />
            <Button variant="warn" disabled={busy()} onClick={retake}>Retake</Button>
            <Button variant="danger" disabled={busy()} onClick={() => setConfirmingDiscard(true)}>Discard</Button>
            <Show
              when={step() === "annotate"}
              fallback={<Button variant="primary" disabled={busy()} onClick={() => setStep("annotate")}>Continue</Button>}
            >
              <Button variant="primary" disabled={busy()} onClick={() => saveResult(true)}>Save</Button>
            </Show>
          </div>

          <div class={styles.Body}>
            <div class={styles.ToolbarSlot} ref={setToolbarMount} />
            <div class={styles.Viewer}>
              <Show when={previewUrl() && toolbarMount()}>
                <ImageViewer
                  src={previewUrl()!}
                  hideRotate
                  allowPrimaryPan={step() === "config"}
                  onApi={api => imageViewerApi = api}
                  editable
                  annotating={step() === "annotate"}
                  toolbarMount={toolbarMount()}
                />
              </Show>
              <Show when={restitching()}>
                <div class={styles.Busy}><Spinner />Restitching {includedCount()} frames</div>
              </Show>
            </div>

            <aside class={styles.Config} classList={{ [styles.Gone]: step() !== "config" }} aria-hidden={step() !== "config"}>
              <h3>Stitching</h3>
              <Show when={multiFrame()} fallback={<span class={styles.Note}>Only one frame was captured, so there's nothing to stitch.</span>}>
                <label class={styles.Field}>
                  <span>Match window</span>
                  <WindowSizeInput value={params().windowSize} onChange={value => setParams(p => ({ ...p, windowSize: value }))} />
                </label>
                <label class={styles.Field}>
                  <span>Seam crop</span>
                  <NumberField
                    width="100%"
                    unit="px"
                    min={0}
                    max={10_000}
                    value={params().crop}
                    onChange={crop => setParams(p => ({ ...p, crop }))}
                  />
                </label>
                <div class={styles.Field}>
                  <span>Match mode</span>
                  <Segmented stretch items={MATCH_MODE_ITEMS} value={params().matchMode} onChange={matchMode => setParams(p => ({ ...p, matchMode }))} />
                </div>
                <Button disabled={busy()} onClick={restitch}><RefreshCw size={15} />Restitch</Button>
              </Show>
              <div class={styles.ConfigFoot}>
                <Button variant="ghost" disabled={busy()} onClick={() => saveResult(false)}>Save without annotating</Button>
              </div>
            </aside>
          </div>

          <Show when={multiFrame()}>
            <div class={styles.Strip} classList={{ [styles.Gone]: step() !== "config" }}>
              <For each={frameIndices()}>
                {index => {
                  const excluded = createMemo(() => excludedFrames().has(index));
                  return (
                    <button
                      type="button"
                      class={styles.Frame}
                      classList={{ [styles.Excluded]: excluded() }}
                      onClick={() => toggleFrame(index)}
                      onMouseEnter={e => showFramePreview(index, e)}
                      onMouseLeave={() => setPreviewFrame(null)}
                      title={excluded() ? "Left out of stitching. Click to include it." : "Included in stitching. Click to leave it out."}
                    >
                      <img src={frameUrl(index)} draggable={false} />
                      <span class={styles.FrameIndex}>{index + 1}</span>
                      <span class={styles.ExcludedIcon}><EyeOff size={18} /></span>
                    </button>
                  );
                }}
              </For>
            </div>
            <Show when={previewFrame()}>
              {preview => (
                <div class={styles.FramePreview} style={framePreviewStyle()}>
                  <img src={frameUrl(preview().index)} draggable={false} />
                </div>
              )}
            </Show>
          </Show>

          <Modal
            show={confirmingDiscard()}
            onHide={() => setConfirmingDiscard(false)}
            title="Discard this capture?"
            width={420}
            footer={<>
              <Button onClick={() => setConfirmingDiscard(false)}>Cancel</Button>
              <Button variant="danger-solid" onClick={discard}>Discard</Button>
            </>}
          >
            <p>The captured frames are thrown away and this window closes.</p>
          </Modal>
        </>
      </Show>
    </div>
  );
}

export default ScrollCaptureResult;
