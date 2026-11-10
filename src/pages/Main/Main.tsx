import { createMemo, createSignal, createEffect, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import styles from "./Main.module.scss";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Event as TauriEvent } from "@tauri-apps/api/event";
import { createStore, produce, reconcile } from "solid-js/store";
import { HistoryCursor, HistorySort, HistoryTypeCounts, ImageEditSession, ImageHistoryData, ImportFailedEvent, TagMetadata, UploadFailedEvent, UploadFinishedEvent, UploadProgressEvent, UploadStartedEvent } from "../../types/screenshot";
import { ImageViewerApi, ShortcutBinding } from "../../types";
import { saveScreenshot } from "@core/helpers/saveScreenshot";
import { overrideCount } from "@core/helpers/captureOverrides";
import TagFilters from "./TagFilter/TagFilters";
import FilterToolbar from "./TagFilter/FilterToolbar/FilterToolbar";
import FilterPills from "./TagFilter/FilterPills/FilterPills";
import useTagFilterState, { augmentTags, matchTagsToFilter } from "../../states/tagFilterState";
import { onboardingJustFinished } from "../../states/onboardingState";
import useSettingsState from "@core/states/settingsState";
import Modal from "@core/components/Modal/Modal";
import Button from "@core/components/Button/Button";
import ImageViewer from "@core/components/ImageViewer/ImageViewer";
import SideNavItem from "@core/components/SideNav/SideNavItem";
import Tooltip from "@core/components/Tooltip/Tooltip";
import EmptyState from "@core/components/EmptyState/EmptyState";
import Skeleton from "@core/components/Skeleton/Skeleton";
import KeyRenderer from "@core/components/KeyRenderer/KeyRenderer";
import { Spinner } from "@core/components/Progress/Progress";
import { useNavigate } from "@solidjs/router";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import UploadErrorDetailsModal from "@core/components/UploadErrorDetailsModal/UploadErrorDetailsModal";
import { UploaderCreationError } from "@core/types/request";
import { Camera, CloudUpload, Copy, ExternalLink, File, FileSymlink, FolderOpen, FolderSymlink, Import, Link, LucideIcon, Pencil, ScrollText, SearchX, Settings2, Tag, Trash2, Video } from "lucide-solid";
import pkg from "../../../package.json";
import useToastState from "@core/states/toastState";
import { checkForUpdate } from "@core/helpers/updater";
import { loadSystemDateTimePatterns } from "@core/helpers/systemDateFormat";
import { useContextMenu } from "@core/components/ContextMenu/useContextMenu";
import ContextMenu, { ContextMenuSeparator } from "@core/components/ContextMenu/ContextMenu";
import ContextMenuItem from "@core/components/ContextMenu/ContextMenuItem/ContextMenuItem";
import { startFileDrag } from "@core/helpers/fileDrag";
import TagEditorModal from "./TagEditor/TagEditorModal";
import HistoryCard, { savedUrl } from "./HistoryCard/HistoryCard";

const PAGE_SIZE = 60;
const CARD_HEIGHT = 230;
const GAP = 12;
const ROW_HEIGHT = CARD_HEIGHT + GAP;
const MIN_COL_WIDTH = 210;
const OVERSCAN_ROWS = 3;
const SKELETON_CARDS = 15;
const FLASH_MS = 2600;
const ENTRANCE_MS = 700;
const REMOVE_MS = 220;
const EMPTY_COUNTS: HistoryTypeCounts = { image: 0, video: 0, file: 0 };

type UpdateStatus = { kind: "upToDate" } | { kind: "available", version: string } | null;

// Main remounts on every return from Settings, but the startup check runs once per session.
let startupUpdateCheck: ReturnType<typeof checkForUpdate> | undefined;

function CaptureButton(props: { icon: LucideIcon, label: string, tooltip: string, keys: string[] | undefined, primary?: boolean, onClick: () => void }) {
  let button: HTMLButtonElement | undefined;

  return (
    <button ref={button} type="button" class={styles.Capture} classList={{ [styles.Primary]: props.primary ?? false }} onClick={() => props.onClick()}>
      <span class={styles.Tile}><props.icon size={17} /></span>
      <b>{props.label}</b>
      <Tooltip anchor={() => button} text={props.tooltip} keys={props.keys} />
    </button>
  );
}

