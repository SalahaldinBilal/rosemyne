import styles from "./ContextMenu.module.scss";
import { Position, Size, ShowContextMenuParams } from "../../types";
import { JSX, Show, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { contextMenuEventHandler } from "./eventHandler";
import { Transition } from "solid-transition-group";
import { clickOutside } from "../../directives";
clickOutside;

function ContextMenu(props: { id: string | number, children: JSX.Element, styles?: JSX.CSSProperties }) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [position, setPosition] = createSignal<Position>({ x: 0, y: 0 });
  let containerRef!: HTMLDivElement;

  const onShow = (params: ShowContextMenuParams) => {
    if (params.id !== props.id) return;

    params.event.preventDefault();
    setIsOpen(true);
    setPosition(
      params.position ??
      calculateContextMenuPosition(
        { x: params.event.clientX, y: params.event.clientY },
        { width: containerRef?.offsetWidth, height: containerRef?.offsetHeight }
      )
    );
  };
  const onHideAll = () => contextMenuEventHandler.emit("hide", props.id);
  const onHide = (id: string | number) => {
    if (id === props.id) setIsOpen(false);
  };

  contextMenuEventHandler.on("show", onShow);
  contextMenuEventHandler.on("hideAll", onHideAll);
  contextMenuEventHandler.on("hide", onHide);
  onCleanup(() => {
    contextMenuEventHandler.off("show", onShow);
    contextMenuEventHandler.off("hideAll", onHideAll);
    contextMenuEventHandler.off("hide", onHide);
  });

  return (
    <Portal>
      <Transition
        onBeforeEnter={(el) => el.classList.add(styles.StartState, styles.EnterAnimation)}
        onEnter={async (el, done) => el.addEventListener("animationend", done)}
        onAfterEnter={(el) => el.classList.remove(styles.StartState, styles.EnterAnimation)}
        onBeforeExit={(el) => el.classList.add(styles.EndAnimation)}
        onExit={(el, done) => el.addEventListener("animationend", done)}
      >
        <Show when={isOpen()}>
          <div
            ref={containerRef}
            class={styles.Container}
            use:clickOutside={() => contextMenuEventHandler.emit("hide", props.id)}
            style={{ ...(props.styles ?? {}), left: position().x + "px", top: position().y + "px" }}
          >
            {props.children}
          </div>
        </Show>
      </Transition>
    </Portal>
  );
}

export default ContextMenu;


function calculateAxisValue(clickPosition: number, elementSize: number, boxSize: number) {
  if (clickPosition + elementSize <= boxSize) return clickPosition;
  if (clickPosition < elementSize) return boxSize - elementSize;
  return clickPosition - elementSize;
}

function calculateContextMenuPosition(clickPosition: Position, elementSize: Size): Position {
  return {
    x: calculateAxisValue(clickPosition.x, elementSize.width, window.innerWidth),
    y: calculateAxisValue(clickPosition.y, elementSize.height, window.innerHeight),
  }
}
