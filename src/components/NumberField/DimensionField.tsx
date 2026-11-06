import styles from "./NumberField.module.scss";
import { createMemo } from "solid-js";
import Tooltip from "../Tooltip/Tooltip";
import { createNumberInput, flashLimit } from "./numberInput";

export type Dimensions = { width: number, height: number };

function DimensionField(props: {
  value: Dimensions,
  onChange: (value: Dimensions) => void,
  min?: number,
  max?: number,
  unit?: string,
  disabled?: boolean,
}) {
  let box: HTMLDivElement | undefined;
  let widthInput: HTMLInputElement | undefined;
  let heightInput: HTMLInputElement | undefined;
  const flash = () => flashLimit(box, styles.Limit);

  const width = createNumberInput(() => ({
    value: props.value.width,
    min: props.min,
    max: props.max ?? 100_000,
    onChange: value => props.onChange({ width: value, height: props.value.height }),
  }), flash);
  const height = createNumberInput(() => ({
    value: props.value.height,
    min: props.min,
    max: props.max ?? 100_000,
    onChange: value => props.onChange({ width: props.value.width, height: value }),
  }), flash);

  const bad = createMemo(() => width.bad() || height.bad());

  function onWheel(event: WheelEvent) {
    const field = document.activeElement === widthInput ? width : document.activeElement === heightInput ? height : null;
    if (!field || props.disabled) return;
    event.preventDefault();
    field.step(event.deltaY < 0 ? 1 : -1, event.shiftKey ? 10 : 1);
  }

  return (
    <div
      ref={box}
      class={`${styles.NumberField} ${styles.Dimension}`}
      classList={{ [styles.Bad]: bad(), [styles.Disabled]: props.disabled ?? false }}
      onWheel={onWheel}
    >
      <input
        ref={widthInput}
        class={styles.Input}
        inputmode="numeric"
        aria-label="Width"
        value={width.text()}
        placeholder="0"
        disabled={props.disabled}
        onInput={event => width.onInput(event.currentTarget.value)}
        onBlur={width.onBlur}
        onFocus={width.onFocus}
        onKeyDown={width.onKeyDown}
        onPaste={width.onPaste}
      />
      <span class={styles.Times}>×</span>
      <input
        ref={heightInput}
        class={styles.Input}
        inputmode="numeric"
        aria-label="Height"
        value={height.text()}
        placeholder="0"
        disabled={props.disabled}
        onInput={event => height.onInput(event.currentTarget.value)}
        onBlur={height.onBlur}
        onFocus={height.onFocus}
        onKeyDown={height.onKeyDown}
        onPaste={height.onPaste}
      />
      <span class={styles.Unit}>{props.unit ?? "px"}</span>
      <Tooltip anchor={() => box} text={bad() ? width.rangeMessage() : undefined} />
    </div>
  );
}

export default DimensionField;
