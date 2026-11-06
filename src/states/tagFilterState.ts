import { createMemo, createRoot, createSignal } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import {
  DATE_TIME_TAG_KEY,
  DatePreset,
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOperations,
  FilterRelationOperations,
  FilterScalar,
  FilterValueType,
  HistoryItemType,
  OPERATIONS_BY_TYPE,
  QuickFilters,
  SavedFilter,
  TagValue,
  TagValueTypeMap,
  TIME_TAG_KEY,
} from "../types/screenshot";
import { safeInvoke } from "../helpers/safeInvoke";
import fuzzysort from "fuzzysort";

let nextId = 1;

const DAY_MS = 86_400_000;
const FILE_TAG = "$file";
const SEARCH_PATHS = [[FILE_TAG, "Name"], ["Windows", "Window Name"], ["Windows", "Process Name"]];
const HISTORY_TYPES: HistoryItemType[] = ["image", "video", "file"];
const DATE_PRESETS: DatePreset[] = ["any", "today", "week", "month", "year"];

// The operation a condition starts with when its tag changes, matching the first entry the row offers.
const FIRST_OPERATION: Record<FilterValueType, FilterOperations> = {
  string: FilterOperations.equals,
  number: FilterOperations.equals,
  boolean: FilterOperations.equals,
  dateTime: FilterOperations.greaterThan,
  byteSize: FilterOperations.greaterThan,
  time: FilterOperations.greaterThan,
};

export function startOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function endOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - 1;
}

function defaultValueFor(type: FilterValueType): FilterScalar {
  if (type === "number" || type === "time" || type === "byteSize") return 0;
  if (type === "boolean") return true;
  if (type === "dateTime") return endOfDay(Date.now() - 7 * DAY_MS);
  return "";
}

function emptyConditionFields(): Omit<FilterCondition, "id" | "kind"> {
  return { path: [], valueType: "string", operation: FilterOperations.equals, values: [""], caseSensitive: false };
}

function makeCondition(fields?: Partial<Omit<FilterCondition, "id" | "kind">>): FilterCondition {
  return { id: nextId++, kind: "condition", ...emptyConditionFields(), ...fields };
}

function makeGroup(): FilterGroup {
  return { id: nextId++, kind: "group", relation: FilterRelationOperations.and, scope: [], children: [] };
}

function isFilterScalar(value: unknown): value is FilterScalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function adoptNode(raw: unknown): FilterNode | null {
  if (!raw || typeof raw !== "object") return null;

  const source = raw as Record<string, unknown>;
  if (source.kind === "group") return adoptGroup(source);
  if (source.kind !== "condition") return null;

  const valueType = (source.valueType as FilterValueType) in OPERATIONS_BY_TYPE ? source.valueType as FilterValueType : "string";
  const operations = OPERATIONS_BY_TYPE[valueType];
  const values = Array.isArray(source.values) ? source.values.filter(isFilterScalar) : [];

  return {
    id: nextId++,
    kind: "condition",
    path: stringList(source.path),
    valueType,
    operation: operations.includes(source.operation as FilterOperations) ? source.operation as FilterOperations : operations[0],
    values: values.length > 0 ? values : [defaultValueFor(valueType)],
    caseSensitive: source.caseSensitive === true,
  };
}

// Fresh ids: a stored tree's own would collide with `nextId` and misdirect `findById`.
function adoptGroup(raw: unknown): FilterGroup {
  const source = (raw ?? {}) as Record<string, unknown>;
  const children = Array.isArray(source.children) ? source.children : [];

  return {
    id: nextId++,
    kind: "group",
    relation: source.relation === FilterRelationOperations.or ? FilterRelationOperations.or : FilterRelationOperations.and,
    scope: stringList(source.scope),
    children: children.map(adoptNode).filter((node): node is FilterNode => node !== null),
  };
}

function emptyQuick(): QuickFilters {
  return { search: "", types: [], date: "any" };
}

function adoptQuick(raw: unknown): QuickFilters {
  if (!raw || typeof raw !== "object") return emptyQuick();
  const source = raw as Record<string, unknown>;
  return {
    search: typeof source.search === "string" ? source.search : "",
    types: stringList(source.types).filter((type): type is HistoryItemType => HISTORY_TYPES.includes(type as HistoryItemType)),
    date: DATE_PRESETS.includes(source.date as DatePreset) ? source.date as DatePreset : "any",
  };
}

