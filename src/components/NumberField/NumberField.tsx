import styles from "./NumberField.module.scss";
import { createMemo, JSX, onCleanup, Show } from "solid-js";
import { SelectItem } from "../../types";
import Select from "../Select/Select";
import Tooltip from "../Tooltip/Tooltip";
import { createNumberInput, flashLimit } from "./numberInput";

const SCRUB_PIXELS_PER_STEP = 4;

export type NumberFieldProps = {
  value: number | null;
  onChange: (value: number) => void;
  onEmpty?: () => void;
  allowEmpty?: boolean;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  unit?: string;
  units?: readonly SelectItem<string>[];
  onUnitChange?: (unit: string) => void;
  size?: "md" | "sm";
  width?: number | string;
  disabled?: boolean;
  placeholder?: string;
  tooltip?: string;
  class?: string;
  style?: JSX.CSSProperties;
  ref?: (element: HTMLDivElement) => void;
  // Runs before the field's own key handling. Calling preventDefault() skips it.
  onKeyDown?: (event: KeyboardEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
};

function NumberField(props: NumberFieldProps) {
  let box: HTMLDivElement | undefined;
  let input: HTMLInputElement | undefined;

  const field = createNumberInput(() => props, () => flashLimit(box, styles.Limit));
  const tooltip = createMemo(() => field.bad() ? field.rangeMessage() : props.tooltip);
  const className = createMemo(() => [styles.NumberField, props.class].filter(Boolean).join(" "));
  const boxStyle = createMemo<JSX.CSSProperties>(() => ({
    ...(props.width !== undefined ? { width: typeof props.width === "number" ? `${props.width}px` : props.width } : {}),
    ...(props.style ?? {}),
  }));

  function onWheel(event: WheelEvent) {
    if (props.disabled || document.activeElement !== input) return;
    event.preventDefault();
    field.step(event.deltaY < 0 ? 1 : -1, event.shiftKey ? 10 : 1);
  }

  let stopScrub: (() => void) | undefined;
  onCleanup(() => stopScrub?.());

  function startScrub(event: MouseEvent) {
    if (event.button !== 0 || props.disabled) return;
    event.preventDefault();

    let lastX = event.clientX;
    let accumulated = 0;
    document.body.style.cursor = "ew-resize";

    const move = (moveEvent: MouseEvent) => {
      accumulated += moveEvent.clientX - lastX;
      lastX = moveEvent.clientX;
      while (Math.abs(accumulated) >= SCRUB_PIXELS_PER_STEP) {
        const direction = Math.sign(accumulated);
        field.step(direction, moveEvent.shiftKey ? 10 : 1);
        accumulated -= SCRUB_PIXELS_PER_STEP * direction;
      }
    };
    const up = () => stopScrub?.();
    stopScrub = () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      stopScrub = undefined;
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div
      ref={element => { box = element; props.ref?.(element); }}
      class={className()}
      classList={{ [styles.Small]: props.size === "sm", [styles.Bad]: field.bad(), [styles.Disabled]: props.disabled ?? false }}
      style={boxStyle()}
      onWheel={onWheel}
      onMouseDown={event => {
        if (event.target === box) {
          event.preventDefault();
          input?.focus();
        }
      }}
    >
      <input
        ref={input}
        class={styles.Input}
        inputmode="decimal"
        value={field.text()}
        placeholder={props.placeholder ?? "0"}
        disabled={props.disabled}
        onInput={event => field.onInput(event.currentTarget.value)}
        onBlur={() => { field.onBlur(); props.onBlur?.(); }}
        onFocus={event => { field.onFocus(event); props.onFocus?.(); }}
        onKeyDown={event => {
          props.onKeyDown?.(event);
          if (!event.defaultPrevented) field.onKeyDown(event);
        }}
        onPaste={field.onPaste}
      />
      <Show
        when={props.units}
        fallback={
          <Show when={props.unit}>
            <span class={styles.Unit} classList={{ [styles.Scrub]: !props.disabled }} onMouseDown={startScrub}>{props.unit}</span>
          </Show>
        }
      >
        {units => (
          <Select
            variant="unit"
            value={props.unit ?? ""}
            items={units()}
            onItemClick={item => props.onUnitChange?.(item.value)}
          />
        )}
      </Show>
      <Tooltip anchor={() => box} text={tooltip()} />
    </div>
  );
}

export default NumberField;
