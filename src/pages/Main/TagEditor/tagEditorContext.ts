import { createContext, useContext } from "solid-js";
import { NameSuggestion, TagEntry, TagKind } from "./tagEntry";

export type EntryChange = "new" | "changed" | "";

export type TagEditorApi = {
  entries: TagEntry[],
  parents: () => Map<number, TagEntry | null>,
  // Only errors the user should see now: an empty name stays quiet until its field has been left once.
  errors: () => Map<number, string>,
  changeOf: (id: number) => EntryChange,
  suggestionsFor: (id: number) => NameSuggestion[],
  setKey: (id: number, key: string) => void,
  pickName: (id: number, suggestion: NameSuggestion) => void,
  setKind: (id: number, kind: TagKind) => void,
  setScalar: (id: number, value: string | number | boolean) => void,
  toggleExpanded: (id: number) => void,
  // null adds a top-level tag. Returns the new entry's id.
  addChild: (parentId: number | null) => number,
  remove: (id: number) => void,
  // null moves to the top level. Returns false when the move isn't allowed.
  move: (id: number, parentId: number | null) => boolean,
  touch: (id: number) => void,
};

export const TagEditorContext = createContext<TagEditorApi>();

export function useTagEditor(): TagEditorApi {
  const api = useContext(TagEditorContext);
  if (!api) throw new Error("useTagEditor needs a TagEditorContext provider");
  return api;
}

// Lets a view focus the name (or first value) of an entry it just added, once it's rendered.
export function focusEntry(id: number): void {
  requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(`[data-tag-name="${id}"]`)
      ?? document.querySelector<HTMLElement>(`[data-tag-value="${id}"] input, [data-tag-value="${id}"] button`);
    target?.focus({ preventScroll: true });
    if (target instanceof HTMLInputElement) target.select();
  });
}
