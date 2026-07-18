import { createMemo, createSignal, createEffect, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import styles from "./Main.module.scss";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Event as TauriEvent } from "@tauri-apps/api/event";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import { HistoryCursor, HistorySort, ImageHistoryData, TagMetadata, TagValue, UploadFailedEvent, UploadFinishedEvent, UploadProgressEvent, UploadStartedEvent } from "../../types/screenshot";
import TagFilters from "./TagFilter/TagFilters";
import useTagFilterState, { augmentTags, matchTagsToFilter } from "../../states/tagFilterState";
import { onboardingJustFinished } from "../../states/onboardingState";
import Modal from "@core/components/Modal/Modal";
import Button from "@core/components/Button/Button";
import ImageViewer from "@core/components/ImageViewer/ImageViewer";
import SideNavItem from "@core/components/SideNav/SideNavItem";
import { useNavigate } from "@solidjs/router";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { describeUploaderError } from "@core/components/UploaderCreator/UploaderCreator";
import UploadErrorDetailsModal, { errorHasRequestDetails } from "@core/components/UploadErrorDetailsModal/UploadErrorDetailsModal";
import { UploaderCreationError } from "@core/types/request";
import { Camera, CloudUpload, Copy, ExternalLink, File, FileSearch, FileSymlink, FolderOpen, FolderSymlink, Link, Play, RefreshCw, Settings2, Trash2, Video } from "lucide-solid";
import pkg from "../../../package.json";
import useToastState from "@core/states/toastState";
import { LARGE_VIDEO_BYTES, generateVideoThumbnail } from "@core/helpers/videoThumbnail";
import { checkForUpdate } from "@core/helpers/updater";
import { formatSystemDateTime, loadSystemDateTimePatterns } from "@core/helpers/systemDateFormat";
import { useContextMenu } from "@core/components/ContextMenu/useContextMenu";
import ContextMenu from "@core/components/ContextMenu/ContextMenu";
import ContextMenuItem from "@core/components/ContextMenu/ContextMenuItem/ContextMenuItem";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

const PAGE_SIZE = 60;
const CARD_HEIGHT = 230;
const GAP = 12;
const ROW_HEIGHT = CARD_HEIGHT + GAP;
const MIN_COL_WIDTH = 210;
const OVERSCAN_ROWS = 3;

