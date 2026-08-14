import { createMemo, createRoot, createSignal, onMount } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { listen } from "@tauri-apps/api/event";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { CursorImageInfo, SystemCursorInfo } from "@core/types";
import { CURSOR_IMAGE_NAME } from "@core/constants";

export type OverlayImageEntry = {
  name: string,
  url: string,
  removable: boolean,
  // Still rendered when an overlay references it, just never offered as a choice.
  hidden?: boolean,
};

function useOverlayImagesStateInner() {
  const [entries, setEntries] = createStore<OverlayImageEntry[]>([]);
  const [cursorInfo, setCursorInfo] = createSignal<CursorImageInfo | null>(null);
  const [systemCursors, setSystemCursors] = createSignal<SystemCursorInfo[]>([]);

  // Non-reactive like annotationState's effect layers; the version bump is the change signal.
  const bitmaps = new Map<string, HTMLImageElement>();
  const [bitmapVersions, setBitmapVersions] = createStore<Record<string, number>>({});

  // Not helpers/loadImage: that one never settles when the file is missing.
  function registerBitmap(name: string, url: string) {
    return new Promise<void>(resolve => {
      const bitmap = new Image();
      bitmap.crossOrigin = "Anonymous";

      bitmap.addEventListener("load", () => {
        bitmaps.set(name, bitmap);
        setBitmapVersions(name, version => (version ?? 0) + 1);
        resolve();
      });

      bitmap.addEventListener("error", () => {
        console.error(`Failed to load the overlay image ${name} from ${url}`);
        resolve();
      });

      bitmap.src = url;
    });
  }

  function upsertEntry(entry: OverlayImageEntry) {
    setEntries(produce(current => {
      const index = current.findIndex(existing => existing.name === entry.name);
      if (index === -1) current.push(entry);
      else current[index] = entry;
    }));
  }

  async function applyCursor(info: CursorImageInfo | null) {
    setCursorInfo(info);
    if (!info) return;

    // Hidden: it only means something for a capture, where it's placed automatically.
    const entry: OverlayImageEntry = {
      name: CURSOR_IMAGE_NAME,
      url: `http://rosemyne-photo.localhost/cursor/${info.version}`,
      removable: false,
      hidden: true,
    };

    upsertEntry(entry);
    await registerBitmap(entry.name, entry.url);
  }

  async function applySystemCursors(cursors: SystemCursorInfo[]) {
    setSystemCursors(cursors);

    await Promise.all(cursors.map(cursor => {
      const entry: OverlayImageEntry = {
        name: cursor.name,
        url: `http://rosemyne-photo.localhost/system-cursor/${cursor.id}/${cursor.version}`,
        removable: false,
      };

      upsertEntry(entry);
      return registerBitmap(entry.name, entry.url);
    }));
  }

  async function load() {
    const [saved, cursor, cursors] = await Promise.all([
      safeInvoke("get_overlay_images"),
      safeInvoke("get_cursor_image"),
      safeInvoke("get_system_cursors"),
    ]);

    const library = saved.map(image => ({
      name: image.name,
      url: `http://rosemyne-photo.localhost/overlay/${encodeURIComponent(image.fileName)}`,
      removable: true,
    }));

    // Session-only one-offs live on blob URLs and aren't in settings, so keep them.
    setEntries(produce(current => {
      const sessionOnly = current.filter(entry => entry.removable && entry.url.startsWith("blob:"));
      current.splice(0, current.length, ...library, ...sessionOnly);
    }));

    await Promise.all([
      applyCursor(cursor),
      applySystemCursors(cursors),
      ...library.map(entry => registerBitmap(entry.name, entry.url)),
    ]);
  }

  onMount(() => {
    load();
    listen<CursorImageInfo>("cursor://updated", event => applyCursor(event.payload));
    listen<SystemCursorInfo[]>("cursors://updated", event => applySystemCursors(event.payload));
  });

  function bitmapFor(name: string): HTMLImageElement | undefined {
    return bitmaps.get(name);
  }

  const names = createMemo(() => entries.filter(entry => !entry.hidden).map(entry => entry.name));

  async function addFromFile(path: string) {
    const added = await safeInvoke("add_overlay_image", { path });
    const url = `http://rosemyne-photo.localhost/overlay/${encodeURIComponent(added.fileName)}`;

    setEntries(entries.length, { name: added.name, url, removable: true });
    await registerBitmap(added.name, url);
    return added.name;
  }

  // Never persisted or copied to disk; a one-off lives only as long as this webview.
  async function addSessionImage(file: File): Promise<string> {
    const base = file.name.replace(/\.[^.]+$/, "") || "Image";
    const taken = new Set(names().map(name => name.toLowerCase()));

    let name = base;
    let suffix = 2;
    while (taken.has(name.toLowerCase())) name = `${base} ${suffix++}`;

    const url = URL.createObjectURL(file);
    setEntries(entries.length, { name, url, removable: true });
    await registerBitmap(name, url);
    return name;
  }

  async function remove(name: string) {
    await safeInvoke("remove_overlay_image", { name });
    setEntries(entries.filter(entry => entry.name !== name));
    bitmaps.delete(name);
  }

  async function rename(name: string, newName: string) {
    const renamed = await safeInvoke("rename_overlay_image", { name, newName });
    const index = entries.findIndex(entry => entry.name === name);
    if (index === -1) return renamed.name;

    const bitmap = bitmaps.get(name);
    bitmaps.delete(name);
    if (bitmap) bitmaps.set(renamed.name, bitmap);

    setEntries(index, "name", renamed.name);
    setBitmapVersions(renamed.name, version => (version ?? 0) + 1);
    return renamed.name;
  }

  return {
    entries, cursorInfo, systemCursors, bitmapFor, bitmapVersions, names,
    addFromFile, addSessionImage, remove, rename, refresh: load,
  };
}

const useOverlayImagesState = createRoot(useOverlayImagesStateInner);
export default useOverlayImagesState;
