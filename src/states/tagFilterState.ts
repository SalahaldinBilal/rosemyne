import { createRoot } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  DATE_TIME_TAG_KEY,
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOperations,
  FilterRelationOperations,
  FilterScalar,
  FilterValueType,
  OPERATIONS_BY_TYPE,
  TagValue,
  TagValueTypeMap,
  TIME_TAG_KEY,
} from "../types/screenshot";
import fuzzysort from "fuzzysort";

let nextId = 1;

function defaultValueFor(type: FilterValueType): FilterScalar {
  if (type === "number" || type === "time" || type === "byteSize") return 0;
  if (type === "boolean") return true;
  if (type === "dateTime") return Date.now();
  return "";
}

function makeCondition(): FilterCondition {
  return { id: nextId++, kind: "condition", path: [], valueType: "string", operation: FilterOperations.equals, values: [""] };
}

function makeGroup(): FilterGroup {
  return { id: nextId++, kind: "group", relation: FilterRelationOperations.and, children: [] };
}

export function tagPathKey(path: string[]): string {
  return JSON.stringify(path);
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

function useTagFilterStateInner() {
  const [root, setRoot] = createStore<FilterGroup>(makeGroup());

  function editNode<T extends FilterNode>(id: number, kind: T["kind"], edit: (node: T) => void) {
    setRoot(produce(draft => {
      const node = findById(draft, id);
      if (node?.kind === kind) edit(node as T);
    }));
  }

  function addCondition(groupId: number) {
    editNode<FilterGroup>(groupId, "group", group => group.children.push(makeCondition()));
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

  function setConditionPath(id: number, path: string[], tagMap: TagValueTypeMap) {
    const valueType = valueTypeAtPath(tagMap, path);

    editNode<FilterCondition>(id, "condition", condition => {
      condition.path = path;

      if (valueType) {
        condition.valueType = valueType;
        condition.operation = OPERATIONS_BY_TYPE[valueType][0];
        condition.values = [defaultValueFor(valueType)];
      }
    });
  }

  function setOperation(id: number, operation: FilterOperations) {
    editNode<FilterCondition>(id, "condition", condition => { condition.operation = operation; });
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

  return { root, addCondition, addGroup, removeNode, setRelation, setConditionPath, setOperation, addValue, setValue, removeValue };
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

export function matchTagsToFilter(node: FilterNode, tags: { [key: string]: TagValue }): boolean {
  if (node.kind === "group") {
    if (node.children.length === 0) return true;

    return node.relation === FilterRelationOperations.and
      ? node.children.every(child => matchTagsToFilter(child, tags))
      : node.children.some(child => matchTagsToFilter(child, tags));
  }

  if (node.path.length === 0 || node.values.length === 0) return true;

  const candidates = resolvePath(tags, node.path);
  return candidates.some(actual => node.values.some(value => applyOperation(node.operation, value, actual)));
}

// Wrapped-value convention for Time/DateTime tags , mirrors `marker_scalar`
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

function applyOperation(operation: FilterOperations, filterValue: FilterScalar, actual: FilterScalar): boolean {
  switch (operation) {
    case FilterOperations.equals: return actual === filterValue;
    case FilterOperations.notEquals: return actual !== filterValue;
  }

  if (typeof actual === "number" && typeof filterValue === "number") {
    switch (operation) {
      case FilterOperations.greaterThan: return actual > filterValue;
      case FilterOperations.greaterThanOrEqualTo: return actual >= filterValue;
      case FilterOperations.lessThan: return actual < filterValue;
      case FilterOperations.lessThanOrEqualTo: return actual <= filterValue;
    }
  }

  if (typeof actual === "string" && typeof filterValue === "string") {
    switch (operation) {
      case FilterOperations.contains: return actual.includes(filterValue);
      case FilterOperations.notContains: return !actual.includes(filterValue);
      case FilterOperations.startsWith: return actual.startsWith(filterValue);
      case FilterOperations.endsWith: return actual.endsWith(filterValue);
      case FilterOperations.fuzzy: return filterValue.length === 0 || (fuzzysort.single(filterValue, actual)?.score ?? 0) >= 0.5;
    }
  }

  return false;
}