function Main() {
  const [items, setItems] = createStore<Array<ImageHistoryData>>([]);
  const [total, setTotal] = createSignal(0);
  const [sort, setSort] = createSignal<HistorySort>({ field: "date", direction: "desc" });
  const [loading, setLoading] = createSignal(true);
  const [metadata, setMetadata] = createSignal<TagMetadata | null>(null);
  const [preview, setPreview] = createSignal<ImageHistoryData | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal<ImageHistoryData | null>(null);
  const [pendingReupload, setPendingReupload] = createSignal<ImageHistoryData | null>(null);
  const [viewingUploadError, setViewingUploadError] = createSignal<UploaderCreationError | null>(null);
  const [cardStatus, setCardStatus] = createStore<{ [fileName: string]: string | undefined }>({});
  const statusTimers: { [fileName: string]: number } = {};
  // Live upload state , driven entirely by backend events so status is correct
  // whether this window was open when the upload started or not.
  const [uploadProgress, setUploadProgress] = createStore<{ [fileName: string]: { sent: number, total: number } | undefined }>({});
  const [uploadSuccess, setUploadSuccess] = createStore<{ [fileName: string]: { copied: boolean } | undefined }>({});
  const uploadSuccessTimers: { [fileName: string]: number } = {};
  const { root } = useTagFilterState;
  const { pushToast } = useToastState;
  const navigate = useNavigate();

  const [viewportWidth, setViewportWidth] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  // The filters panel scrolls with the grid, so row math subtracts its height.
  const [headerHeight, setHeaderHeight] = createSignal(0);
  let scrollEl: HTMLDivElement | undefined;
  let filtersEl: HTMLDivElement | undefined;

  const filterActive = createMemo(() => root.children.length > 0);

  const columns = createMemo(() => Math.max(1, Math.floor((viewportWidth() + GAP) / (MIN_COL_WIDTH + GAP))));
  const loadedRows = createMemo(() => Math.ceil(items.length / columns()));
  const totalHeight = createMemo(() => loadedRows() * ROW_HEIGHT);
  const contentScrollTop = createMemo(() => Math.max(0, scrollTop() - headerHeight()));
  const startRow = createMemo(() => Math.max(0, Math.floor(contentScrollTop() / ROW_HEIGHT) - OVERSCAN_ROWS));
  const endRow = createMemo(() =>
    Math.min(loadedRows(), Math.ceil((contentScrollTop() + viewportHeight()) / ROW_HEIGHT) + OVERSCAN_ROWS),
  );
  const visibleItems = createMemo(() => items.slice(startRow() * columns(), endRow() * columns()));
  const offsetY = createMemo(() => startRow() * ROW_HEIGHT);

  // A reload bumps this; in-flight appends whose token is stale are discarded.
  let requestToken = 0;
  let filterTimer: number | undefined;
  // Keyset cursor of the last loaded row; the backend only counts on the
  // first (cursor-less) page.
  let nextCursor: HistoryCursor | null = null;

  function currentFilter() {
    return JSON.parse(JSON.stringify(unwrap(root)));
  }

  async function reload() {
    const token = ++requestToken;
    setLoading(true);
    try {
      const page = await safeInvoke("query_history", { filter: currentFilter(), sort: sort(), cursor: null, limit: PAGE_SIZE });
      if (token !== requestToken) return;
      setTotal(page.total ?? 0);
      nextCursor = page.nextCursor;
      setItems(reconcile(page.items, { key: "fileName" }));
      if (scrollEl) scrollEl.scrollTop = 0;
      setScrollTop(0);
    } catch (error) {
      if (token === requestToken) pushToast(`Failed to load screenshots: ${errorText(error)}`, "error", 6000);
    } finally {
      if (token === requestToken) setLoading(false);
    }
  }

  async function loadMore() {
    if (loading() || nextCursor === null || items.length >= total()) return;
    const token = requestToken;
    setLoading(true);
    try {
      const page = await safeInvoke("query_history", { filter: currentFilter(), sort: sort(), cursor: nextCursor, limit: PAGE_SIZE });
      if (token !== requestToken) return;
      nextCursor = page.nextCursor;
      setItems(produce(list => list.push(...page.items)));
    } catch (error) {
      if (token === requestToken) pushToast(`Failed to load screenshots: ${errorText(error)}`, "error", 6000);
    } finally {
      if (token === requestToken) setLoading(false);
    }
  }

  // Re-query (debounced) whenever the filter tree changes.
  createEffect(on(() => JSON.stringify(root), () => {
    clearTimeout(filterTimer);
    filterTimer = window.setTimeout(reload, 250);
  }, { defer: true }));

  createEffect(on(sort, reload, { defer: true }));

  // Keep filling while the loaded content is shorter than the viewport.
  createEffect(() => {
    if (!loading() && viewportHeight() > 0 && headerHeight() + totalHeight() <= viewportHeight() && items.length < total()) {
      loadMore();
    }
  });

  onMount(async () => {
    loadSystemDateTimePatterns();

    // Real gate: only ever show onboarding once. Left active so the flow
    // itself works end-to-end; it's `onboardingJustFinished` (not this
    // check) that's currently the workaround , see its own comment.
    const general = await safeInvoke("get_general_settings");
    if (!general.hasCompletedOnboarding && !onboardingJustFinished()) {
      navigate("/onboarding", { replace: true });
      return;
    }

    if (general.checkForUpdatesOnStartup) {
      checkForUpdate()
        .then(update => {
          if (update) pushToast(`Update available: v${update.version} , see Settings → Updates`, "info", 8000);
        })
        .catch(error => console.error("Failed to check for updates", error));
    }

    if (scrollEl) {
      const observer = new ResizeObserver(entries => {
        const rect = entries[0].contentRect;
        setViewportWidth(rect.width);
        setViewportHeight(rect.height);
      });
      observer.observe(scrollEl);
      onCleanup(() => observer.disconnect());
    }

    if (filtersEl) {
      const filtersObserver = new ResizeObserver(() => setHeaderHeight(filtersEl!.offsetHeight));
      filtersObserver.observe(filtersEl);
      onCleanup(() => filtersObserver.disconnect());
    }

    // Tag metadata is a full-table scan; load it in parallel so it never blocks
    // the (fast, indexed) first page of screenshots or the filter-less initial paint.
    safeInvoke("get_tag_metadata")
      .then(setMetadata)
      .catch(error => console.error("Failed to load tag metadata", error));

    const unlistenSaved = await getCurrentWebview().listen("screenshot://new-saved-image", (event: TauriEvent<ImageHistoryData>) => {
      // A filter being active doesn't mean the new item is excluded , check
      // it against the current filter tree instead of always hiding it.
      const { fileName, filePath, type, dateTime, tags } = event.payload;
      const augmented = augmentTags(tags, fileName, filePath, type, new Date(dateTime).getTime());
      if (matchTagsToFilter(root, augmented)) {
        setItems(produce(screenshots => screenshots.unshift(event.payload)));
        setTotal(current => current + 1);
      }
      pushToast("Saved to history", "success", 3000);
    });
    onCleanup(() => unlistenSaved());

    const unlistenUploadStarted = await getCurrentWebview().listen("upload://started", (event: TauriEvent<UploadStartedEvent>) => {
      clearTimeout(uploadSuccessTimers[event.payload.fileName]);
      setUploadSuccess(event.payload.fileName, undefined);
      setUploadProgress(event.payload.fileName, { sent: 0, total: 0 });
    });
    onCleanup(() => unlistenUploadStarted());

    const unlistenUploadProgress = await getCurrentWebview().listen("upload://progress", (event: TauriEvent<UploadProgressEvent>) => {
      setUploadProgress(event.payload.fileName, { sent: event.payload.sent, total: event.payload.total });
    });
    onCleanup(() => unlistenUploadProgress());

    const unlistenUploadFinished = await getCurrentWebview().listen("upload://finished", (event: TauriEvent<UploadFinishedEvent>) => {
      const { fileName, url, copied } = event.payload;
      setUploadProgress(fileName, undefined);
      updateItem(fileName, entry => { entry.url = url; entry.uploadError = undefined; });
      setUploadSuccess(fileName, { copied });
      clearTimeout(uploadSuccessTimers[fileName]);
      uploadSuccessTimers[fileName] = window.setTimeout(() => setUploadSuccess(fileName, undefined), 4000);
    });
    onCleanup(() => unlistenUploadFinished());

    const unlistenUploadFailed = await getCurrentWebview().listen("upload://failed", (event: TauriEvent<UploadFailedEvent>) => {
      const { fileName, error } = event.payload;
      setUploadProgress(fileName, undefined);
      updateItem(fileName, entry => { entry.uploadError = error; });
    });
    onCleanup(() => unlistenUploadFailed());

    // Dropping files anywhere on the window imports them (the backend copies each
    // file in and emits `screenshot://new-saved-image`, handled above).
    const unlistenDrop = await getCurrentWebview().onDragDropEvent(event => {
      if (event.payload.type === "drop") importPaths(event.payload.paths);
    });
    onCleanup(() => unlistenDrop());

    // Autostart launches this window hidden (tray-only); a manual launch
    // (including the very first one, before autostart is ever enabled) shows it.
    const launchedViaAutostart = await safeInvoke("was_launched_via_autostart", undefined);
    if (!launchedViaAutostart) await getCurrentWebview().window.show();
    await reload();
  });

  async function importPaths(paths: string[]) {
    for (const path of paths) {
      try {
        await safeInvoke("import_file", { path });
      } catch (error) {
        pushToast(`Failed to import ${path}: ${errorText(error)}`, "error", 6000);
      }
    }
  }

  function onScroll(event: Event & { currentTarget: HTMLDivElement }) {
    const el = event.currentTarget;
    setScrollTop(el.scrollTop);
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_HEIGHT * 3) {
      loadMore();
    }
  }

  function flashStatus(fileName: string, message: string, clearAfterMs = 3000) {
    clearTimeout(statusTimers[fileName]);
    setCardStatus(fileName, message);

    if (clearAfterMs > 0) {
      statusTimers[fileName] = window.setTimeout(() => setCardStatus(fileName, undefined), clearAfterMs);
    }
  }

  function errorText(error: unknown): string {
    return typeof error === "string" ? error : describeUploaderError(error);
  }

  function sourceWindow(screenshot: ImageHistoryData): string | null {
    const windows = screenshot.tags?.["Windows"];
    if (!Array.isArray(windows)) return null;

    let bestName: string | null = null;
    let bestPercentage = -1;

    for (const entry of windows) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;

      const record = entry as { [key: string]: TagValue };
      const name = record["Window Name"];
      const percentage = record["Screenshot Percentage"];

      if (typeof name !== "string") continue;

      const value = typeof percentage === "number" ? percentage : 0;
      if (value > bestPercentage) {
        bestPercentage = value;
        bestName = name;
      }
    }

    return bestName;
  }

  function savedUrl(fileName: string): string {
    return `http://rosemyne-photo.localhost/saved/${fileName}`;
  }

  function VideoCard(props: { screenshot: ImageHistoryData }) {
    const [display, setDisplay] = createSignal<"thumb" | "video" | "placeholder">("thumb");
    const [thumbVersion, setThumbVersion] = createSignal(0);
    let triedGenerating = false;

    async function onThumbnailMissing() {
      if (triedGenerating) {
        setDisplay(videoFallbackAllowed() ? "video" : "placeholder");
        return;
      }
      triedGenerating = true;

      // While the thumbnail generates, small files may show the (now cheap,
      // Range-streamed) video element directly; large ones get a placeholder.
      setDisplay(videoFallbackAllowed() ? "video" : "placeholder");

      if (await generateVideoThumbnail(props.screenshot.fileName)) {
        setThumbVersion(version => version + 1);
        setDisplay("thumb");
      }
    }

    function videoFallbackAllowed() {
      return (props.screenshot.fileSize ?? 0) <= LARGE_VIDEO_BYTES;
    }

    return <Switch>
      <Match when={display() === "thumb"}>
        <img
          src={`http://rosemyne-photo.localhost/thumb/${props.screenshot.fileName}?v=${thumbVersion()}`}
          loading="lazy"
          onError={onThumbnailMissing}
        />
      </Match>
      <Match when={display() === "video"}>
        <video src={savedUrl(props.screenshot.fileName)} preload="metadata" muted />
      </Match>
      <Match when={true}>
        <div class={styles.FilePlaceholder}>
          <Play size={40} />
          <span>{fileExt(props.screenshot.fileName)}</span>
        </div>
      </Match>
    </Switch>;
  }

  function fileExt(fileName: string): string {
    const dot = fileName.lastIndexOf(".");
    return dot >= 0 ? fileName.slice(dot + 1).toUpperCase() : "FILE";
  }

  function updateItem(fileName: string, update: (entry: ImageHistoryData) => void) {
    setItems(produce(screenshots => {
      const entry = screenshots.find(e => e.fileName === fileName);
      if (entry) update(entry);
    }));
  }

  async function copyImage(screenshot: ImageHistoryData) {
    try {
      await safeInvoke("copy_screenshot_to_clipboard", { fileName: screenshot.fileName });
      flashStatus(screenshot.fileName, "Copied to clipboard");
    } catch (error) {
      flashStatus(screenshot.fileName, errorText(error));
    }
  }

  async function copyLink(screenshot: ImageHistoryData) {
    if (!screenshot.url) return;

    try {
      await safeInvoke("copy_text_to_clipboard", { text: screenshot.url });
      flashStatus(screenshot.fileName, "Link copied");
    } catch (error) {
      flashStatus(screenshot.fileName, errorText(error));
    }
  }

  async function copyFile(screenshot: ImageHistoryData) {
    try {
      await safeInvoke("copy_file_to_clipboard", { fileName: screenshot.fileName });
      flashStatus(screenshot.fileName, "File copied to clipboard");
    } catch (error) {
      flashStatus(screenshot.fileName, errorText(error));
    }
  }

  // Fire-and-forget: the backend persists and broadcasts progress/success/failure
  // via `upload://*` events (handled in onMount) whether this window is open or
  // not, so there's nothing to await or reflect here beyond starting the request.
  function uploadImage(screenshot: ImageHistoryData) {
    safeInvoke("upload_image", { fileName: screenshot.fileName }).catch(() => { });
  }

  // Skip the browser's own HTML5 drag ghost and hand the OS a real native file
  // drag instead, so dropping onto Explorer/Discord/etc. drops the actual file.
  async function startFileDrag(event: DragEvent, screenshot: ImageHistoryData) {
    event.preventDefault();

    // The backend renders a small preview from the actual image/thumbnail;
    // fall back to the raw file (no custom preview, just the OS default
    // cursor) for videos without a thumbnail yet or plain imported files.
    const icon = await safeInvoke("get_drag_icon", { fileName: screenshot.fileName }).catch(() => null);
    startDrag({ item: [screenshot.filePath], icon: icon ?? screenshot.filePath }).catch(() => { });
  }

  // Uploading again would overwrite the previously saved link, so confirm first
  // when one already exists.
  function requestUpload(screenshot: ImageHistoryData) {
    if (screenshot.url) {
      setPendingReupload(screenshot);
    } else {
      uploadImage(screenshot);
    }
  }

  async function openFolder(screenshot: ImageHistoryData) {
    try {
      await safeInvoke("show_in_folder", { fileName: screenshot.fileName });
    } catch (error) {
      flashStatus(screenshot.fileName, errorText(error));
    }
  }

  async function openFile(screenshot: ImageHistoryData) {
    try {
      await safeInvoke("open_file", { fileName: screenshot.fileName });
    } catch (error) {
      flashStatus(screenshot.fileName, errorText(error));
    }
  }

  async function copyFullPath(screenshot: ImageHistoryData) {
    try {
      await safeInvoke("copy_text_to_clipboard", { text: screenshot.filePath });
      flashStatus(screenshot.fileName, "Path copied");
    } catch (error) {
      flashStatus(screenshot.fileName, errorText(error));
    }
  }

  async function copyFolderPath(screenshot: ImageHistoryData) {
    try {
      await safeInvoke("copy_text_to_clipboard", { text: folderPath(screenshot.filePath) });
      flashStatus(screenshot.fileName, "Folder path copied");
    } catch (error) {
      flashStatus(screenshot.fileName, errorText(error));
    }
  }

  function folderPath(filePath: string): string {
    const cut = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    return cut >= 0 ? filePath.slice(0, cut) : filePath;
  }

  async function deleteImage(screenshot: ImageHistoryData) {
    setPendingDelete(null);

    try {
      await safeInvoke("delete_screenshot", { fileName: screenshot.fileName });
      setItems(items.filter(e => e.fileName !== screenshot.fileName));
      setTotal(current => Math.max(0, current - 1));
    } catch (error) {
      flashStatus(screenshot.fileName, errorText(error));
    }
  }

  async function takeScreenshot() {
    try {
      await safeInvoke('full_screenshot');
    } catch (error) {
      pushToast(`Failed to take screenshot: ${errorText(error)}`, "error", 6000);
    }
  }

  async function recordScreen() {
    try {
      await safeInvoke('record_screen');
    } catch (error) {
      pushToast(`Failed to start recording: ${errorText(error)}`, "error", 6000);
    }
  }

  return <div class={styles.Main}>
    <div class={styles.SideBar}>
      <div class={styles.Brand}>
        <img src="/icon.svg" alt="" />
        <span>Rosemyne</span>
      </div>
      <div class={styles.Actions}>
        <Button filled color="var(--base-blue)" onClick={takeScreenshot}>
          <Camera size={16} />
          Take Screenshot
        </Button>
        <Button filled color="var(--base-blue)" onClick={recordScreen}>
          <Video size={16} />
          Record Screen
        </Button>
      </div>
      <div class={styles.SettingsRow}>
        <SideNavItem icon={<Settings2 />} onClick={() => navigate("/settings/general")}>
          Settings
        </SideNavItem>
      </div>
      <div class={styles.Footer}>v{pkg.version}</div>
    </div>
    <div class={styles.Content}>
      <div class={styles.ScreenshotListing} ref={scrollEl} onScroll={onScroll}>
        <div class={styles.FiltersHeader} ref={filtersEl}>
          <Show when={metadata()}>
            {meta => <TagFilters tagMap={meta().schema} sort={sort()} onSortChange={setSort} />}
          </Show>
        </div>
        <Show when={items.length > 0} fallback={
          <Show when={loading()} fallback={
            <div class={styles.EmptyState}>
              <span>{filterActive() ? "No screenshots match the filter" : "No screenshots yet"}</span>
              <Show when={!filterActive()}>
                <span>Press the Screenshot button or your shortcut to take one.</span>
              </Show>
            </div>
          }>
            <div class={styles.CenterLoader}><div class={styles.Spinner} /></div>
          </Show>
        }>
          <div class={styles.Viewport} style={{ height: `${totalHeight()}px` }}>
            <div
              class={styles.Grid}
              style={{
                transform: `translateY(${offsetY()}px)`,
                "grid-template-columns": `repeat(${columns()}, minmax(0, 1fr))`,
              }}
            >
              <For each={visibleItems()}>
                {screenshot => {
                  const { show: showContextMenu, id: menuId } = useContextMenu();

                  return <>
                    <div
                      class={styles.Screenshot}
                      onContextMenu={event => { event.preventDefault(); showContextMenu(event); }}
                    >
                      <div
                        class={styles.ImageWrap}
                        draggable="true"
                        onDragStart={event => startFileDrag(event, screenshot)}
                        onClick={() => setPreview(screenshot)}
                      >
                        <Switch>
                          <Match when={screenshot.type === "video"}>
                            <VideoCard screenshot={screenshot} />
                            <div class={styles.PlayBadge}><Play size={24} /></div>
                          </Match>
                          <Match when={screenshot.type === "file"}>
                            <div class={styles.FilePlaceholder}>
                              <File size={40} />
                              <span>{fileExt(screenshot.fileName)}</span>
                            </div>
                          </Match>
                          <Match when={true}>
                            <img src={savedUrl(screenshot.fileName)} loading="lazy" />
                          </Match>
                        </Switch>
                      </div>
                      <div class={styles.Meta}>
                        <div class={styles.NameRow}>
                          <div class={styles.FileName} title={screenshot.fileName}>{screenshot.fileName}</div>
                          <Button
                            isIcon
                            tooltip={screenshot.type === "image" ? "Copy image" : "Copy file"}
                            style={{ height: '22px', width: '22px', 'min-width': '22px' }}
                            onClick={() => screenshot.type === "image" ? copyImage(screenshot) : copyFile(screenshot)}
                          >
                            <Copy size={14} />
                          </Button>
                        </div>
                        <div class={styles.Date}>{formatSystemDateTime(new Date(screenshot.dateTime))}</div>
                        <Show when={sourceWindow(screenshot)}>
                          {name => <div class={styles.Tag} title={name()}>{name()}</div>}
                        </Show>
                        <Show when={screenshot.url}>
                          {url => <div class={styles.UploadedRow}>
                            <a class={styles.UploadedLink} href={url()} target="_blank" title={url()}>{url()}</a>
                            <Button
                              isIcon
                              tooltip="Copy link"
                              style={{ height: '22px', width: '22px', 'min-width': '22px' }}
                              onClick={() => copyLink(screenshot)}
                            >
                              <Link size={13} />
                            </Button>
                          </div>}
                        </Show>
                        <Show when={cardStatus[screenshot.fileName]}>
                          <div class={styles.Status}>{cardStatus[screenshot.fileName]}</div>
                        </Show>
                        <Switch>
                          <Match when={uploadProgress[screenshot.fileName]}>
                            {progress => {
                              const percent = createMemo(() => progress().total > 0 ? Math.round((progress().sent / progress().total) * 100) : null);
                              return <div class={styles.UploadBar}>
                                <div class={styles.UploadTrack}>
                                  <div
                                    class={styles.UploadFill}
                                    classList={{ [styles.Indeterminate]: percent() === null }}
                                    style={percent() !== null ? { width: `${percent()}%` } : undefined}
                                  />
                                </div>
                                <span class={styles.UploadLabel}>{percent() !== null ? `Uploading ${percent()}%` : "Uploading…"}</span>
                              </div>;
                            }}
                          </Match>
                          <Match when={uploadSuccess[screenshot.fileName]}>
                            {success => <div class={styles.UploadBar} classList={{ [styles.Success]: true }}>
                              <div class={styles.UploadTrack}><div class={styles.UploadFill} style={{ width: "100%" }} /></div>
                              <span class={styles.UploadLabel}>{success().copied ? "Uploaded , link copied" : "Uploaded , copy failed"}</span>
                            </div>}
                          </Match>
                          <Match when={screenshot.uploadError}>
                            {error => <div class={styles.UploadBar} classList={{ [styles.Failed]: true }}>
                              <div class={styles.UploadTrack}><div class={styles.UploadFill} style={{ width: "100%" }} /></div>
                              <span class={styles.UploadLabel} title={describeUploaderError(error())}>{describeUploaderError(error())}</span>
                              <Show when={errorHasRequestDetails(error())}>
                                <Button
                                  isIcon
                                  tooltip="View request/response details"
                                  style={{ height: '20px', width: '20px', 'min-width': '20px' }}
                                  onClick={() => setViewingUploadError(error())}
                                >
                                  <FileSearch size={12} />
                                </Button>
                              </Show>
                              <Button
                                isIcon
                                tooltip="Retry upload"
                                style={{ height: '20px', width: '20px', 'min-width': '20px' }}
                                onClick={() => uploadImage(screenshot)}
                              >
                                <RefreshCw size={12} />
                              </Button>
                            </div>}
                          </Match>
                        </Switch>
                      </div>
                    </div>
                    <ContextMenu id={menuId} styles={{ width: "220px" }}>
                      <Show when={screenshot.type === "image"} fallback={
                        <ContextMenuItem icon={{ icon: Copy }} onClick={() => copyFile(screenshot)}>Copy File</ContextMenuItem>
                      }>
                        <ContextMenuItem icon={{ icon: Copy }} onClick={() => copyImage(screenshot)}>Copy Image</ContextMenuItem>
                      </Show>
                      <ContextMenuItem icon={{ icon: Link }} disabled={!screenshot.url} onClick={() => copyLink(screenshot)}>Copy Link</ContextMenuItem>
                      <ContextMenuItem icon={{ icon: CloudUpload }} onClick={() => requestUpload(screenshot)}>{screenshot.url ? "Re-upload" : "Upload"}</ContextMenuItem>
                      <div class={styles.Divider} />
                      <ContextMenuItem icon={{ icon: ExternalLink }} onClick={() => openFile(screenshot)}>Open File</ContextMenuItem>
                      <ContextMenuItem icon={{ icon: FolderOpen }} onClick={() => openFolder(screenshot)}>Open Containing Folder</ContextMenuItem>
                      <div class={styles.Divider} />
                      <ContextMenuItem icon={{ icon: FileSymlink }} onClick={() => copyFullPath(screenshot)}>Copy Full Path</ContextMenuItem>
                      <ContextMenuItem icon={{ icon: FolderSymlink }} onClick={() => copyFolderPath(screenshot)}>Copy Folder Path</ContextMenuItem>
                      <div class={styles.Divider} />
                      <ContextMenuItem icon={{ icon: Trash2 }} danger onClick={() => setPendingDelete(screenshot)}>Delete</ContextMenuItem>
                    </ContextMenu>
                  </>;
                }}
              </For>
            </div>
          </div>
          <Show when={loading()}>
            <div class={styles.MoreLoader}><div class={styles.Spinner} /></div>
          </Show>
        </Show>
      </div>
    </div>
    <Modal show={!!preview()} onHide={() => setPreview(null)} title={preview()?.fileName} width="85%" height="85%">
      <Show when={preview()} keyed>
        {screenshot => <div class={styles.PreviewBody}>
          <Switch>
            <Match when={screenshot.type === "video"}>
              <video src={savedUrl(screenshot.fileName)} controls autoplay />
            </Match>
            <Match when={screenshot.type === "file"}>
              <div class={styles.FilePreview}>
                <File size={72} />
                <span>{screenshot.fileName}</span>
                <Button onClick={() => openFolder(screenshot)}>Show in folder</Button>
              </div>
            </Match>
            <Match when={true}>
              <ImageViewer src={savedUrl(screenshot.fileName)} />
            </Match>
          </Switch>
        </div>}
      </Show>
    </Modal>
    <Modal show={!!pendingDelete()} onHide={() => setPendingDelete(null)} title="Delete screenshot?" width={420}>
      <div class={styles.ConfirmBody}>
        <p>"{pendingDelete()?.fileName}" will be removed from disk and history.</p>
        <div class={styles.ConfirmActions}>
          <Button color="var(--danger-color)" onClick={() => deleteImage(pendingDelete()!)}>Delete</Button>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
        </div>
      </div>
    </Modal>
    <Modal show={!!pendingReupload()} onHide={() => setPendingReupload(null)} title="Upload again?" width={420}>
      <div class={styles.ConfirmBody}>
        <p>"{pendingReupload()?.fileName}" already has an uploaded link. Uploading again will replace it.</p>
        <div class={styles.ConfirmActions}>
          <Button color="var(--base-blue)" onClick={() => { uploadImage(pendingReupload()!); setPendingReupload(null); }}>Upload</Button>
          <Button onClick={() => setPendingReupload(null)}>Cancel</Button>
        </div>
      </div>
    </Modal>
    <UploadErrorDetailsModal
      show={!!viewingUploadError()}
      onHide={() => setViewingUploadError(null)}
      error={viewingUploadError() ?? undefined}
    />
  </div>
}

export default Main;
