import styles from "./FilterToolbar.module.scss";
import { createMemo, For, Show } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { DatePreset, HistoryItemType, HistorySort, HistoryTypeCounts, SelectItem } from "../../../../types";
import useTagFilterState from "../../../../states/tagFilterState";
import Select from "../../../../components/Select/Select";
import Tooltip from "../../../../components/Tooltip/Tooltip";
import { Search, SlidersHorizontal, X } from "lucide-solid";

const SORT_ITEMS: SelectItem<HistorySort>[] = [
  { id: "date-desc", value: { field: "date", direction: "desc" }, label: "Newest first" },
  { id: "date-asc", value: { field: "date", direction: "asc" }, label: "Oldest first" },
  { id: "name-asc", value: { field: "name", direction: "asc" }, label: "Name A–Z" },
  { id: "name-desc", value: { field: "name", direction: "desc" }, label: "Name Z–A" },
];

export const DATE_PRESET_ITEMS: SelectItem<DatePreset>[] = [
  { id: "any", value: "any", label: "Any time" },
  { id: "today", value: "today", label: "Today" },
  { id: "week", value: "week", label: "Last 7 days" },
  { id: "month", value: "month", label: "Last 30 days" },
  { id: "year", value: "year", label: "This year" },
];

export const TYPE_ITEMS: { type: HistoryItemType, label: string }[] = [
  { type: "image", label: "Images" },
  { type: "video", label: "Videos" },
  { type: "file", label: "Files" },
];

const SEARCH_KEYS = ["Ctrl", "F"];

function FilterToolbar(props: { sort: HistorySort, onSortChange: (sort: HistorySort) => void, counts: HistoryTypeCounts }) {
  const { quick, setSearch, toggleType, setDatePreset, activeRuleCount, filtersOpen, setFiltersOpen } = useTagFilterState;
  const sortValue = createMemo(() => `${props.sort.field}-${props.sort.direction}`);
  let searchBox: HTMLLabelElement | undefined;
  let searchInput: HTMLInputElement | undefined;

  makeEventListener(window, "keydown", event => {
    if (!(event.ctrlKey || event.metaKey) || event.code !== "KeyF") return;
    event.preventDefault();
    searchInput?.focus();
    searchInput?.select();
  });

  function clearSearch() {
    setSearch("");
    searchInput?.focus();
  }

  return (
    <div class={styles.Toolbar}>
      <label ref={searchBox} class={styles.Search}>
        <Search size={15} />
        <input
          ref={searchInput}
          placeholder="Search"
          value={quick.search}
          spellcheck={false}
          onInput={event => setSearch(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === "Escape" && quick.search) {
              event.stopPropagation();
              setSearch("");
            }
          }}
        />
        <Show when={quick.search}>
          <button type="button" class={styles.ClearSearch} aria-label="Clear search" onClick={event => { event.preventDefault(); clearSearch(); }}>
            <X size={13} />
          </button>
        </Show>
      </label>
      <Tooltip anchor={() => searchBox} text="Search file names, window titles and apps" keys={SEARCH_KEYS} />

      <div class={styles.Types} role="group" aria-label="File types">
        <For each={TYPE_ITEMS}>
          {item => {
            const on = createMemo(() => quick.types.includes(item.type));
            return (
              <button
                type="button"
                class={styles.Type}
                classList={{ [styles.On]: on() }}
                aria-pressed={on()}
                onMouseDown={event => event.preventDefault()}
                onClick={() => toggleType(item.type)}
              >
                {item.label}
                <span class={styles.Count}>{props.counts[item.type]}</span>
              </button>
            );
          }}
        </For>
      </div>

      <div class={styles.End}>
        <Select variant="bare" value={quick.date} items={DATE_PRESET_ITEMS} onItemClick={item => setDatePreset(item.value)} />
        <Select variant="bare" value={sortValue()} items={SORT_ITEMS} onItemClick={item => props.onSortChange(item.value)} />
        <span class={styles.Divider} />
        <button
          type="button"
          class={styles.Advanced}
          classList={{ [styles.Active]: activeRuleCount() > 0, [styles.Open]: filtersOpen() }}
          aria-expanded={filtersOpen()}
          onClick={() => setFiltersOpen(open => !open)}
        >
          <SlidersHorizontal size={15} />
          Advanced
          <Show when={activeRuleCount() > 0}>
            <span class={styles.Badge}>{activeRuleCount()}</span>
          </Show>
        </button>
      </div>
    </div>
  );
}

export default FilterToolbar;
