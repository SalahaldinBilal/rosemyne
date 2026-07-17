import Input from "../Input/Input";
import Button from "../Button/Button";
import styles from "./EditableTableList.module.scss";
import { createMemo, For, Show } from "solid-js";
import { Plus, X } from "lucide-solid";

function EditableTableList<T extends { [key: string]: string }>(props: {
  keys: Array<keyof T>,
  values: T[],
  onNewItem: (item: Partial<T>) => any,
  onValueChange: (field: keyof T, value: string, index: number) => any,
  onDeleteItem: (index: number) => any,
  keyDisplayOverrides?: { [Key in keyof T]?: string }
}) {
  const headers = createMemo(() => props.keys.map(e => props.keyDisplayOverrides?.[e] ?? e as string));

  // With no rows yet, render one synthetic empty row; typing into it creates the first real row via onNewItem.
  const displayValues = createMemo(() => props.values.length === 0 ? [{} as T] : props.values);
  const hasRealRows = createMemo(() => props.values.length > 0);

  const handleFieldChange = (field: keyof T, value: string, index: number) => {
    if (props.values.length === 0) props.onNewItem({ [field]: value } as Partial<T>);
    else props.onValueChange(field, value, index);
  };

  return (
    <div class={styles.Container}>
      <table class={styles.EditableTable}>
        <thead>
          <tr>
            <For each={headers()}>{header => <th>{header}</th>}</For>
            <th class={styles.ActionColumn} />
          </tr>
        </thead>
        <tbody>
          <For each={displayValues()}>{(dataPoint, index) =>
            <tr class={styles.DataRow}>
              <For each={props.keys}>{header => {
                return <td>
                  <Input
                    value={dataPoint[header] ?? ""}
                    borderless
                    style={{ width: '100%' }}
                    placeholder={`Enter ${String(header)}`}
                    onChange={e => handleFieldChange(header, e.currentTarget.value, index())}
                  />
                </td>
              }}</For>
              <td class={styles.ActionCell}>
                <Show when={hasRealRows()}>
                  <Button
                    isIcon
                    color="var(--danger-color)"
                    tooltip="Delete row"
                    onClick={() => props.onDeleteItem(index())}
                  >
                    <X size={16} />
                  </Button>
                </Show>
              </td>
            </tr>
          }</For>
        </tbody>
      </table>
      <Button onClick={() => props.onNewItem({})}>
        <Plus size={15} /> Add row
      </Button>
    </div>
  );
}

export default EditableTableList;
