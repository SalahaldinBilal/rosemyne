import styles from "./HistoryCard.module.scss";
import { createEffect, createMemo, createSignal, JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { CircleCheck, Copy, CloudUpload, Ellipsis, File, FileSearch, FolderOpen, Link, Play, RefreshCw, TriangleAlert, Video } from "lucide-solid";
import { ImageHistoryData, TagValue } from "../../../types";
import { UploaderCreationError } from "../../../types/request";
import { describeUploaderError } from "../../../components/UploaderCreator/UploaderCreator";
import { errorHasRequestDetails } from "../../../components/UploadErrorDetailsModal/UploadErrorDetailsModal";
import { tagNumber } from "../../../states/tagFilterState";
import { formatSystemDateTime } from "../../../helpers/systemDateFormat";
import { formatBytes, formatClock } from "../../../helpers/format";
import { LARGE_VIDEO_BYTES, generateVideoThumbnail } from "../../../helpers/videoThumbnail";
import { scaledImageUrl } from "../../../helpers/scaledImage";
import Button from "../../../components/Button/Button";
import Tooltip from "../../../components/Tooltip/Tooltip";
import { Spinner } from "../../../components/Progress/Progress";

const MAX_STAGGERED_CARDS = 14;
const STAGGER_MS = 22;

// There's no real per-app color, so the process name picks one from a fixed palette.
const SOURCE_COLORS = ["#7b6cf6", "#3fcf8e", "#f0b43c", "#f25555", "#4c96f3", "#e879c9", "#2dd4bf", "#fb923c"];

export type CardUploadState = {
  progress: { sent: number, total: number } | undefined,
  success: { copied: boolean } | undefined,
};

export type CardActions = {
  open: () => void,
  copy: () => void,
  copyLink: () => void,
  upload: () => void,
  retry: () => void,
  showInFolder: () => void,
  showMenu: (event: MouseEvent, position?: { x: number, y: number }) => void,
  showError: (error: UploaderCreationError) => void,
  startDrag: (event: DragEvent) => void,
};

export function savedUrl(fileName: string): string {
  return `http://rosemyne-photo.localhost/saved/${fileName}`;
}

// Waits for the size to settle while the window is being resized, so it isn't re-rendered for every pixel.
const RESIZE_SETTLE_MS = 150;

function CardImage(props: { src: string, fit: boolean }) {
  const [box, setBox] = createSignal<{ width: number, height: number } | null>(null);
  const [shown, setShown] = createSignal<string | null>(null);
  let element!: HTMLDivElement;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  function measure() {
    // Layout size, not getBoundingClientRect, which would include the card's entrance scale.
    const ratio = window.devicePixelRatio || 1;
    setBox({ width: Math.round(element.offsetWidth * ratio), height: Math.round(element.offsetHeight * ratio) });
  }

  onMount(() => {
    measure();
    const observer = new ResizeObserver(() => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(measure, RESIZE_SETTLE_MS);
    });
    observer.observe(element);
    onCleanup(() => {
      observer.disconnect();
      clearTimeout(settleTimer);
    });
  });

  createEffect(() => {
    const size = box();
    const src = props.src;
    const mode = props.fit ? "contain" : "cover";
    if (!size || size.width === 0) return;

    let current = true;
    scaledImageUrl(src, size.width, size.height, mode).then(url => current && setShown(url ?? src));
    onCleanup(() => { current = false; });
  });

  return (
    <div ref={element} class={styles.CardImage}>
      <Show when={shown()}>{url => <img src={url()} draggable={false} />}</Show>
    </div>
  );
}

export function fileExt(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toUpperCase() : "FILE";
}

function mainWindow(tags: ImageHistoryData["tags"]): { name: string, process: string } | null {
  const windows = tags?.["Windows"];
  if (!Array.isArray(windows)) return null;

  let best: { name: string, process: string } | null = null;
  let bestPercentage = -1;

  for (const entry of windows) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;

    const record = entry as { [key: string]: TagValue };
    const name = record["Window Name"];
    const percentage = typeof record["Screenshot Percentage"] === "number" ? record["Screenshot Percentage"] as number : 0;
    if (typeof name !== "string" || percentage <= bestPercentage) continue;

    bestPercentage = percentage;
    best = { name, process: typeof record["Process Name"] === "string" ? record["Process Name"] as string : name };
  }

  return best;
}

