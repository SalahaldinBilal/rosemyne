import { SelectItem, TagValue } from "../../../types";

export type TagKind = "string" | "number" | "boolean" | "object" | "array" | "null";

export type TagEntry = {
  id: number;
  key: string;
  kind: TagKind;
  scalar: string | number | boolean;
  children: TagEntry[];
  expanded: boolean;
};

let nextId = 1;

export const KIND_ITEMS: SelectItem<TagKind>[] = [
  { id: "string", value: "string", label: "Text" },
  { id: "number", value: "number", label: "Number" },
  { id: "boolean", value: "boolean", label: "True/False" },
  { id: "object", value: "object", label: "Group" },
  { id: "array", value: "array", label: "List" },
];

export const BOOLEAN_ITEMS: SelectItem<boolean>[] = [
  { id: "true", value: true, label: "True" },
  { id: "false", value: false, label: "False" },
];

function defaultScalarFor(kind: TagKind): string | number | boolean {
  if (kind === "number") return 0;
  if (kind === "boolean") return false;
  return "";
}

export function makeEntry(key: string, kind: TagKind = "string"): TagEntry {
  return { id: nextId++, key, kind, scalar: defaultScalarFor(kind), children: [], expanded: true };
}

function kindOf(value: TagValue): TagKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function tagValueToEntry(value: TagValue, key: string): TagEntry {
  const entry = makeEntry(key, kindOf(value));

  if (entry.kind === "object") {
    entry.children = Object.entries(value as { [key: string]: TagValue }).map(([childKey, childValue]) => tagValueToEntry(childValue, childKey));
  } else if (entry.kind === "array") {
    entry.children = (value as TagValue[]).map(item => tagValueToEntry(item, ""));
  } else if (entry.kind !== "null") {
    entry.scalar = value as string | number | boolean;
  }

  return entry;
}

export function tagsToEntries(tags: { [key: string]: TagValue } | null): TagEntry[] {
  return Object.entries(tags ?? {}).map(([key, value]) => tagValueToEntry(value, key));
}

function entryToTagValue(entry: TagEntry): TagValue {
  switch (entry.kind) {
    case "null": return null;
    case "object": return entriesToObject(entry.children);
    // Runtime tags can mix item shapes even though `TagValue`'s array
    // variants are individually homogeneous , this editor doesn't restrict that.
    case "array": return entry.children.map(entryToTagValue) as TagValue;
    default: return entry.scalar;
  }
}

export function entriesToObject(entries: TagEntry[]): { [key: string]: TagValue } {
  const out: { [key: string]: TagValue } = {};
  for (const entry of entries) {
    const key = entry.key.trim();
    if (key) out[key] = entryToTagValue(entry);
  }
  return out;
}

// Recurses through the tree, flagging entry ids with a key problem: empty,
// a reserved top-level `$` prefix, or a duplicate within the same object.
// Array items have no `key` field, so `showKeys` skips straight to their children.
export function collectKeyErrors(entries: TagEntry[], topLevel: boolean, showKeys: boolean, out: Map<number, string>): void {
  if (showKeys) {
    const seen = new Map<string, number>();
    for (const entry of entries) {
      const key = entry.key.trim();
      if (!key) out.set(entry.id, "Name required");
      else if (topLevel && key.startsWith("$")) out.set(entry.id, 'Can\'t start with "$" (reserved)');
      else if (seen.has(key)) {
        out.set(entry.id, "Duplicate name");
        out.set(seen.get(key)!, "Duplicate name");
      } else {
        seen.set(key, entry.id);
      }
    }
  }

  for (const entry of entries) {
    if (entry.kind === "object") collectKeyErrors(entry.children, false, true, out);
    else if (entry.kind === "array") collectKeyErrors(entry.children, false, false, out);
  }
}

export function findEntry(entries: TagEntry[], id: number): TagEntry | null {
  for (const entry of entries) {
    if (entry.id === id) return entry;
    if (entry.kind === "object" || entry.kind === "array") {
      const found = findEntry(entry.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findParentList(entries: TagEntry[], id: number): TagEntry[] | null {
  for (const entry of entries) {
    if (entry.id === id) return entries;
    if (entry.kind === "object" || entry.kind === "array") {
      const found = findParentList(entry.children, id);
      if (found) return found;
    }
  }
  return null;
}