// The buttons run with the plain settings, so they show a shortcut without overrides when there is one.
function plainBinding(bindings: ShortcutBinding[], type: ShortcutBinding["method"]["type"]): ShortcutBinding | undefined {
  const matching = bindings.filter(binding => binding.method.type === type);
  return matching.find(binding => overrideCount(binding.overrides) === 0) ?? matching[0];
}

function shortcutChars(binding: ShortcutBinding | undefined): string[] | undefined {
  const keys = binding?.keys.keys.map(key => key.char);
  return keys && keys.length > 0 ? keys : undefined;
}

function Main() {
  const [items, setItems] = createStore<Array<ImageHistoryData>>([]);
  const [counts, setCounts] = createStore<HistoryTypeCounts>({ ...EMPTY_COUNTS });
  const [chipCounts, setChipCounts] = createStore<HistoryTypeCounts>({ ...EMPTY_COUNTS });
  const [sort, setSort] = createSignal<HistorySort>({ field: "date", direction: "desc" });
  const [loading, setLoading] = createSignal(true);
  const [metadata, setMetadata] = createSignal<TagMetadata | null>(null);
  const [preview, setPreview] = createSignal<ImageHistoryData | null>(null);
  const [editSession, setEditSession] = createSignal<ImageEditSession | null>(null);
  let editViewerApi: ImageViewerApi | undefined;
  const [pendingDelete, setPendingDelete] = createSignal<ImageHistoryData | null>(null);
  const [pendingReupload, setPendingReupload] = createSignal<ImageHistoryData | null>(null);
  const [editingTags, setEditingTags] = createSignal<ImageHistoryData | null>(null);
  const [viewingUploadError, setViewingUploadError] = createSignal<UploaderCreationError | null>(null);
  const [cardFlash, setCardFlash] = createStore<{ [fileName: string]: string | undefined }>({});
  const flashTimers: { [fileName: string]: number } = {};
  // Driven by backend events, so status is right whether or not this window was open when the upload started.
  const [uploadProgress, setUploadProgress] = createStore<{ [fileName: string]: { sent: number, total: number } | undefined }>({});
  const [uploadSuccess, setUploadSuccess] = createStore<{ [fileName: string]: { copied: boolean } | undefined }>({});
  const uploadSuccessTimers: { [fileName: string]: number } = {};
  const [removing, setRemoving] = createStore<{ [fileName: string]: boolean | undefined }>({});
  const [animateEntrance, setAnimateEntrance] = createSignal(false);
  const [dropActive, setDropActive] = createSignal(false);
  const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus>(null);
  const [fitThumbnails, setFitThumbnails] = createSignal(false);
  const { root, quick, queryFilter, filtersOpen, anyFilterActive, clearFilter } = useTagFilterState;
  const { shortcuts } = useSettingsState;
  const { pushToast } = useToastState;
  const navigate = useNavigate();

  const [viewportWidth, setViewportWidth] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  // The filter header scrolls with the grid, so row math subtracts its height.
  const [headerHeight, setHeaderHeight] = createSignal(0);
  let scrollEl: HTMLDivElement | undefined;
  let filtersEl: HTMLDivElement | undefined;
  let entranceTimer: number | undefined;
  let draggingOwnCard = false;

  const total = createMemo(() => counts.image + counts.video + counts.file);
  const columns = createMemo(() => Math.max(1, Math.floor((viewportWidth() + GAP) / (MIN_COL_WIDTH + GAP))));
  const loadedRows = createMemo(() => Math.ceil(items.length / columns()));
  const totalHeight = createMemo(() => loadedRows() * ROW_HEIGHT);
  const contentScrollTop = createMemo(() => Math.max(0, scrollTop() - headerHeight()));
  const scrolled = createMemo(() => scrollTop() > 0);
  const startRow = createMemo(() => Math.max(0, Math.floor(contentScrollTop() / ROW_HEIGHT) - OVERSCAN_ROWS));
  const endRow = createMemo(() =>
    Math.min(loadedRows(), Math.ceil((contentScrollTop() + viewportHeight()) / ROW_HEIGHT) + OVERSCAN_ROWS),
  );
  const visibleItems = createMemo(() => items.slice(startRow() * columns(), endRow() * columns()));
  const offsetY = createMemo(() => startRow() * ROW_HEIGHT);
  const gridColumns = createMemo(() => `repeat(${columns()}, minmax(0, 1fr))`);

  const screenshotKeys = createMemo(() => shortcutChars(plainBinding(shortcuts, "screenshot")));
  const recordKeys = createMemo(() => shortcutChars(plainBinding(shortcuts, "record")));
  const scrollingKeys = createMemo(() => shortcutChars(plainBinding(shortcuts, "scrollingCapture")));
  const emptyKeys = createMemo(() => ({ keys: (screenshotKeys() ?? []).map(char => ({ key: char, char })) }));
  const updateTooltip = createMemo(() => {
    const status = updateStatus();
    if (!status) return undefined;
    return status.kind === "upToDate" ? "Up to date" : `Update available: v${status.version}`;
  });
  const showSkeleton = createMemo(() => loading() && items.length === 0);
  let footerEl: HTMLDivElement | undefined;

  // A reload bumps this, so in-flight appends whose token is stale get discarded.
  let requestToken = 0;
  let filterTimer: number | undefined;
  // Keyset cursor of the last loaded row. The backend only counts on the first, cursor-less page.
  let nextCursor: HistoryCursor | null = null;

  async function reload() {
    const token = ++requestToken;
    setLoading(true);
    try {
      const filter = queryFilter();
      // Each type chip's count reflects every other active filter, so it needs its own count without the type rule.
      const [page, chipPage] = await Promise.all([
        safeInvoke("query_history", { filter, sort: sort(), cursor: null, limit: PAGE_SIZE }),
        quick.types.length > 0
          ? safeInvoke("query_history", { filter: queryFilter(true), sort: sort(), cursor: null, limit: 1 })
          : Promise.resolve(null),
      ]);
      if (token !== requestToken) return;

      setCounts(page.counts ?? { ...EMPTY_COUNTS });
      setChipCounts((chipPage ?? page).counts ?? { ...EMPTY_COUNTS });
      nextCursor = page.nextCursor;
      setItems(reconcile(page.items, { key: "fileName" }));
      if (scrollEl) scrollEl.scrollTop = 0;
      setScrollTop(0);

      clearTimeout(entranceTimer);
      setAnimateEntrance(true);
      entranceTimer = window.setTimeout(() => setAnimateEntrance(false), ENTRANCE_MS);
    } catch (error) {
      if (token === requestToken) pushToast(`Failed to load captures: ${errorMessage(error)}`, "error", 6000);
    } finally {
      if (token === requestToken) setLoading(false);
    }
  }

  async function loadMore() {
    if (loading() || nextCursor === null || items.length >= total()) return;
    const token = requestToken;
    setLoading(true);
    try {
      const page = await safeInvoke("query_history", { filter: queryFilter(), sort: sort(), cursor: nextCursor, limit: PAGE_SIZE });
      if (token !== requestToken) return;
      nextCursor = page.nextCursor;
      setItems(produce(list => list.push(...page.items)));
    } catch (error) {
      if (token === requestToken) pushToast(`Failed to load captures: ${errorMessage(error)}`, "error", 6000);
    } finally {
      if (token === requestToken) setLoading(false);
    }
  }

  // Re-query (debounced) whenever the tree or a quick filter changes.
  createEffect(on(() => JSON.stringify({ root, quick }), () => {
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

  // onCleanup does nothing after an await, so async-registered listeners are released through this.
  const asyncCleanups: Array<() => void> = [];
  let unmounted = false;

  function releaseOnUnmount(cleanup: () => void) {
    if (unmounted) cleanup();
    else asyncCleanups.push(cleanup);
  }

  onCleanup(() => {
    unmounted = true;
    asyncCleanups.forEach(cleanup => cleanup());
    clearTimeout(filterTimer);
    clearTimeout(entranceTimer);
  });

  onMount(async () => {
    loadSystemDateTimePatterns();

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

    const [general, launchedInBackground] = await Promise.all([
      safeInvoke("get_general_settings"),
      safeInvoke("launched_in_background", undefined),
    ]);
    if (unmounted) return;
    if (!general.hasCompletedOnboarding && !onboardingJustFinished()) {
      navigate("/onboarding", { replace: true });
      return;
    }
    setFitThumbnails(general.fitCardThumbnails);

    // Autostart and context-menu imports launch this window hidden (tray only). A manual launch shows it.
    if (!launchedInBackground) getCurrentWebview().window.show();
    reload();
    refreshTagMetadata();

    if (general.checkForUpdatesOnStartup) {
      const firstCheck = !startupUpdateCheck;
      startupUpdateCheck ??= checkForUpdate();
      startupUpdateCheck
        .then(update => {
          if (unmounted) return;
          setUpdateStatus(update ? { kind: "available", version: update.version } : { kind: "upToDate" });
          if (update && firstCheck) pushToast(`Update available: v${update.version}, see Settings › Updates`, "info", 8000);
        })
        .catch(error => console.error("Failed to check for updates", error));
    }

    const unlisteners = await Promise.all([listenSaved(), listenUploads(), listenDrop(), listenImportFailed()]);
    unlisteners.flat().forEach(releaseOnUnmount);
  });

  function listenSaved() {
    return getCurrentWebview().listen("screenshot://new-saved-image", (event: TauriEvent<ImageHistoryData>) => {
      // An active filter doesn't mean the new item is excluded, so check it against the filter.
      const { fileName, filePath, type, dateTime, tags, fileSize } = event.payload;
      const augmented = augmentTags(tags, fileName, filePath, type, new Date(dateTime).getTime(), fileSize);
      if (matchTagsToFilter(queryFilter(), augmented)) {
        setItems(produce(screenshots => screenshots.unshift(event.payload)));
        setCounts(type, current => current + 1);
      }
      if (matchTagsToFilter(queryFilter(true), augmented)) setChipCounts(type, current => current + 1);
      pushToast("Saved to history", "success", 3000);
    });
  }

  function listenUploads() {
    const webview = getCurrentWebview();
    return Promise.all([
      webview.listen("upload://started", (event: TauriEvent<UploadStartedEvent>) => {
        clearTimeout(uploadSuccessTimers[event.payload.fileName]);
        setUploadSuccess(event.payload.fileName, undefined);
        setUploadProgress(event.payload.fileName, { sent: 0, total: 0 });
      }),
      webview.listen("upload://progress", (event: TauriEvent<UploadProgressEvent>) => {
        setUploadProgress(event.payload.fileName, { sent: event.payload.sent, total: event.payload.total });
      }),
      webview.listen("upload://finished", (event: TauriEvent<UploadFinishedEvent>) => {
        const { fileName, url, copied } = event.payload;
        setUploadProgress(fileName, undefined);
        updateItem(fileName, entry => { entry.url = url; entry.uploadError = undefined; });
        setUploadSuccess(fileName, { copied });
        clearTimeout(uploadSuccessTimers[fileName]);
        uploadSuccessTimers[fileName] = window.setTimeout(() => setUploadSuccess(fileName, undefined), 4000);
      }),
      webview.listen("upload://failed", (event: TauriEvent<UploadFailedEvent>) => {
        const { fileName, error } = event.payload;
        setUploadProgress(fileName, undefined);
        updateItem(fileName, entry => { entry.uploadError = error; });
      }),
    ]);
  }

  // Dropping files anywhere on the window imports them. Dragging one of our own cards over it does nothing.
  function listenDrop() {
    return getCurrentWebview().onDragDropEvent(event => {
      switch (event.payload.type) {
        case "enter":
        case "over":
          setDropActive(!draggingOwnCard);
          break;
        case "leave":
          setDropActive(false);
          draggingOwnCard = false;
          break;
        case "drop":
          setDropActive(false);
          if (!draggingOwnCard) importPaths(event.payload.paths);
          draggingOwnCard = false;
          break;
      }
    });
  }

  function listenImportFailed() {
    return getCurrentWebview().listen("import://failed", (event: TauriEvent<ImportFailedEvent>) => {
      pushToast(`Failed to import ${event.payload.path}: ${event.payload.error}`, "error", 6000);
    });
  }

  async function importPaths(paths: string[]) {
    for (const path of paths) {
      try {
        await safeInvoke("import_file", { path });
      } catch (error) {
        pushToast(`Failed to import ${path}: ${errorMessage(error)}`, "error", 6000);
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

  function flash(fileName: string, message: string) {
    clearTimeout(flashTimers[fileName]);
    setCardFlash(fileName, undefined);
    queueMicrotask(() => setCardFlash(fileName, message));
    flashTimers[fileName] = window.setTimeout(() => setCardFlash(fileName, undefined), FLASH_MS);
  }

  // A failed action is something the user might miss, so it's a toast. A success is a chip on the card.
  async function runCardAction(screenshot: ImageHistoryData, action: () => Promise<unknown>, success?: string, failure = "That didn't work") {
    try {
      await action();
      if (success) flash(screenshot.fileName, success);
    } catch (error) {
      pushToast(`${failure}: ${errorMessage(error)}`, "error", 6000);
    }
  }

  function refreshTagMetadata() {
    safeInvoke("get_tag_metadata")
      .then(setMetadata)
      .catch(error => console.error("Failed to load tag metadata", error));
  }

  function updateItem(fileName: string, update: (entry: ImageHistoryData) => void) {
    setItems(produce(screenshots => {
      const entry = screenshots.find(e => e.fileName === fileName);
      if (entry) update(entry);
    }));
  }

  const copyImage = (screenshot: ImageHistoryData) =>
    runCardAction(screenshot, () => safeInvoke("copy_screenshot_to_clipboard", { fileName: screenshot.fileName }), "Copied to clipboard", "Couldn't copy the image");

  const copyFile = (screenshot: ImageHistoryData) =>
    runCardAction(screenshot, () => safeInvoke("copy_file_to_clipboard", { fileName: screenshot.fileName }), "File copied", "Couldn't copy the file");

  const copyLink = (screenshot: ImageHistoryData) => screenshot.url
    ? runCardAction(screenshot, () => safeInvoke("copy_text_to_clipboard", { text: screenshot.url! }), "Link copied", "Couldn't copy the link")
    : Promise.resolve();

  const openFolder = (screenshot: ImageHistoryData) =>
    runCardAction(screenshot, () => safeInvoke("show_in_folder", { fileName: screenshot.fileName }), "Opened in Explorer", "Couldn't open the folder");

  const openFile = (screenshot: ImageHistoryData) =>
    runCardAction(screenshot, () => safeInvoke("open_file", { fileName: screenshot.fileName }), undefined, "Couldn't open the file");

  const copyFullPath = (screenshot: ImageHistoryData) =>
    runCardAction(screenshot, () => safeInvoke("copy_text_to_clipboard", { text: screenshot.filePath }), "Path copied", "Couldn't copy the path");

  const copyFolderPath = (screenshot: ImageHistoryData) =>
    runCardAction(screenshot, () => safeInvoke("copy_text_to_clipboard", { text: folderPath(screenshot.filePath) }), "Folder path copied", "Couldn't copy the path");

  function folderPath(filePath: string): string {
    const cut = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    return cut >= 0 ? filePath.slice(0, cut) : filePath;
  }

  // Stages the saved image back into ScreenshotManager so the viewer can edit it like a fresh capture.
  async function startEdit(screenshot: ImageHistoryData) {
    if (screenshot.type !== "image") return;

    try {
      const session = await safeInvoke("begin_image_edit", { fileName: screenshot.fileName });
      setPreview(screenshot);
      setEditSession(session);
    } catch (error) {
      pushToast(`Failed to open the editor: ${errorMessage(error)}`, "error", 6000);
    }
  }

  // Frees the staged temp image for an abandoned edit. A successful save consumes it backend-side instead.
  function cancelEdit() {
    const session = editSession();
    if (!session) return;

    setEditSession(null);
    safeInvoke("cancel_image_edit", { imageId: session.imageId }).catch(() => { });
  }

  function closePreview() {
    cancelEdit();
    setPreview(null);
  }

  async function saveEdit() {
    const session = editSession();
    if (!session) return;

    const final = editViewerApi?.renderFinal?.(true);
    if (!final) {
      pushToast("Nothing to save, the selected region is empty.", "error", 6000);
      return;
    }

    try {
      // No capture sound: this edits an existing image. The backend still runs the persist and auto-upload tail.
      await saveScreenshot(session.imageId, { x: final.x, y: final.y, width: final.width, height: final.height }, final.image, false);
      setEditSession(null);
      setPreview(null);
    } catch (error) {
      pushToast(`Failed to save the edited image: ${errorMessage(error)}`, "error", 6000);
    }
  }

  // Fire and forget: progress, success and failure arrive as `upload://*` events.
  function uploadImage(screenshot: ImageHistoryData) {
    safeInvoke("upload_image", { fileName: screenshot.fileName }).catch(() => { });
  }

  // Uploading again replaces the saved link, so that asks first.
  function requestUpload(screenshot: ImageHistoryData) {
    if (screenshot.url) setPendingReupload(screenshot);
    else uploadImage(screenshot);
  }

  async function deleteImage(screenshot: ImageHistoryData) {
    setPendingDelete(null);

    try {
      await safeInvoke("delete_screenshot", { fileName: screenshot.fileName });
    } catch (error) {
      pushToast(`Couldn't delete "${screenshot.fileName}": ${errorMessage(error)}`, "error", 6000);
      return;
    }

    setRemoving(screenshot.fileName, true);
    window.setTimeout(() => {
      setItems(items.filter(e => e.fileName !== screenshot.fileName));
      setRemoving(screenshot.fileName, undefined);
      setCounts(screenshot.type, current => Math.max(0, current - 1));
      setChipCounts(screenshot.type, current => Math.max(0, current - 1));
    }, REMOVE_MS);
  }

  async function capture(command: "full_screenshot" | "record_screen" | "scrolling_capture_screen", failure: string) {
    try {
      await safeInvoke(command);
    } catch (error) {
      pushToast(`${failure}: ${errorMessage(error)}`, "error", 6000);
    }
  }

  function focusSearch() {
    document.querySelector<HTMLInputElement>(`.${styles.FiltersHeader} input`)?.focus();
  }

  return <div class={styles.Main}>
    <aside class={styles.SideBar}>
      <div class={styles.SideLabel}>Capture</div>
      <CaptureButton primary icon={Camera} label="Screenshot" tooltip="Take a screenshot" keys={screenshotKeys()} onClick={() => capture("full_screenshot", "Failed to take screenshot")} />
      <CaptureButton icon={Video} label="Record screen" tooltip="Record the screen" keys={recordKeys()} onClick={() => capture("record_screen", "Failed to start recording")} />
      <CaptureButton icon={ScrollText} label="Scrolling capture" tooltip="Scrolling capture" keys={scrollingKeys()} onClick={() => capture("scrolling_capture_screen", "Failed to start scrolling capture")} />
      <div class={styles.SideSpacer} />
      <SideNavItem icon={<Settings2 />} onClick={() => navigate("/settings/general")}>
        Settings
      </SideNavItem>
      <div ref={footerEl} class={styles.Footer}>
        <Show when={updateStatus()}>
          {status => <span class={styles.UpdateDot} classList={{ [styles.Available]: status().kind === "available" }} />}
        </Show>
        v{pkg.version}
      </div>
      <Tooltip anchor={() => footerEl} text={updateTooltip()} />
    </aside>

    <section class={styles.Content}>
      <div class={styles.Listing} ref={scrollEl} onScroll={onScroll}>
        <div class={styles.FiltersHeader} classList={{ [styles.Scrolled]: scrolled() }} ref={filtersEl}>
          <div class={styles.FilterPanel}>
            <FilterToolbar sort={sort()} onSortChange={setSort} counts={chipCounts} />
            <Show when={!filtersOpen()}>
              <FilterPills onSearchClick={focusSearch} />
            </Show>
            <div class={styles.Collapse} classList={{ [styles.Open]: filtersOpen() }}>
              <div>
                <div class={styles.CollapseInner}>
                  <Show when={metadata()}>
                    {meta => <TagFilters tagMap={meta().schema} />}
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Switch>
          <Match when={showSkeleton()}>
            <div class={styles.SkeletonGrid} style={{ "grid-template-columns": gridColumns() }}>
              <For each={Array.from({ length: SKELETON_CARDS })}>
                {() => (
                  <div class={styles.SkeletonCard}>
                    <Skeleton class={styles.SkeletonThumb} />
                    <Skeleton class={styles.SkeletonLine} style={{ width: "70%" }} />
                    <Skeleton class={styles.SkeletonLine} style={{ width: "45%" }} />
                    <Skeleton class={styles.SkeletonLine} style={{ width: "58%" }} />
                  </div>
                )}
              </For>
            </div>
          </Match>
          <Match when={items.length === 0 && anyFilterActive()}>
            <div class={styles.EmptyWrap}>
              <EmptyState
                icon={<SearchX size={24} />}
                title="No captures match these filters"
                action={<Button size="sm" onClick={clearFilter}>Clear filters</Button>}
              />
            </div>
          </Match>
          <Match when={items.length === 0}>
            <div class={styles.EmptyWrap}>
              <EmptyState icon={<Camera size={24} />} title="No captures yet">
                <Show when={screenshotKeys()} fallback="Press the Screenshot button to take one.">
                  Press <KeyRenderer keys={emptyKeys()} size="sm" /> or the Screenshot button to take one.
                </Show>
              </EmptyState>
            </div>
          </Match>
          <Match when={true}>
            <div class={styles.Viewport} style={{ height: `${totalHeight()}px` }}>
              <div class={styles.Grid} style={{ transform: `translateY(${offsetY()}px)`, "grid-template-columns": gridColumns() }}>
                <For each={visibleItems()}>
                  {(screenshot, index) => {
                    const { show: showContextMenu, id: menuId } = useContextMenu();
                    const upload = createMemo(() => ({ progress: uploadProgress[screenshot.fileName], success: uploadSuccess[screenshot.fileName] }));

                    return <>
                      <HistoryCard
                        screenshot={screenshot}
                        upload={upload()}
                        flash={cardFlash[screenshot.fileName]}
                        entranceIndex={animateEntrance() ? index() : null}
                        removing={removing[screenshot.fileName] ?? false}
                        fitImage={fitThumbnails()}
                        actions={{
                          open: () => setPreview(screenshot),
                          copy: () => screenshot.type === "image" ? copyImage(screenshot) : copyFile(screenshot),
                          copyLink: () => copyLink(screenshot),
                          upload: () => requestUpload(screenshot),
                          retry: () => uploadImage(screenshot),
                          showInFolder: () => openFolder(screenshot),
                          showMenu: (event, position) => showContextMenu(event, { position }),
                          showError: setViewingUploadError,
                          startDrag: event => { draggingOwnCard = true; startFileDrag(event, screenshot); },
                        }}
                      />
                      <ContextMenu id={menuId} styles={{ width: "220px" }}>
                        <Show when={screenshot.type === "image"} fallback={
                          <ContextMenuItem icon={{ icon: Copy }} onClick={() => copyFile(screenshot)}>Copy file</ContextMenuItem>
                        }>
                          <ContextMenuItem icon={{ icon: Pencil }} onClick={() => startEdit(screenshot)}>Edit</ContextMenuItem>
                          <ContextMenuItem icon={{ icon: Copy }} onClick={() => copyImage(screenshot)}>Copy image</ContextMenuItem>
                        </Show>
                        <ContextMenuItem icon={{ icon: Link }} disabled={!screenshot.url} onClick={() => copyLink(screenshot)}>Copy link</ContextMenuItem>
                        <ContextMenuItem icon={{ icon: CloudUpload }} onClick={() => requestUpload(screenshot)}>{screenshot.url ? "Upload again" : "Upload"}</ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem icon={{ icon: ExternalLink }} onClick={() => openFile(screenshot)}>Open file</ContextMenuItem>
                        <ContextMenuItem icon={{ icon: FolderOpen }} onClick={() => openFolder(screenshot)}>Open containing folder</ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem icon={{ icon: FileSymlink }} onClick={() => copyFullPath(screenshot)}>Copy full path</ContextMenuItem>
                        <ContextMenuItem icon={{ icon: FolderSymlink }} onClick={() => copyFolderPath(screenshot)}>Copy folder path</ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem icon={{ icon: Tag }} onClick={() => setEditingTags(screenshot)}>Edit tags</ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem icon={{ icon: Trash2 }} danger onClick={() => setPendingDelete(screenshot)}>Delete</ContextMenuItem>
                      </ContextMenu>
                    </>;
                  }}
                </For>
              </div>
            </div>
            <Show when={loading()}>
              <div class={styles.MoreLoader}><Spinner /></div>
            </Show>
          </Match>
        </Switch>
      </div>

      <Show when={dropActive()}>
        <div class={styles.DropPad}>
          <Import size={28} />
          Drop to add to history
        </div>
      </Show>
    </section>

    <Modal
      show={!!preview()}
      onHide={closePreview}
      title={preview()?.fileName}
      width="86%"
      height="86%"
      headerActions={preview()?.type === "image" ? (
        <Show
          when={editSession()}
          fallback={<Button size="sm" onClick={() => startEdit(preview()!)}><Pencil size={14} />Edit</Button>}
        >
          <Button size="sm" onClick={cancelEdit}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={saveEdit}>Save as new</Button>
        </Show>
      ) : undefined}
    >
      <Show when={preview()} keyed>
        {screenshot => (
          <div class={styles.PreviewBody}>
            <Switch>
              <Match when={screenshot.type === "video"}>
                <video src={savedUrl(screenshot.fileName)} controls autoplay />
              </Match>
              <Match when={screenshot.type === "file"}>
                <div class={styles.FilePreview}>
                  <File size={56} />
                  <span>{screenshot.fileName}</span>
                  <Button onClick={() => openFolder(screenshot)}><FolderOpen size={15} />Show in folder</Button>
                </div>
              </Match>
              <Match when={true}>
                <Show
                  when={editSession()}
                  fallback={<ImageViewer src={savedUrl(screenshot.fileName)} />}
                >
                  {/* A separate JSX position, so entering or leaving edit mode mounts a fresh viewer. */}
                  {session => (
                    <ImageViewer
                      src={`http://rosemyne-photo.localhost/preview/${session().imageId}`}
                      hideRotate
                      editable
                      annotating
                      onApi={api => editViewerApi = api}
                    />
                  )}
                </Show>
              </Match>
            </Switch>
          </div>
        )}
      </Show>
    </Modal>
    <Modal
      show={!!pendingDelete()}
      onHide={() => setPendingDelete(null)}
      title="Delete this capture?"
      width={420}
      footer={<>
        <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
        <Button variant="danger-solid" onClick={() => deleteImage(pendingDelete()!)}><Trash2 size={15} />Delete</Button>
      </>}
    >
      <p>"{pendingDelete()?.fileName}" is removed from disk and from history.</p>
    </Modal>
    <Modal
      show={!!pendingReupload()}
      onHide={() => setPendingReupload(null)}
      title="Upload again?"
      width={420}
      footer={<>
        <Button onClick={() => setPendingReupload(null)}>Cancel</Button>
        <Button variant="primary" onClick={() => { uploadImage(pendingReupload()!); setPendingReupload(null); }}><CloudUpload size={15} />Upload</Button>
      </>}
    >
      <p>"{pendingReupload()?.fileName}" already has a link. Uploading again replaces it.</p>
    </Modal>
    <UploadErrorDetailsModal
      show={!!viewingUploadError()}
      onHide={() => setViewingUploadError(null)}
      error={viewingUploadError() ?? undefined}
    />
    <TagEditorModal
      screenshot={editingTags()}
      schema={metadata()?.schema ?? null}
      onHide={() => setEditingTags(null)}
      onSaved={(fileName, tags) => {
        updateItem(fileName, entry => { entry.tags = tags; });
        refreshTagMetadata();
      }}
    />
  </div>
}

export default Main;
