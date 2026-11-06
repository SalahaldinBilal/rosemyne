import { JSX } from "solid-js";

export type InputProps = Partial<{
  min: number | string | undefined;
  max: number | string | undefined;
  value: string | number | string[] | undefined;
  type: string;
  placeholder: string;
  beforeInput: JSX.Element;
  afterInput: JSX.Element;
  onChange: JSX.EventHandler<HTMLInputElement, InputEvent>;
  onClick: JSX.EventHandler<HTMLInputElement, MouseEvent>;
  onBlur: JSX.EventHandler<HTMLInputElement, FocusEvent>;
  onKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent>;
  style: JSX.CSSProperties;
  inputStyle: JSX.CSSProperties;
  class: string;
  alignText: "left" | "center" | "right";
  size: "md" | "sm";
  mono: boolean;
  disallowEmpty: boolean;
  selectOnClick: boolean;
  disabled: boolean;
  borderless: boolean;
  noRadius: boolean;
  focusOnCreation: boolean;
  invalid: boolean;
  tooltip: string;
}>