export function datePresetStart(preset: DatePreset, now = Date.now()): number | null {
  const today = startOfDay(now);
  switch (preset) {
    case "today": return today;
    case "week": return today - 6 * DAY_MS;
    case "month": return today - 29 * DAY_MS;
    case "year": return new Date(new Date(now).getFullYear(), 0, 1).getTime();
    default: return null;
  }
}

export function tagPathKey(path: string[]): string {
  return JSON.stringify(path);
}

// `$`-prefixed keys are reserved system fields (`$file`); show them prettified.
export function keyLabel(key: string): string {
  return key.startsWith("$") ? key.charAt(1).toUpperCase() + key.slice(2) : key;
}

export function tagMapAtPath(tagMap: TagValueTypeMap, path: string[]): TagValueTypeMap {
  let map = tagMap;

  for (const key of path) {
    const entry = map[key];
    if (!entry || typeof entry.type !== "object") return {};
    map = entry.type;
  }

  return map;
}

// Object-array paths only; scoping to a single object is what an unscoped group already does.
export function scopePaths(tagMap: TagValueTypeMap, prefix: string[] = []): string[][] {
  const out: string[][] = [];

  for (const [key, entry] of Object.entries(tagMap)) {
    if (typeof entry.type !== "object") continue;

    const path = [...prefix, key];
    if (entry.isArray) out.push(path);
    out.push(...scopePaths(entry.type, path));
  }

  return out;
}

export type TagLeaf = { path: string[], valueType: FilterValueType };

export function leafPaths(tagMap: TagValueTypeMap, prefix: string[] = []): TagLeaf[] {
  const out: TagLeaf[] = [];

  for (const [key, entry] of Object.entries(tagMap)) {
    const path = [...prefix, key];
    if (typeof entry.type === "object") out.push(...leafPaths(entry.type, path));
    else out.push({ path, valueType: entry.type });
  }

  return out;
}

export function valueTypeAtPath(tagMap: TagValueTypeMap, path: string[]): FilterValueType | null {
  let map: TagValueTypeMap = tagMap;

  for (let i = 0; i < path.length; i++) {
    const entry = map[path[i]];
    if (!entry) return null;

    if (i === path.length - 1) return typeof entry.type === "object" ? null : entry.type;
    if (typeof entry.type !== "object") return null;
    map = entry.type;
  }

  return null;
}

// "between" and date "on" are two conditions (at least low, at most high) in an AND group, shown as one row.
export type RangeKind = "between" | "on";
export type RangeShape = { group: FilterGroup, low: FilterCondition, high: FilterCondition, kind: RangeKind };

export function asRange(node: FilterNode): RangeShape | null {
  if (node.kind !== "group" || node.relation !== FilterRelationOperations.and || node.scope.length > 0 || node.children.length !== 2) return null;

  const [a, b] = node.children;
  if (a.kind !== "condition" || b.kind !== "condition") return null;
  if (tagPathKey(a.path) !== tagPathKey(b.path) || a.valueType !== b.valueType || a.path.length === 0) return null;
  if (a.values.length !== 1 || b.values.length !== 1) return null;

  const low = a.operation === FilterOperations.greaterThanOrEqualTo ? a : b.operation === FilterOperations.greaterThanOrEqualTo ? b : null;
  const high = low === a ? b : a;
  if (!low || high.operation !== FilterOperations.lessThanOrEqualTo) return null;

  const lowValue = low.values[0];
  const highValue = high.values[0];
  const isDay = low.valueType === "dateTime"
    && typeof lowValue === "number"
    && lowValue === startOfDay(lowValue)
    && highValue === endOfDay(lowValue);

  return { group: node, low, high, kind: isDay ? "on" : "between" };
}

export function conditionHasValue(condition: FilterCondition): boolean {
  if (condition.path.length === 0) return false;
  if (condition.valueType !== "string") return true;
  return condition.values.some(value => value !== "");
}

