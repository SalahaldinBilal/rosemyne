import { DATE_TIME_TAG_KEY, SelectItem, TagValue, TIME_TAG_KEY } from "../../../types";

export type TagKind = "string" | "number" | "boolean" | "time" | "dateTime" | "object" | "array" | "null";

export type TagEntry = {
  id: number;
  key: string;
  kind: TagKind;
  scalar: string | number | boolean;
  children: TagEntry[];
  expanded: boolean;
};

let nextId = 1;

// "null" stays a valid TagKind (for round-tripping) but is omitted here , it's invisible to every filter.
export const KIND_ITEMS: SelectItem<TagKind>[] = [
  { id: "string", value: "string", label: "Text" },
  { id: "number", value: "number", label: "Number" },
  { id: "boolean", value: "boolean", label: "True/False" },
  { id: "time", value: "time", label: "Duration" },
  { id: "dateTime", value: "dateTime", label: "Date/Time" },
  { id: "object", value: "object", label: "Group" },
  { id: "array", value: "array", label: "List" },
];

export const BOOLEAN_ITEMS: SelectItem<boolean>[] = [
  { id: "true", value: true, label: "True" },
  { id: "false", value: false, label: "False" },
];

export function defaultScalarFor(kind: TagKind): string | number | boolean {
  if (kind === "number" || kind === "time") return 0;
  if (kind === "boolean") return false;
  if (kind === "dateTime") return Date.now();
  return "";
}

export function makeEntry(key: string, kind: TagKind = "string"): TagEntry {
  return { id: nextId++, key, kind, scalar: defaultScalarFor(kind), children: [], expanded: true };
}

// Mirrors markerScalar/marker_scalar , this single-key shape is how Duration/Date-Time tags are actually stored.
function markerKind(value: TagValue): { kind: "time" | "dateTime", ms: number } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;

  const inner = value[keys[0]];
  if (typeof inner !== "number") return null;
  if (keys[0] === TIME_TAG_KEY) return { kind: "time", ms: inner };
  if (keys[0] === DATE_TIME_TAG_KEY) return { kind: "dateTime", ms: inner };
  return null;
}

function kindOf(value: TagValue): TagKind {
  const marker = markerKind(value);
  if (marker) return marker.kind;
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
  } else if (entry.kind === "time" || entry.kind === "dateTime") {
    entry.scalar = markerKind(value)!.ms;
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
    // TagValue's array variants are individually homogeneous, but this editor doesn't enforce that.
    case "array": return entry.children.map(entryToTagValue) as TagValue;
    case "time": return { [TIME_TAG_KEY]: entry.scalar as number };
    case "dateTime": return { [DATE_TIME_TAG_KEY]: entry.scalar as number };
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

// Flags entries with an empty, duplicate, or "$"-prefixed key; arrays have no keys, so showKeys=false skips straight to children.
export function collectKeyErrors(entries: TagEntry[], showKeys: boolean, out: Map<number, string>): void {
  if (showKeys) {
    const seen = new Map<string, number>();
    for (const entry of entries) {
      const key = entry.key.trim();
      if (!key) out.set(entry.id, "Name required");
      else if (key.startsWith("$")) out.set(entry.id, 'Can\'t start with "$" (reserved)');
      else if (seen.has(key)) {
        out.set(entry.id, "Duplicate name");
        out.set(seen.get(key)!, "Duplicate name");
      } else {
        seen.set(key, entry.id);
      }
    }
  }

  for (const entry of entries) {
    if (entry.kind === "object") collectKeyErrors(entry.children, true, out);
    else if (entry.kind === "array") collectKeyErrors(entry.children, false, out);
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