function sourceColor(process: string): string {
  let hash = 0;
  for (const char of process.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SOURCE_COLORS[hash % SOURCE_COLORS.length];
}

function VideoThumbnail(props: { screenshot: ImageHistoryData }) {
  const [display, setDisplay] = createSignal<"thumb" | "video" | "placeholder">("thumb");
  const [thumbVersion, setThumbVersion] = createSignal(0);
  const thumbUrl = createMemo(() => `http://rosemyne-photo.localhost/thumb/${props.screenshot.fileName}?v=${thumbVersion()}`);
  const videoUrl = createMemo(() => savedUrl(props.screenshot.fileName));
  let triedGenerating = false;

  function videoFallbackAllowed() {
    return (props.screenshot.fileSize ?? 0) <= LARGE_VIDEO_BYTES;
  }

  async function onThumbnailMissing() {
    // Small files may show the Range-streamed video while the thumbnail generates, large ones a placeholder.
    setDisplay(videoFallbackAllowed() ? "video" : "placeholder");
    if (triedGenerating) return;
    triedGenerating = true;

    if (await generateVideoThumbnail(props.screenshot.fileName)) {
      setThumbVersion(version => version + 1);
      setDisplay("thumb");
    }
  }

  return <Switch>
    <Match when={display() === "thumb"}>
      <img src={thumbUrl()} loading="lazy" draggable={false} onError={onThumbnailMissing} />
    </Match>
    <Match when={display() === "video"}>
      <video src={videoUrl()} preload="metadata" muted />
    </Match>
    <Match when={true}>
      <div class={styles.FilePlaceholder}><Video size={30} /></div>
    </Match>
  </Switch>;
}

function QuickButton(props: { tooltip: string, onClick: (event: MouseEvent) => void, children: JSX.Element }) {
  let button: HTMLButtonElement | undefined;

  return (
    <button
      ref={button}
      type="button"
      class={styles.QuickButton}
      onClick={event => { event.stopPropagation(); props.onClick(event); }}
    >
      {props.children}
      <Tooltip anchor={() => button} text={props.tooltip} />
    </button>
  );
}

function HistoryCard(props: {
  screenshot: ImageHistoryData,
  upload: CardUploadState,
  flash: string | undefined,
  entranceIndex: number | null,
  removing: boolean,
  fitImage: boolean,
  actions: CardActions,
}) {
  const source = createMemo(() => mainWindow(props.screenshot.tags));
  const color = createMemo(() => source() ? sourceColor(source()!.process) : undefined);
  const hasSourceLine = createMemo(() => !!source() || props.screenshot.type === "file");
  const dateText = createMemo(() => formatSystemDateTime(new Date(props.screenshot.dateTime)));
  const sizeText = createMemo(() => props.screenshot.fileSize !== undefined ? formatBytes(props.screenshot.fileSize) : null);
  const duration = createMemo(() => tagNumber(props.screenshot.tags?.["Duration"]));
  const percent = createMemo(() => {
    const progress = props.upload.progress;
    if (!progress) return null;
    return progress.total > 0 ? Math.round((progress.sent / progress.total) * 100) : 0;
  });
  const uploading = createMemo(() => props.upload.progress !== undefined);
  const error = createMemo(() => !uploading() ? props.screenshot.uploadError : undefined);
  const errorText = createMemo(() => error() ? describeUploaderError(error()) : "");
  const linkText = createMemo(() => props.screenshot.url?.replace(/^https?:\/\//, ""));
  const hasErrorDetails = createMemo(() => errorHasRequestDetails(error()));
  const imageUrl = createMemo(() => savedUrl(props.screenshot.fileName));
  const extension = createMemo(() => fileExt(props.screenshot.fileName));
  const durationText = createMemo(() => duration() !== null ? formatClock(duration()!) : null);
  const entranceStyle = createMemo<JSX.CSSProperties | undefined>(() =>
    props.entranceIndex === null ? undefined : { "animation-delay": `${Math.min(props.entranceIndex, MAX_STAGGERED_CARDS) * STAGGER_MS}ms` },
  );

  let warningIcon: HTMLSpanElement | undefined;
  let linkElement: HTMLSpanElement | undefined;

  const errorButtons = () => <>
    <Show when={hasErrorDetails()}>
      <Button isIcon size="xs" tooltip="Request and response details" onClick={() => props.actions.showError(error()!)}>
        <FileSearch size={12} />
      </Button>
    </Show>
    <Button isIcon size="xs" tooltip="Retry upload" onClick={() => props.actions.retry()}>
      <RefreshCw size={12} />
    </Button>
  </>;

  return (
    <div
      class={styles.Card}
      classList={{ [styles.Enter]: props.entranceIndex !== null, [styles.Removing]: props.removing }}
      style={entranceStyle()}
      onContextMenu={event => { event.preventDefault(); props.actions.showMenu(event); }}
    >
      <div
        class={styles.Thumb}
        classList={{ [styles.Fit]: props.fitImage }}
        draggable="true"
        onDragStart={event => props.actions.startDrag(event)}
        onClick={() => props.actions.open()}
      >
        <Switch>
          <Match when={props.screenshot.type === "video"}>
            <VideoThumbnail screenshot={props.screenshot} />
            <div class={styles.Play}><Play size={16} /></div>
            <Show when={durationText()}>
              <span class={styles.Duration}><Video size={11} />{durationText()}</span>
            </Show>
          </Match>
          <Match when={props.screenshot.type === "file"}>
            <div class={styles.FilePlaceholder}>
              <File size={30} />
              <b>{extension()}</b>
            </div>
          </Match>
          <Match when={true}>
            <CardImage src={imageUrl()} fit={props.fitImage} />
          </Match>
        </Switch>

        <div class={styles.Quick}>
          <QuickButton tooltip={props.screenshot.type === "image" ? "Copy image" : "Copy file"} onClick={() => props.actions.copy()}>
            <Copy size={14} />
          </QuickButton>
          <QuickButton tooltip={props.screenshot.url ? "Upload again" : "Upload"} onClick={() => props.actions.upload()}>
            <CloudUpload size={14} />
          </QuickButton>
          <QuickButton tooltip="Show in folder" onClick={() => props.actions.showInFolder()}>
            <FolderOpen size={14} />
          </QuickButton>
          <QuickButton
            tooltip="More"
            onClick={event => {
              const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
              props.actions.showMenu(event, { x: rect.right - 220, y: rect.bottom + 4 });
            }}
          >
            <Ellipsis size={14} />
          </QuickButton>
        </div>

        <Show when={props.flash} keyed>
          {message => <span class={styles.FlashChip} data-keep-motion><CircleCheck size={12} />{message}</span>}
        </Show>

        <Show when={uploading() || props.upload.success}>
          <div class={styles.UploadBar} classList={{ [styles.Done]: !uploading() }}>
            <i style={{ width: `${uploading() ? percent() : 100}%` }} />
          </div>
        </Show>
      </div>

      <div class={styles.Meta}>
        <div class={styles.Name} title={props.screenshot.fileName}>{props.screenshot.fileName}</div>
        <div class={styles.Sub}>{dateText()}<Show when={sizeText()}> · {sizeText()}</Show></div>
        <Show when={hasSourceLine()}>
          <div class={styles.Line}>
            <Show when={source()} fallback={<span class={styles.Faint}>Imported file</span>}>
              {window => <>
                <span class={styles.SourceDot} style={{ "background-color": color() }} />
                <span class={styles.Text} title={`${window().process} · ${window().name}`}>{window().name}</span>
              </>}
            </Show>
          </div>
        </Show>
        <div class={styles.Line} classList={{ [styles.Error]: !!error() }}>
          <Show
            when={props.screenshot.url}
            fallback={
              <Switch>
                <Match when={uploading()}>
                  <Spinner size="sm" />
                  <span class={styles.Text}>Uploading {percent()}%</span>
                </Match>
                <Match when={error()}>
                  <TriangleAlert size={13} class={styles.ErrorIcon} />
                  <span class={styles.Text} title={errorText()}>{errorText()}</span>
                  {errorButtons()}
                </Match>
              </Switch>
            }
          >
            <Link size={12} class={styles.LinkIcon} />
            <span ref={linkElement} class={`${styles.Text} ${styles.Link}`} onClick={() => props.actions.copyLink()}>{linkText()}</span>
            <Tooltip anchor={() => linkElement} text="Copy link" />
            <Switch>
              <Match when={uploading()}>
                <span class={styles.State}><Spinner size="sm" />{percent()}%</span>
              </Match>
              <Match when={props.upload.success}>
                {success => <span class={`${styles.State} ${styles.Ok}`}><CircleCheck size={13} />{success().copied ? "Copied" : "Uploaded"}</span>}
              </Match>
              <Match when={error()}>
                <span ref={warningIcon} class={`${styles.State} ${styles.ErrorIcon}`}><TriangleAlert size={13} /></span>
                <Tooltip anchor={() => warningIcon} text={errorText()} />
                {errorButtons()}
              </Match>
            </Switch>
          </Show>
        </div>
      </div>
    </div>
  );
}

export default HistoryCard;