// Every leaf rule in display order: ranges count as one, plain groups are walked into.
export function flattenRules(group: FilterGroup): (FilterCondition | RangeShape)[] {
  return group.children.flatMap(child => {
    const range = asRange(child);
    if (range) return [range];
    if (child.kind === "group") return flattenRules(child);
    return [child];
  });
}

function findById(node: FilterNode, id: number): FilterNode | null {
  if (node.id === id) return node;
  if (node.kind !== "group") return null;

  for (const child of node.children) {
    const found = findById(child, id);
    if (found) return found;
  }

  return null;
}

function findParentOf(group: FilterGroup, id: number): FilterGroup | null {
  for (const child of group.children) {
    if (child.id === id) return group;
    if (child.kind === "group") {
      const found = findParentOf(child, id);
      if (found) return found;
    }
  }

  return null;
}

function rangeGroup(base: FilterCondition, low: FilterScalar, high: FilterScalar): FilterGroup {
  const shared = { path: [...base.path], valueType: base.valueType, caseSensitive: false };
  return {
    ...makeGroup(),
    children: [
      makeCondition({ ...shared, operation: FilterOperations.greaterThanOrEqualTo, values: [low] }),
      makeCondition({ ...shared, operation: FilterOperations.lessThanOrEqualTo, values: [high] }),
    ],
  };
}

export type UiOperation = { kind: "plain", operation: FilterOperations } | { kind: "range", range: RangeKind };

