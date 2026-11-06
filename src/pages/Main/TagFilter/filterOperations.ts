import { FilterCondition, FilterOperations, FilterValueType, OPERATION_LABELS, SelectItem } from "../../../types";
import { RangeShape, UiOperation } from "../../../states/tagFilterState";

export const KIND_LABELS: Record<FilterValueType, string> = {
  string: "Text",
  number: "Number",
  dateTime: "Date",
  byteSize: "Size",
  time: "Duration",
  boolean: "Yes/no",
};

type Entry = { label: string, value: UiOperation };

const plain = (operation: FilterOperations, label: string): Entry => ({ label, value: { kind: "plain", operation } });
const between: Entry = { label: "between", value: { kind: "range", range: "between" } };

const ENTRIES: Record<FilterValueType, Entry[]> = {
  string: [
    plain(FilterOperations.equals, "is"),
    plain(FilterOperations.notEquals, "is not"),
    plain(FilterOperations.contains, "contains"),
    plain(FilterOperations.notContains, "doesn't contain"),
    plain(FilterOperations.startsWith, "starts with"),
    plain(FilterOperations.endsWith, "ends with"),
    plain(FilterOperations.fuzzy, "fuzzy"),
  ],
  number: [
    plain(FilterOperations.equals, "="),
    plain(FilterOperations.notEquals, "≠"),
    plain(FilterOperations.greaterThan, ">"),
    plain(FilterOperations.greaterThanOrEqualTo, "≥"),
    plain(FilterOperations.lessThan, "<"),
    plain(FilterOperations.lessThanOrEqualTo, "≤"),
    between,
  ],
  dateTime: [
    plain(FilterOperations.greaterThan, "after"),
    plain(FilterOperations.lessThan, "before"),
    { label: "on", value: { kind: "range", range: "on" } },
    between,
  ],
  byteSize: [plain(FilterOperations.greaterThan, ">"), plain(FilterOperations.lessThan, "<"), between],
  time: [plain(FilterOperations.greaterThan, ">"), plain(FilterOperations.lessThan, "<"), between],
  boolean: [plain(FilterOperations.equals, "is")],
};

export function operationId(value: UiOperation): string {
  return value.kind === "range" ? value.range : `op-${value.operation}`;
}

export function ruleOperation(rule: FilterCondition | RangeShape): UiOperation {
  return "group" in rule ? { kind: "range", range: rule.kind } : { kind: "plain", operation: rule.operation };
}

function entryFor(valueType: FilterValueType, value: UiOperation): Entry | undefined {
  return ENTRIES[valueType].find(entry => operationId(entry.value) === operationId(value));
}

// A stored operation this kind no longer offers (from an older filter) still shows, so the row never lies.
export function operationItems(valueType: FilterValueType, current: UiOperation): SelectItem<UiOperation>[] {
  const items = ENTRIES[valueType].map(entry => ({ id: operationId(entry.value), value: entry.value, label: entry.label }));
  if (!entryFor(valueType, current) && current.kind === "plain") {
    items.push({ id: operationId(current), value: current, label: OPERATION_LABELS[current.operation] });
  }
  return items;
}

export function operationLabel(valueType: FilterValueType, value: UiOperation): string {
  return entryFor(valueType, value)?.label ?? (value.kind === "plain" ? OPERATION_LABELS[value.operation] : value.range);
}
