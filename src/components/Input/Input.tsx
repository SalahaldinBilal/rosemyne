import styles from "./Input.module.scss";
import { InputProps } from "../../types";
import { createEffect, createMemo, createSignal, onMount } from "solid-js";
import { isNotNullish } from "../../helpers";
import Tooltip from "../Tooltip/Tooltip";

function Input(props: InputProps) {
  const [lastInputValue, setLastInputValue] = createSignal("");
  const [problem, setProblem] = createSignal<string | null>(null);
  const disabled = createMemo(() => props.disabled ?? false);
  const type = createMemo(() => props.type ?? "text");
  const inputStyle = createMemo(() => ({
    "text-align": props.alignText ?? "left",
    ...(props.inputStyle ?? {}),
  }));
  const tooltip = createMemo(() => problem() ?? props.tooltip);
  const className = createMemo(() => [styles.Input, props.class].filter(Boolean).join(" "));
  let inputRef: HTMLInputElement | undefined;
  let boxRef: HTMLDivElement | undefined;

  onMount(() => {
    if (props.focusOnCreation) inputRef?.focus();
  });

  // The last committed value, restored on blur if the field is left on an invalid edit.
  createEffect(() => {
    const external = props.value?.toString() ?? "";
    if (!problem()) setLastInputValue(external);
  });

  function violation(value: string): string | null {
    if (isNotNullish(props.min) && +value < +props.min) return `Must be at least ${props.min}`;
    if (isNotNullish(props.max) && +value > +props.max) return `Must be at most ${props.max}`;
    if ((props.disallowEmpty ?? false) && value.length === 0) return `Can't be empty`;
    return null;
  }

  return (
    <div
      ref={boxRef}
      class={className()}
      classList={{
        [styles.Disabled]: disabled(),
        [styles.Borderless]: props.borderless ?? false,
        [styles.NoRadius]: props.noRadius ?? false,
        [styles.Invalid]: !!problem() || (props.invalid ?? false),
        [styles.Small]: props.size === "sm",
        [styles.Mono]: props.mono ?? false,
      }}
      style={props.style}
      onClick={event => {
        if (disabled()) event.stopPropagation();
      }}
    >
      {props.beforeInput}
      <input
        ref={inputRef}
        placeholder={props.placeholder ?? ""}
        disabled={disabled()}
        onClick={event => {
          if (props.selectOnClick) event.currentTarget.select();
          props.onClick?.(event);
        }}
        min={props.min}
        max={props.max}
        value={props.value ?? ""}
        style={inputStyle()}
        type={type()}
        onKeyDown={event => props.onKeyDown?.(event)}
        onBlur={event => {
          if (problem()) {
            event.currentTarget.value = lastInputValue();
            setProblem(null);
          }
          props.onBlur?.(event);
        }}
        onInput={event => {
          const found = violation(event.currentTarget.value);
          setProblem(found);
          if (!found) props.onChange?.(event);
        }}
      />
      {props.afterInput}
      <Tooltip anchor={() => boxRef} text={tooltip()} />
    </div>
  );
}

export default Input;
