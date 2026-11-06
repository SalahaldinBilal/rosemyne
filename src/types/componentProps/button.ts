import { JSX, Ref } from "solid-js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid" | "warn";
export type ButtonSize = "md" | "sm" | "xs";

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: JSX.Element;
  onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  style?: JSX.CSSProperties;
  class?: string;
  isIcon?: boolean;
  active?: boolean;
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>;
  tooltip?: string;
  tooltipKeys?: string[];
}
