import styles from "./Modal.module.scss";
import { Transition } from "solid-transition-group";
import { createMemo, JSX, Show } from "solid-js";
import { ModalProps } from "../../types";
import Button from "../Button/Button";
import { isNotNullish } from "../../helpers";
import { makeEventListener } from "@solid-primitives/event-listener";
import { X } from "lucide-solid";

function toCssSize(value: number | string | undefined): string | undefined {
  if (!isNotNullish(value)) return undefined;
  return typeof value === "string" ? value : `${value}px`;
}

function Modal(props: ModalProps) {
  const sizeStyle = createMemo<JSX.CSSProperties>(() => ({
    width: toCssSize(props.width),
    height: toCssSize(props.height),
  }));

  makeEventListener(window, "keydown", event => {
    if (props.show && event.key === "Escape") props.onHide?.();
  });

  return (
    <Transition
      enterActiveClass={styles.Entering}
      enterClass={styles.Hidden}
      exitActiveClass={styles.Exiting}
      exitToClass={styles.Hidden}
    >
      <Show when={props.show}>
        <div class={styles.Container} onClick={() => props.onHide?.()}>
          <div class={styles.Backdrop} />
          <div class={styles.Body} role="dialog" aria-modal="true" style={sizeStyle()} onClick={event => event.stopPropagation()}>
            <div class={styles.Header}>
              <div class={styles.Title}>{props.title ?? ""}</div>
              <Show when={props.headerActions}>
                <div class={styles.HeaderActions}>{props.headerActions}</div>
              </Show>
              <Button isIcon size="sm" tooltip="Close" tooltipKeys={["Esc"]} onClick={() => props.onHide?.()}>
                <X size={16} />
              </Button>
            </div>
            <div class={styles.Content}>
              {props.children}
            </div>
            <Show when={props.footer}>
              <div class={styles.Footer}>{props.footer}</div>
            </Show>
          </div>
        </div>
      </Show>
    </Transition>
  );
}

export default Modal;
