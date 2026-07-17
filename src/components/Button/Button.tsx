import styles from "./Button.module.scss";
import { ButtonProps } from "../../types";
import { createMemo, createSignal, JSX, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { mergeRefs } from "@solid-primitives/refs";

const TOOLTIP_SHOW_DELAY = 400;
const TOOLTIP_MARGIN = 8;
const TOOLTIP_ESTIMATED_HEIGHT = 30;

function Button(props: ButtonProps) {
  const [showTooltip, setShowTooltip] = createSignal(false);
  const [tooltipStyle, setTooltipStyle] = createSignal<JSX.CSSProperties>({});
  const disabled = createMemo(() => props.disabled ?? false);
  const color = createMemo(() => props.color ?? 'var(--secondary-blue)');
  const style = createMemo(() => ({ ...(props.style ?? {}), '--button-color': color() }));

  let buttonElement: HTMLButtonElement;
  let tooltipTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleTooltip = () => {
    if (!props.tooltip) return;

    tooltipTimer = setTimeout(() => {
      const rect = buttonElement.getBoundingClientRect();
      const showAbove = rect.bottom + TOOLTIP_ESTIMATED_HEIGHT + TOOLTIP_MARGIN > window.innerHeight;

      setTooltipStyle({
        left: (rect.left + rect.width / 2) + "px",
        top: (showAbove ? rect.top - TOOLTIP_MARGIN : rect.bottom + TOOLTIP_MARGIN) + "px",
        transform: `translate(-50%, ${showAbove ? "-100%" : "0"})`,
      });
      setShowTooltip(true);
    }, TOOLTIP_SHOW_DELAY);
  }

  const hideTooltip = () => {
    clearTimeout(tooltipTimer);
    setShowTooltip(false);
  }

  onCleanup(() => clearTimeout(tooltipTimer));

  return (
    <button
      disabled={disabled()}
      class={styles.Button}
      classList={{ [styles.Icon]: props.isIcon ?? false, [styles.NoRadius]: props.noRadius ?? false, [styles.Filled]: props.filled ?? false }}
      ref={mergeRefs(props.ref, ref => buttonElement = ref)}
      style={style()}
      onClick={event => {
        if (disabled()) return;
        props.onClick?.(event)
      }}
      onMouseEnter={scheduleTooltip}
      onMouseLeave={hideTooltip}
    >
      {props.children}
      <Show when={props.tooltip && showTooltip()}>
        <Portal>
          <div class={styles.Tooltip} style={tooltipStyle()}>{props.tooltip}</div>
        </Portal>
      </Show>
    </button>
  );
}

export default Button;
