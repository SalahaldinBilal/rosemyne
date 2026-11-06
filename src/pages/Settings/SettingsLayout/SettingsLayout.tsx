import styles from "./SettingsLayout.module.scss";
import { createContext, JSX, Show, useContext } from "solid-js";
import Switch from "@core/components/Switch/Switch";

// Onboarding shows some settings pages as steps under its own heading, so they drop theirs.
export const SettingsEmbedded = createContext(false);

export function SettingsPage(props: { title: string, description: string, children: JSX.Element }) {
  const embedded = useContext(SettingsEmbedded);

  return (
    <Show when={!embedded} fallback={<div class={styles.Embedded}>{props.children}</div>}>
      <div class={styles.Page}>
        <header class={styles.PageHead}>
          <h1>{props.title}</h1>
          <p>{props.description}</p>
        </header>
        {props.children}
      </div>
    </Show>
  );
}

// The settings search finds a result's row by this, see SETTINGS_SEARCH_ENTRIES.
function searchKey(label: JSX.Element): string | undefined {
  return typeof label === "string" ? label : undefined;
}

export function SettingsGroup(props: { title?: JSX.Element, right?: JSX.Element, children: JSX.Element }) {
  return (
    <section class={styles.Group} data-setting={searchKey(props.title)}>
      <Show when={props.title || props.right}>
        <div class={styles.GroupTitle}>
          {props.title}
          <span class={styles.Spacer} />
          {props.right}
        </div>
      </Show>
      <div class={styles.Card}>{props.children}</div>
    </section>
  );
}

function RowText(props: { label: JSX.Element, hint?: JSX.Element }) {
  return (
    <div class={styles.Text}>
      <b>{props.label}</b>
      <Show when={props.hint}><span>{props.hint}</span></Show>
    </div>
  );
}

// A row with its control on the right, or below the label for long inputs (`stack`).
// It stays a <div>: a <label> would forward clicks on the control to a checkbox.
export function SettingRow(props: { label: JSX.Element, hint?: JSX.Element, stack?: boolean, disabled?: boolean, children?: JSX.Element }) {
  return (
    <div class={styles.Row} classList={{ [styles.Stack]: props.stack ?? false, [styles.Disabled]: props.disabled ?? false }} data-setting={searchKey(props.label)}>
      <RowText label={props.label} hint={props.hint} />
      {props.children}
    </div>
  );
}

// A pure toggle row: clicking anywhere on it flips the switch.
export function ToggleRow(props: { label: JSX.Element, hint?: JSX.Element, checked: boolean, onChange: (checked: boolean) => void, disabled?: boolean }) {
  return (
    <label class={styles.Row} classList={{ [styles.Toggle]: true, [styles.Disabled]: props.disabled ?? false }} data-setting={searchKey(props.label)}>
      <RowText label={props.label} hint={props.hint} />
      <Switch checked={props.checked} disabled={props.disabled} onChange={props.onChange} />
    </label>
  );
}

// `grow` stretches the first control (a path or template field) across the row.
export function InlineControls(props: { grow?: boolean, children: JSX.Element }) {
  return <div class={styles.Inline} classList={{ [styles.Grow]: props.grow ?? false }}>{props.children}</div>;
}
