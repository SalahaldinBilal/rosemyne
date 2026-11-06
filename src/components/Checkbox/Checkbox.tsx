import styles from "./Checkbox.module.scss";
import { JSX } from "solid-js";

function Checkbox(props: { checked: boolean, onChange: (checked: boolean) => void, children?: JSX.Element, disabled?: boolean }) {
  return (
    <label class={styles.Checkbox} classList={{ [styles.Disabled]: props.disabled ?? false }}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={event => props.onChange(event.currentTarget.checked)}
      />
      {props.children}
    </label>
  );
}

export default Checkbox;
