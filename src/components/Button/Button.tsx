import styles from "./Button.module.scss";
import { ButtonProps } from "../../types";
import { createMemo } from "solid-js";
import { mergeRefs } from "@solid-primitives/refs";
import Tooltip from "../Tooltip/Tooltip";

const VARIANT_CLASSES = {
  primary: styles.Primary,
  secondary: styles.Secondary,
  ghost: styles.Ghost,
  danger: styles.Danger,
  "danger-solid": styles.DangerSolid,
  warn: styles.Warn,
};

const SIZE_CLASSES = {
  md: undefined,
  sm: styles.Small,
  xs: styles.ExtraSmall,
};

function Button(props: ButtonProps) {
  const disabled = createMemo(() => props.disabled ?? false);
  const variant = createMemo(() => props.variant ?? (props.isIcon ? "ghost" : "secondary"));
  const className = createMemo(() =>
    [styles.Button, VARIANT_CLASSES[variant()], SIZE_CLASSES[props.size ?? "md"], props.class]
      .filter(Boolean)
      .join(" "),
  );

  let buttonElement: HTMLButtonElement | undefined;

  return (
    <button
      type="button"
      disabled={disabled()}
      class={className()}
      classList={{ [styles.Icon]: props.isIcon ?? false, [styles.Active]: props.active ?? false }}
      ref={mergeRefs(props.ref, ref => buttonElement = ref)}
      style={props.style}
      onClick={event => {
        if (disabled()) return;
        props.onClick?.(event);
      }}
    >
      {props.children}
      <Tooltip anchor={() => buttonElement} text={props.tooltip} keys={props.tooltipKeys} />
    </button>
  );
}

export default Button;
