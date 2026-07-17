import { JSX } from "solid-js";

export type InputProps = Partial<{
  color: `#${string}`;
  min: number | string | undefined;
  max: number | string | undefined;
  value: string | number | string[] | undefined;
  type: string;
  placeholder: string;
  beforeInput: JSX.Element;
  afterInput: JSX.Element;
  onChange: JSX.EventHandler<HTMLInputElement, InputEvent>;
  onClick: JSX.EventHandler<HTMLInputElement, MouseEvent>;
  style: JSX.CSSProperties;
  inputStyle: JSX.CSSProperties;
  alignText: "left" | "center" | "right";
  disallowEmpty: boolean;
  selectOnClick: boolean;
  disabled: boolean;
  borderless: boolean;
  noRadius: boolean;
  focusOnCreation: boolean;
}>