function useTagFilterStateInner() {
  const [root, setRoot] = createStore<FilterGroup>(makeGroup());
  const [quick, setQuick] = createStore<QuickFilters>(emptyQuick());
  const [savedFilters, setSavedFilters] = createSignal<SavedFilter[]>([]);
  const [activeFilterName, setActiveFilterName] = createSignal<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = createSignal<string | null>(null);
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const [pendingPickerId, setPendingPickerId] = createSignal<number | null>(null);
  const [focusRequest, setFocusRequest] = createSignal<number | null>(null);

  const currentSnapshot = () => JSON.stringify({ root: unwrap(root), quick: unwrap(quick) });
  const isFilterDirty = createMemo(() => savedSnapshot() !== null && JSON.stringify({ root, quick }) !== savedSnapshot());

  const ruleCount = createMemo(() => {
    const walk = (group: FilterGroup): number =>
      group.children.reduce((sum, child) => sum + (child.kind === "group" ? walk(child) : 1), 0);
    return walk(root);
  });

  const rules = createMemo(() => flattenRules(root));
  const activeRuleCount = createMemo(() =>
    rules().filter(rule => "group" in rule ? rule.low.path.length > 0 : conditionHasValue(rule)).length,
  );
  const quickActive = createMemo(() => quick.search.trim() !== "" || quick.types.length > 0 || quick.date !== "any");
  const anyFilterActive = createMemo(() => quickActive() || ruleCount() > 0);

  function filterSnapshot(): FilterGroup {
    return JSON.parse(JSON.stringify(unwrap(root)));
  }

  function quickNodes(excludeTypes: boolean): FilterNode[] {
    const nodes: FilterNode[] = [];
    const search = quick.search.trim();

    if (search) {
      nodes.push({
        id: -1,
        kind: "group",
        relation: FilterRelationOperations.or,
        scope: [],
        children: SEARCH_PATHS.map((path, index) => ({
          id: -10 - index,
          kind: "condition",
          path,
          valueType: "string",
          operation: FilterOperations.contains,
          values: [search],
          caseSensitive: false,
        })),
      });
    }

    if (!excludeTypes && quick.types.length > 0) {
      nodes.push({
        id: -2,
        kind: "condition",
        path: [FILE_TAG, "Type"],
        valueType: "string",
        operation: FilterOperations.equals,
        values: [...quick.types],
        caseSensitive: false,
      });
    }

    const start = datePresetStart(quick.date);
    if (start !== null) {
      nodes.push({
        id: -3,
        kind: "condition",
        path: [FILE_TAG, "DateTime"],
        valueType: "dateTime",
        operation: FilterOperations.greaterThanOrEqualTo,
        values: [start],
        caseSensitive: false,
      });
    }

    return nodes;
  }

  // The quick filters are ANDed with the tree here, never stored inside it.
  function queryFilter(excludeTypes = false): FilterGroup {
    return {
      id: 0,
      kind: "group",
      relation: FilterRelationOperations.and,
      scope: [],
      children: [...quickNodes(excludeTypes), filterSnapshot()],
    };
  }

  function markSaved(name: string | null) {
    setActiveFilterName(name);
    setSavedSnapshot(name === null ? null : currentSnapshot());
  }

  async function refreshSavedFilters() {
    setSavedFilters(await safeInvoke("get_saved_filters"));
  }

  function loadFilter(saved: SavedFilter) {
    setRoot(adoptGroup(saved.filter));
    setQuick(reconcile(adoptQuick(saved.filter.quick)));
    markSaved(saved.name);
  }

  async function saveFilterAs(name: string) {
    await safeInvoke("save_filter", { name, filter: { ...filterSnapshot(), quick: structuredClone(unwrap(quick)) } });
    markSaved(name.trim());
    await refreshSavedFilters();
  }

  async function deleteFilter(name: string) {
    await safeInvoke("delete_saved_filter", { name });
    if (activeFilterName() === name) markSaved(null);
    await refreshSavedFilters();
  }

  function clearFilter() {
    setRoot(makeGroup());
    setQuick(reconcile(emptyQuick()));
    markSaved(null);
  }

  function setSearch(search: string) {
    setQuick("search", search);
  }

  function toggleType(type: HistoryItemType) {
    setQuick("types", types => types.includes(type) ? types.filter(entry => entry !== type) : [...types, type]);
  }

  function clearTypes() {
    setQuick("types", []);
  }

  function setDatePreset(date: DatePreset) {
    setQuick("date", date);
  }

  function editNode<T extends FilterNode>(id: number, kind: T["kind"], edit: (node: T) => void) {
    setRoot(produce(draft => {
      const node = findById(draft, id);
      if (node?.kind === kind) edit(node as T);
    }));
  }

  function replaceNode(id: number, build: (node: FilterNode) => FilterNode) {
    setRoot(produce(draft => {
      const parent = findParentOf(draft, id);
      if (!parent) return;
      const index = parent.children.findIndex(child => child.id === id);
      if (index >= 0) parent.children[index] = build(JSON.parse(JSON.stringify(parent.children[index])));
    }));
  }

  function addCondition(groupId: number) {
    const condition = makeCondition();
    editNode<FilterGroup>(groupId, "group", group => group.children.push(condition));
    setPendingPickerId(condition.id);
  }

  function addGroup(groupId: number) {
    editNode<FilterGroup>(groupId, "group", group => group.children.push(makeGroup()));
  }

  function removeNode(id: number) {
    setRoot(produce(draft => {
      const parent = findParentOf(draft, id);
      if (!parent) return;

      const index = parent.children.findIndex(child => child.id === id);
      if (index >= 0) parent.children.splice(index, 1);
    }));
  }

  function setRelation(groupId: number, relation: FilterRelationOperations) {
    editNode<FilterGroup>(groupId, "group", group => { group.relation = relation; });
  }

  function toggleRelation(groupId: number) {
    editNode<FilterGroup>(groupId, "group", group => {
      group.relation = group.relation === FilterRelationOperations.and ? FilterRelationOperations.or : FilterRelationOperations.and;
    });
  }

  // Descendant paths were relative to the old scope, so they can't survive it.
  function resetPaths(node: FilterNode) {
    if (node.kind === "group") {
      node.scope = [];
      node.children.forEach(resetPaths);
      return;
    }

    Object.assign(node, emptyConditionFields());
  }

  function setGroupScope(groupId: number, scope: string[]) {
    editNode<FilterGroup>(groupId, "group", group => {
      group.scope = scope;
      group.children.forEach(resetPaths);
    });
  }

  // Works on a plain condition or a range row. Either way the row becomes a fresh condition for the new tag.
  function setConditionPath(id: number, path: string[], tagMap: TagValueTypeMap): number {
    const valueType = valueTypeAtPath(tagMap, path) ?? "string";
    const keepsId = findById(root, id)?.kind === "condition";
    const nextConditionId = keepsId ? id : nextId++;

    replaceNode(id, node => ({
      ...makeCondition({
        path,
        valueType,
        operation: FIRST_OPERATION[valueType],
        values: [defaultValueFor(valueType)],
        caseSensitive: node.kind === "condition" ? node.caseSensitive : false,
      }),
      id: nextConditionId,
    }));
    return nextConditionId;
  }

  function setUiOperation(id: number, next: UiOperation) {
    replaceNode(id, node => {
      const range = asRange(node);
      const base = range ? range.low : node.kind === "condition" ? node : null;
      if (!base) return node;

      const first = base.values[0] ?? defaultValueFor(base.valueType);
      const isDate = base.valueType === "dateTime" && typeof first === "number";

      if (next.kind === "plain") {
        let value = first;
        if (isDate && next.operation === FilterOperations.greaterThan) value = endOfDay(first as number);
        if (isDate && next.operation === FilterOperations.lessThan) value = startOfDay(first as number);
        const values = range ? [value] : base.values.map((entry, index) => index === 0 ? value : entry);
        return { ...base, id: range ? nextId++ : base.id, operation: next.operation, values };
      }

      if (next.range === "on" && isDate) return rangeGroup(base, startOfDay(first as number), endOfDay(first as number));
      if (range) return rangeGroup(base, range.low.values[0], range.high.values[0]);
      return rangeGroup(base, isDate ? startOfDay(first as number) : first, isDate ? endOfDay(first as number) : first);
    });
  }

  function setOperation(id: number, operation: FilterOperations) {
    editNode<FilterCondition>(id, "condition", condition => { condition.operation = operation; });
  }

  function setCaseSensitive(id: number, caseSensitive: boolean) {
    editNode<FilterCondition>(id, "condition", condition => { condition.caseSensitive = caseSensitive; });
  }

  function addValue(id: number) {
    editNode<FilterCondition>(id, "condition", condition => condition.values.push(defaultValueFor(condition.valueType)));
  }

  function setValue(id: number, index: number, value: FilterScalar) {
    editNode<FilterCondition>(id, "condition", condition => { condition.values[index] = value; });
  }

  function removeValue(id: number, index: number) {
    editNode<FilterCondition>(id, "condition", condition => {
      if (condition.values.length > 1) condition.values.splice(index, 1);
    });
  }

  // "on" keeps both ends pinned to the same day.
  function setRangeDay(groupId: number, ms: number) {
    editNode<FilterGroup>(groupId, "group", group => {
      const range = asRange(group);
      if (!range) return;
      const low = group.children.find(child => child.id === range.low.id) as FilterCondition;
      const high = group.children.find(child => child.id === range.high.id) as FilterCondition;
      low.values = [startOfDay(ms)];
      high.values = [endOfDay(ms)];
    });
  }

  return {
    root, quick, addCondition, addGroup, removeNode, setRelation, toggleRelation, setGroupScope, setConditionPath, setUiOperation,
    setOperation, setCaseSensitive, addValue, setValue, removeValue, setRangeDay,
    setSearch, toggleType, clearTypes, setDatePreset, quickActive, anyFilterActive, rules, activeRuleCount,
    savedFilters, activeFilterName, isFilterDirty, ruleCount, filtersOpen, setFiltersOpen, filterSnapshot, queryFilter,
    refreshSavedFilters, loadFilter, saveFilterAs, deleteFilter, clearFilter,
    pendingPickerId, setPendingPickerId, focusRequest, setFocusRequest,
  };
}

