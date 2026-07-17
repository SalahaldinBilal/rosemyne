import styles from "./Input.module.scss";
import { InputProps } from "../../types";
import { createMemo, createSignal, onMount } from "solid-js";
import { isNotNullish } from "../../helpers";

function Input(props: InputProps) {
  const [focused, setFocused] = createSignal(false);
  const [lastInputValue, setLastInputValue] = createSignal(props.value?.toString() ?? "");
  const disallowEmpty = createMemo(() => props.disallowEmpty ?? false)
  const selectOnClick = createMemo(() => props.selectOnClick ?? false)
  const borderless = createMemo(() => props.borderless ?? false)
  const disabled = createMemo(() => props.disabled ?? false)
  const type = createMemo(() => props.type ?? "text")
  const textAlignment = createMemo(() => props.alignText ?? "left")
  const color = createMemo(() => props.color ?? 'var(--base-blue)');
  const noRadius = createMemo(() => props.noRadius ?? false);
  const placeholder = createMemo(() => props.placeholder ?? "");
  const style = createMemo(() => ({
    '--input-accent': color(),
    ...(props.style ?? {}),
  }))
  const inputStyle = createMemo(() => ({
    "text-align": textAlignment(),
    ...(props.inputStyle ?? {}),
  }))
  let inputRef: HTMLInputElement;

  onMount(() => {
    if (props.focusOnCreation) {
      inputRef!.focus();
    }
  })

  return (
    <div
      classList={{ [styles.Input]: true, [styles.Focused]: focused(), [styles.Disabled]: disabled(), [styles.Borderless]: borderless(), [styles.NoRadius]: noRadius() }}
      style={style()}
      onClick={event => {
        if (disabled()) event.stopPropagation();
      }}
    >
      {props.beforeInput}
      <input
        ref={inputRef!}
        placeholder={placeholder()}
        disabled={disabled()}
        onClick={event => {
          if (selectOnClick())
            event.currentTarget.select();
          props.onClick?.(event);
        }}
        min={props.min}
        max={props.max}
        value={props.value ?? ""}
        style={inputStyle()}
        type={type()}
        onFocus={_ => setFocused(true)}
        onBlur={_ => setFocused(false)}
        onWheel={event => {
          if (disabled() || type() !== "number") return;

          event.preventDefault();
          const currentValue = parseFloat(inputRef!.value) || 0;
          inputRef!.value = (currentValue + (event.deltaY < 0 ? 1 : -1)).toString();
          inputRef!.dispatchEvent(new InputEvent("input", { bubbles: true }));
        }}
        onInput={event => {
          const currentValue = event.currentTarget.value;
          if (
            (isNotNullish(props.min) && +currentValue < +props.min) ||
            (isNotNullish(props.max) && +currentValue > +props.max) ||
            (disallowEmpty() && currentValue.length === 0)
          ) {
            event.currentTarget.value = lastInputValue();
            return;
          }

          setLastInputValue(event.currentTarget.value)
          props.onChange?.(event)
        }}
      />
      {props.afterInput}
    </div>
  );
}

export default Input;
