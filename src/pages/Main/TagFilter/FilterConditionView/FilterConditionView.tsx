import { createMemo, For, Match, Show, Switch } from "solid-js";
import styles from "./FilterConditionView.module.scss";
import { FilterCondition, FilterOperations, FilterValueType, OPERATION_LABELS, OPERATIONS_BY_TYPE, SelectItem, TagValueTypeMap } from "../../../../types";
import useTagFilterState from "../../../../states/tagFilterState";
import Button from "../../../../components/Button/Button";
import Select from "../../../../components/Select/Select";
import FilterValueField from "../controls/FilterValueField";
import DurationField from "../controls/DurationField";
import { Plus, Trash2, X } from "lucide-solid";

type Level = { options: string[], selected: string | null, depth: number };

const ICON_STYLE = { height: "34px", "min-width": "34px" } as const;
const BOOLEAN_ITEMS: SelectItem<boolean>[] = [
  { id: "true", value: true, label: "True" },
  { id: "false", value: false, label: "False" },
];

// `boolean` and `time` are unused , those valueTypes render the `<Select>`/
// `<DurationField>` branches below instead.
const INPUT_TYPE: Record<FilterValueType, "number" | "string" | "datetime-local"> = {
  number: "number",
  string: "string",
  boolean: "string",
  time: "string",
  dateTime: "datetime-local",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// `<input type="datetime-local">` reads/writes local wall-clock time as a
// plain (timezone-less) string; `Date`'s local getters/constructor do the ms conversion.
function msToDateTimeLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function dateTimeLocalToMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function formatFieldValue(type: FilterValueType, value: string | number): string | number {
  if (type === "dateTime") return msToDateTimeLocal(value as number);
  return value;
}

// `$`-prefixed keys are reserved system fields (`$file`); show them prettified.
function keyLabel(key: string): string {
  return key.startsWith("$") ? key.charAt(1).toUpperCase() + key.slice(2) : key;
}

function FilterConditionView(props: { node: FilterCondition, tagMap: TagValueTypeMap }) {
  const { setConditionPath, setOperation, addValue, setValue, removeValue, removeNode } = useTagFilterState;

  const levels = createMemo<Level[]>(() => {
    const result: Level[] = [];
    let map: TagValueTypeMap | null = props.tagMap;
    let depth = 0;

    while (map) {
      const selected = props.node.path[depth] ?? null;
      result.push({ options: Object.keys(map), selected, depth });

      if (selected === null) break;
      const entry: TagValueTypeMap[string] | undefined = map[selected];
      if (!entry || typeof entry.type !== "object") break;

      map = entry.type;
      depth++;
    }

    return result;
  });

  const operationItems = createMemo<SelectItem<FilterOperations>[]>(() =>
    OPERATIONS_BY_TYPE[props.node.valueType].map(operation => ({ id: operation, value: operation, label: OPERATION_LABELS[operation] }))
  );

  function selectLevel(depth: number, key: string) {
    setConditionPath(props.node.id, [...props.node.path.slice(0, depth), key], props.tagMap);
  }

  function changeValue(index: number, raw: string) {
    switch (props.node.valueType) {
      case "number": return setValue(props.node.id, index, Number(raw));
      case "dateTime": return setValue(props.node.id, index, dateTimeLocalToMs(raw));
      default: return setValue(props.node.id, index, raw);
    }
  }

  return (
    <div class={styles.Condition}>
      <div class={styles.Body}>
        <div class={styles.Path}>
          <For each={levels()}>{(level, index) =>
            <>
              <Show when={index() > 0}><span class={styles.Sep}>›</span></Show>
              <Select
                value={level.selected ?? ""}
                items={level.options.map(key => ({ id: key, value: key, label: keyLabel(key) }))}
                placeholder="Select tag…"
                onItemClick={item => item.value && selectLevel(level.depth, item.value)}
              />
            </>
          }</For>
        </div>

        <Show when={props.node.values.length > 0}>
          <Select accent value={props.node.operation} items={operationItems()} onItemClick={item => setOperation(props.node.id, item.value)} />

          <div class={styles.Values}>
            <For each={props.node.values}>{(value, index) =>
              <div class={styles.Value}>
                <Switch fallback={
                  <FilterValueField
                    type={INPUT_TYPE[props.node.valueType]}
                    value={formatFieldValue(props.node.valueType, value as string | number)}
                    path={props.node.path}
                    onChange={raw => changeValue(index(), raw)}
                  />
                }>
                  <Match when={props.node.valueType === "boolean"}>
                    <Select value={String(value)} items={BOOLEAN_ITEMS} onItemClick={item => setValue(props.node.id, index(), item.value)} />
                  </Match>
                  <Match when={props.node.valueType === "time"}>
                    <DurationField valueMs={value as number} onChange={ms => setValue(props.node.id, index(), ms)} />
                  </Match>
                </Switch>
                <Show when={props.node.values.length > 1}>
                  <Button isIcon tooltip="Remove value" style={ICON_STYLE} onClick={() => removeValue(props.node.id, index())}>
                    <X size={15} />
                  </Button>
                </Show>
              </div>
            }</For>
            <Button isIcon tooltip="Add value" style={ICON_STYLE} onClick={() => addValue(props.node.id)}>
              <Plus size={15} />
            </Button>
          </div>
        </Show>
      </div>

      <Button isIcon tooltip="Remove condition" color="var(--danger-color)" style={ICON_STYLE} onClick={() => removeNode(props.node.id)}>
        <Trash2 size={15} />
      </Button>
    </div>
  );
}

export default FilterConditionView;
