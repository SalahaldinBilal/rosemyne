import styles from "./Modal.module.scss";
import { Transition } from "solid-transition-group";
import { createMemo, JSX, Show } from "solid-js";
import { ModalProps } from "../../types";
import Button from "../Button/Button";
import { isNotNullish } from "../../helpers";
import { makeEventListener } from "@solid-primitives/event-listener";
import { X } from "lucide-solid";

function Modal(props: ModalProps) {
  const width = createMemo(() => {
    if (isNotNullish(props.width)) {
      return typeof props.width === 'string' ? props.width : `${props.width}px`
    }

    return undefined
  })

  const height = createMemo(() => {
    if (isNotNullish(props.height)) {
      return typeof props.height === 'string' ? props.height : `${props.height}px`
    }

    return undefined
  })

  const extraStyles = createMemo(() => {
    const obj: JSX.CSSProperties = {}
    if (isNotNullish(width())) obj.width = width();
    if (isNotNullish(height())) obj.height = height();
    return obj;
  })

  makeEventListener(window, "keydown", event => {
    if (props.show && event.key === "Escape") props.onHide?.();
  });

  return (
    <Transition
      onBeforeEnter={(el) => el.classList.add(styles.StartState, styles.EnterAnimation)}
      onEnter={async (el, done) => el.addEventListener("animationend", done)}
      onAfterEnter={(el) => el.classList.remove(styles.StartState, styles.EnterAnimation)}
      onBeforeExit={(el) => el.classList.add(styles.EndAnimation)}
      onExit={(el, done) => el.addEventListener("animationend", done)}
    >
      <Show when={props.show}>
        <div class={styles.Container} onClick={() => props.onHide?.()}>
          <div class={styles.Body} role="dialog" aria-modal="true" style={extraStyles()} onClick={event => event.stopPropagation()}>
            <div class={styles.Header}>
              <div class={styles.Title}>{props.title ?? ""}</div>
              <div class={styles.Close}>
                <Button
                  isIcon
                  color="var(--base-font-color)"
                  onClick={() => props.onHide?.()}
                >
                  <X size={18} />
                </Button>
              </div>
            </div>
            <div class={styles.Content}>
              {props.children}
            </div>
          </div>
        </div>
      </Show>
    </Transition>
  );
}

export default Modal;
