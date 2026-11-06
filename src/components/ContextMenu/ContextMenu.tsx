import styles from "./ContextMenu.module.scss";
import { Position, ShowContextMenuParams } from "../../types";
import { JSX, Show, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { contextMenuEventHandler } from "./eventHandler";
import { clickOutside } from "../../directives";
clickOutside;

const CLOSE_DURATION = 110;

type Placement = Position & { origin: string };

function ContextMenu(props: { id: string | number, children: JSX.Element, styles?: JSX.CSSProperties }) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  const [placement, setPlacement] = createSignal<Placement>({ x: 0, y: 0, origin: "top left" });
  let containerRef: HTMLDivElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const onShow = (params: ShowContextMenuParams) => {
    if (params.id !== props.id) return;

    params.event.preventDefault();
    clearTimeout(closeTimer);
    const anchor = params.position ?? { x: params.event.clientX, y: params.event.clientY };
    setPlacement({ ...anchor, origin: "top left" });
    setMounted(true);
    setIsOpen(true);

    if (!params.position && containerRef) {
      setPlacement(placeAtCursor(anchor, containerRef.offsetWidth, containerRef.offsetHeight));
    }
  };
  const onHideAll = () => contextMenuEventHandler.emit("hide", props.id);
  const onHide = (id: string | number) => {
    if (id !== props.id || !isOpen()) return;
    setIsOpen(false);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setMounted(false), CLOSE_DURATION);
  };

  contextMenuEventHandler.on("show", onShow);
  contextMenuEventHandler.on("hideAll", onHideAll);
  contextMenuEventHandler.on("hide", onHide);
  onCleanup(() => {
    clearTimeout(closeTimer);
    contextMenuEventHandler.off("show", onShow);
    contextMenuEventHandler.off("hideAll", onHideAll);
    contextMenuEventHandler.off("hide", onHide);
  });

  return (
    <Portal>
      <Show when={mounted()}>
        <div
          ref={containerRef}
          class={styles.Container}
          classList={{ [styles.Closing]: !isOpen() }}
          use:clickOutside={() => contextMenuEventHandler.emit("hide", props.id)}
          style={{
            ...(props.styles ?? {}),
            left: placement().x + "px",
            top: placement().y + "px",
            "transform-origin": placement().origin,
          }}
        >
          {props.children}
        </div>
      </Show>
    </Portal>
  );
}

export function ContextMenuSeparator() {
  return <div class={styles.Separator} />;
}

export default ContextMenu;

function placeAxis(click: number, size: number, viewport: number): { value: number, flipped: boolean } {
  if (click + size <= viewport) return { value: click, flipped: false };
  if (click < size) return { value: Math.max(0, viewport - size), flipped: false };
  return { value: click - size, flipped: true };
}

function placeAtCursor(click: Position, width: number, height: number): Placement {
  const x = placeAxis(click.x, width, window.innerWidth);
  const y = placeAxis(click.y, height, window.innerHeight);
  return {
    x: x.value,
    y: y.value,
    origin: `${y.flipped ? "bottom" : "top"} ${x.flipped ? "right" : "left"}`,
  };
}
