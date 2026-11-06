import styles from "./KeyValueList.module.scss";
import { createSignal, Index } from "solid-js";
import { KeyValue } from "../../../types/request";
import { UPLOADER_VARIABLES } from "../../../constants/templateVariables";
import TemplateInput from "../../TemplateInput/TemplateInput";
import Input from "../../Input/Input";
import { Plus, X } from "lucide-solid";

function KeyValueList(props: {
  values: KeyValue[],
  keyPlaceholder: string,
  addLabel: string,
  onAdd: () => void,
  onChange: (index: number, field: keyof KeyValue, value: string) => void,
  onRemove: (index: number) => void,
}) {
  const [focusIndex, setFocusIndex] = createSignal<number | null>(null);
  let list: HTMLDivElement | undefined;

  function add() {
    setFocusIndex(props.values.length);
    props.onAdd();
    queueMicrotask(() => {
      const rows = list?.querySelectorAll<HTMLElement>(`.${styles.Row}`);
      rows?.[focusIndex() ?? -1]?.querySelector("input")?.focus();
      setFocusIndex(null);
    });
  }

  return (
    <div class={styles.List} ref={list}>
      <Index each={props.values}>
        {(entry, index) => (
          <div class={styles.Row}>
            <Input
              size="sm"
              value={entry().key}
              placeholder={props.keyPlaceholder}
              onChange={event => props.onChange(index, "key", event.currentTarget.value)}
            />
            <TemplateInput
              class={styles.Value}
              value={entry().value}
              placeholder="Value"
              variables={UPLOADER_VARIABLES}
              onChange={value => props.onChange(index, "value", value)}
            />
            <button type="button" class={styles.Remove} aria-label="Remove" title="Remove" onClick={() => props.onRemove(index)}>
              <X size={14} />
            </button>
          </div>
        )}
      </Index>
      <button type="button" class={styles.Add} onClick={add}>
        <Plus size={14} />{props.addLabel}
      </button>
    </div>
  );
}

export default KeyValueList;
