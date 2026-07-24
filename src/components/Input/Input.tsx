import styles from "./Input.module.scss";
import { InputProps } from "../../types";
import { createEffect, createMemo, createSignal, onMount } from "solid-js";
import { isNotNullish } from "../../helpers";
import useToastState from "../../states/toastState";

function Input(props: InputProps) {
  const { pushToast } = useToastState;
  const [focused, setFocused] = createSignal(false);
  const [lastInputValue, setLastInputValue] = createSignal("");
  const [invalid, setInvalid] = createSignal(false);
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

  // Tracks the last externally-committed value to revert to on blur; skipped while invalid mid-edit.
  createEffect(() => {
    const external = props.value?.toString() ?? "";
    if (!invalid()) setLastInputValue(external);
  })

  function violation(value: string): string | null {
    if (isNotNullish(props.min) && +value < +props.min) return `Must be at least ${props.min}`;
    if (isNotNullish(props.max) && +value > +props.max) return `Must be at most ${props.max}`;
    if (disallowEmpty() && value.length === 0) return `Can't be empty`;
    return null;
  }

  return (
    <div
      classList={{ [styles.Input]: true, [styles.Focused]: focused(), [styles.Disabled]: disabled(), [styles.Borderless]: borderless(), [styles.NoRadius]: noRadius(), [styles.Invalid]: invalid() }}
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
        onBlur={_ => {
          setFocused(false);
          // Leaving the field on an invalid, never-committed edit would
          // otherwise strand the display out of sync with the real value.
          if (invalid()) {
            inputRef!.value = lastInputValue();
            setInvalid(false);
          }
        }}
        onWheel={event => {
          if (disabled() || type() !== "number") return;

          event.preventDefault();
          const currentValue = parseFloat(inputRef!.value) || 0;
          inputRef!.value = (currentValue + (event.deltaY < 0 ? 1 : -1)).toString();
          inputRef!.dispatchEvent(new InputEvent("input", { bubbles: true }));
        }}
        onInput={event => {
          const problem = violation(event.currentTarget.value);

          if (problem) {
            // Edge-triggered, don't re-toast on every keystroke a partial
            // number stays invalid for, only when it first becomes so.
            if (!invalid()) pushToast(problem, "error", 3000);
            setInvalid(true);
            return;
          }

          setInvalid(false);
          props.onChange?.(event)
        }}
      />
      {props.afterInput}
    </div>
  );
}

export default Input;