const useTagFilterState = createRoot(useTagFilterStateInner);
export default useTagFilterState;

// Mirrors `augment_tags` in `history_store::filter` (Rust): injects the
// virtual `$file` tag (backed by table columns, not the tags JSON) so a
// filter referencing `$file.*` can be evaluated client-side. `fileSize` is
// omitted (not set to `undefined`-as-a-value) when absent, so `resolvePath`
// treats it as a genuinely missing key, same as any other optional tag.
export function augmentTags(
  tags: { [key: string]: TagValue } | null,
  fileName: string,
  filePath: string,
  itemType: string,
  dateTimeMs: number,
  fileSize?: number,
): { [key: string]: TagValue } {
  const file: { [key: string]: TagValue } = { Name: fileName, Path: filePath, Type: itemType, DateTime: dateTimeMs };
  if (fileSize !== undefined) file.Size = fileSize;

  return {
    ...(tags ?? {}),
    "$file": file,
  };
}

export function matchTagsToFilter(node: FilterNode, tags: TagValue): boolean {
  if (node.kind === "group") {
    if (node.children.length === 0) return true;

    const matchChildren = (scoped: TagValue) => node.relation === FilterRelationOperations.and
      ? node.children.every(child => matchTagsToFilter(child, scoped))
      : node.children.some(child => matchTagsToFilter(child, scoped));

    if (node.scope.length === 0) return matchChildren(tags);
    return resolveScope(tags, node.scope).some(candidate => matchChildren(candidate));
  }

  if (node.path.length === 0 || node.values.length === 0) return true;

  const candidates = resolvePath(tags, node.path);
  return candidates.some(actual => node.values.some(value => applyOperation(node.operation, value, actual, node.caseSensitive)));
}

