import styles from "./FilterPills.module.scss";
import { createMemo, For, Show } from "solid-js";
import { FilterCondition, FilterOperations, FilterRelationOperations, FilterScalar, FilterValueType } from "../../../../types";
import useTagFilterState, { conditionHasValue, keyLabel, RangeShape } from "../../../../states/tagFilterState";
import { operationLabel, ruleOperation } from "../filterOperations";
import { DATE_PRESET_ITEMS, TYPE_ITEMS } from "../FilterToolbar/FilterToolbar";
import { formatBytes, formatDuration, formatShortDate } from "../../../../helpers/format";
import Button from "../../../../components/Button/Button";
import { X } from "lucide-solid";

type Pill = {
  key: string,
  label: string,
  operation?: string,
  value: string,
  isRule: boolean,
  onRemove: () => void,
  onOpen: () => void,
};

function valueLabel(valueType: FilterValueType, value: FilterScalar, isPercent: boolean): string {
  if (typeof value !== "number") return valueType === "boolean" ? (value ? "Yes" : "No") : String(value);
  switch (valueType) {
    case "dateTime": return formatShortDate(value);
    case "byteSize": return formatBytes(value);
    case "time": return formatDuration(value);
    default: return isPercent ? `${value}%` : String(value);
  }
}

function rulePill(rule: FilterCondition | RangeShape, actions: { remove: (id: number) => void, open: (id: number) => void }): Pill | null {
  const range = "group" in rule ? rule : null;
  const condition = range?.low ?? (rule as FilterCondition);
  if (range ? condition.path.length === 0 : !conditionHasValue(condition)) return null;

  const id = range?.group.id ?? condition.id;
  const last = condition.path[condition.path.length - 1];
  const isPercent = /percent/i.test(last);
  const label = (value: FilterScalar) => valueLabel(condition.valueType, value, isPercent);

  let value: string;
  if (range?.kind === "on") value = label(range.low.values[0]);
  else if (range) value = `${label(range.low.values[0])} to ${label(range.high.values[0])}`;
  else if (condition.valueType === "boolean") {
    const yes = (condition.values[0] === true) !== (condition.operation === FilterOperations.notEquals);
    value = yes ? "Yes" : "No";
  }
  else value = condition.values.filter(entry => entry !== "").map(label).join(" or ");

  return {
    key: `rule-${id}`,
    label: keyLabel(last),
    operation: operationLabel(condition.valueType, ruleOperation(rule)),
    value,
    isRule: true,
    onRemove: () => actions.remove(id),
    onOpen: () => actions.open(id),
  };
}

function FilterPills(props: { onSearchClick: () => void }) {
  const { quick, root, rules, setSearch, clearTypes, setDatePreset, removeNode, setFiltersOpen, setFocusRequest, clearFilter } = useTagFilterState;

  function openRule(id: number) {
    setFiltersOpen(true);
    setFocusRequest(id);
  }

  const pills = createMemo<Pill[]>(() => {
    const out: Pill[] = [];
    const search = quick.search.trim();

    if (search) {
      out.push({ key: "search", label: "Search", value: `"${search}"`, isRule: false, onRemove: () => setSearch(""), onOpen: props.onSearchClick });
    }
    if (quick.types.length > 0) {
      const names = TYPE_ITEMS.filter(item => quick.types.includes(item.type)).map(item => item.label);
      out.push({ key: "types", label: "Type", value: names.join(" or "), isRule: false, onRemove: clearTypes, onOpen: () => { } });
    }
    if (quick.date !== "any") {
      const name = DATE_PRESET_ITEMS.find(item => item.id === quick.date)?.label ?? "";
      out.push({ key: "date", label: "Date", value: name, isRule: false, onRemove: () => setDatePreset("any"), onOpen: () => { } });
    }

    for (const rule of rules()) {
      const pill = rulePill(rule, { remove: removeNode, open: openRule });
      if (pill) out.push(pill);
    }
    return out;
  });

  const keys = createMemo(() => pills().map(pill => pill.key));
  const byKey = createMemo(() => new Map(pills().map(pill => [pill.key, pill])));
  const joinWord = createMemo(() => root.relation === FilterRelationOperations.or ? "or" : "and");

  return (
    <Show when={keys().length > 0}>
      <div class={styles.Pills}>
        <For each={keys()}>
          {(key, index) => {
            const pill = createMemo(() => byKey().get(key));
            const showJoin = createMemo(() => {
              const previous = index() > 0 ? byKey().get(keys()[index() - 1]) : undefined;
              return !!pill()?.isRule && !!previous?.isRule;
            });

            return (
              <Show when={pill()}>
                {current => <>
                  <Show when={showJoin()}><span class={styles.Join}>{joinWord()}</span></Show>
                  <span class={styles.Pill} classList={{ [styles.Clickable]: current().isRule || current().key === "search" }} onClick={() => current().onOpen()}>
                    <span class={styles.Key}>{current().label}</span>
                    <Show when={current().operation}><span class={styles.Operation}>{current().operation}</span></Show>
                    <b title={current().value}>{current().value}</b>
                    <button
                      type="button"
                      class={styles.Remove}
                      aria-label="Remove"
                      onClick={event => { event.stopPropagation(); current().onRemove(); }}
                    >
                      <X size={12} />
                    </button>
                  </span>
                </>}
              </Show>
            );
          }}
        </For>
        <Show when={keys().length > 1}>
          <Button size="sm" variant="ghost" onClick={clearFilter}>Clear all</Button>
        </Show>
      </div>
    </Show>
  );
}

export default FilterPills;
