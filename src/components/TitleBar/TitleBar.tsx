import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useLocation } from "@solidjs/router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import styles from "./TitleBar.module.scss";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { SETTINGS_ROUTES } from "@core/constants/settingsRoutes";
import { WindowAction } from "@core/types";

function control(action: WindowAction) {
  safeInvoke("window_control", { action }).catch(error => console.error(`Window action "${action}" failed:`, error));
}

function isOver(event: MouseEvent, element: Element | undefined): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom;
}

function TitleBar() {
  const location = useLocation();
  const appWindow = getCurrentWindow();
  const [maximized, setMaximized] = createSignal(false);
  let barEl: HTMLDivElement | undefined;
  let controlsEl: HTMLDivElement | undefined;

  const crumb = createMemo(() => {
    const [, section, page] = location.pathname.split("/");
    if (section === "settings") {
      const title = SETTINGS_ROUTES.find(route => route.path === page)?.title;
      return title ? ["Settings", title] : ["Settings"];
    }
    if (section === "onboarding") return ["Setup"];
    if (section === "scroll-capture-result") return ["Scrolling Capture"];
    return ["Rosemyne"];
  });

  // Hit-tested by position, not event target, so nothing layered over the bar can swallow a drag.
  function onWindowMouseDown(event: MouseEvent) {
    if (event.button !== 0 || !isOver(event, barEl) || isOver(event, controlsEl)) return;
    event.preventDefault();
    event.stopPropagation();
    control(event.detail === 2 ? "toggleMaximize" : "startDragging");
  }

  onMount(async () => {
    window.addEventListener("mousedown", onWindowMouseDown, { capture: true });
    onCleanup(() => window.removeEventListener("mousedown", onWindowMouseDown, { capture: true }));

    setMaximized(await appWindow.isMaximized());
    const unlistenResized = await appWindow.onResized(async () => setMaximized(await appWindow.isMaximized()));
    onCleanup(() => unlistenResized());
  });

  return <div ref={barEl} class={styles.TitleBar} onContextMenu={event => event.preventDefault()}>
    <div class={styles.Brand}>
      <img src="/icon.svg" alt="" />
    </div>

    <div class={styles.Crumb}>
      <For each={crumb()}>
        {(part, index) => <>
          <Show when={index() > 0}>
            <span>›</span>
          </Show>
          <span classList={{ [styles.Current]: index() === crumb().length - 1 }}>{part}</span>
        </>}
      </For>
    </div>

    <div ref={controlsEl} class={styles.Controls}>
      <button class={styles.Control} title="Minimize" onClick={() => control("minimize")}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button class={styles.Control} title={maximized() ? "Restore" : "Maximize"} onClick={() => control("toggleMaximize")}>
        <Show
          when={maximized()}
          fallback={
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">
              <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" />
            </svg>
          }
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">
            <rect x="0.5" y="2.5" width="7" height="7" rx="1.2" />
            <path d="M2.5 2.5V2a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 9.5 2v4A1.5 1.5 0 0 1 8 7.5h-.5" />
          </svg>
        </Show>
      </button>
      <button class={`${styles.Control} ${styles.Close}`} title="Close" onClick={() => control("close")}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  </div>;
}

export default TitleBar;