// Mirrors `fold` in `history_store::filter` (Rust), which uses `to_lowercase`.
function cased(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

// Wrapped-value convention for Time/DateTime tags, mirrors `marker_scalar`
// in `history_store::filter` (Rust): a single-key object wrapping a
// millisecond number unwraps to that number instead of being treated as a
// nested object.
function markerScalar(value: TagValue): number | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;

  const inner = value[keys[0]];
  if ((keys[0] !== TIME_TAG_KEY && keys[0] !== DATE_TIME_TAG_KEY) || typeof inner !== "number") return null;
  return inner;
}

export function tagNumber(value: TagValue | undefined): number | null {
  if (typeof value === "number") return value;
  if (value === undefined) return null;
  return markerScalar(value);
}

// Mirrors `resolve_scope` (Rust): the containers at the path, not the scalars under it.
function resolveScope(value: TagValue, path: string[]): TagValue[] {
  if (Array.isArray(value)) return (value as TagValue[]).flatMap(item => resolveScope(item, path));
  if (path.length === 0) return value === null ? [] : [value];
  if (value === null || typeof value !== "object") return [];

  const [head, ...rest] = path;
  const next = (value as { [key: string]: TagValue })[head];
  return next === undefined ? [] : resolveScope(next, rest);
}

function resolvePath(value: TagValue, path: string[]): FilterScalar[] {
  if (Array.isArray(value)) return value.flatMap(item => resolvePath(item as TagValue, path));

  if (path.length === 0) {
    if (value === null) return [];
    if (typeof value === "object") {
      const marker = markerScalar(value);
      return marker === null ? [] : [marker];
    }
    return [value];
  }

  if (value === null || typeof value !== "object") return [];

  const [head, ...rest] = path;
  return resolvePath((value as { [key: string]: TagValue })[head], rest);
}

function applyOperation(operation: FilterOperations, filterValue: FilterScalar, actual: FilterScalar, caseSensitive: boolean): boolean {
  const bothStrings = typeof actual === "string" && typeof filterValue === "string";

  switch (operation) {
    case FilterOperations.equals:
    case FilterOperations.notEquals: {
      const equal = bothStrings
        ? cased(actual, caseSensitive) === cased(filterValue, caseSensitive)
        : actual === filterValue;
      return operation === FilterOperations.equals ? equal : !equal;
    }
  }

  if (typeof actual === "number" && typeof filterValue === "number") {
    switch (operation) {
      case FilterOperations.greaterThan: return actual > filterValue;
      case FilterOperations.greaterThanOrEqualTo: return actual >= filterValue;
      case FilterOperations.lessThan: return actual < filterValue;
      case FilterOperations.lessThanOrEqualTo: return actual <= filterValue;
    }
  }

  if (bothStrings) {
    const value = cased(actual, caseSensitive);
    const filter = cased(filterValue, caseSensitive);

    switch (operation) {
      case FilterOperations.contains: return value.includes(filter);
      case FilterOperations.notContains: return !value.includes(filter);
      case FilterOperations.startsWith: return value.startsWith(filter);
      case FilterOperations.endsWith: return value.endsWith(filter);
      case FilterOperations.fuzzy: return filter.length === 0 || (fuzzysort.single(filter, value)?.score ?? 0) >= 0.5;
    }
  }

  return false;
}
