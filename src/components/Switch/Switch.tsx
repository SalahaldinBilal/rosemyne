import styles from "./Switch.module.scss";

// A <button role="switch">, so a wrapping <label> toggle row still forwards its clicks here.
function Switch(props: { checked: boolean, onChange: (checked: boolean) => void, disabled?: boolean, label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      class={styles.Switch}
      classList={{ [styles.On]: props.checked }}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    />
  );
}

export default Switch;
