import { JSX, Ref } from "solid-js";

export type ButtonProps = {
  color?: string;
  children?: JSX.Element;
  onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  style?: JSX.CSSProperties;
  isIcon?: boolean;
  noRadius?: boolean;
  // Solid accent background instead of the default ghost/tint style, for a
  // primary "do this now" action rather than a secondary/toolbar control.
  filled?: boolean;
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>
  tooltip?: string
}