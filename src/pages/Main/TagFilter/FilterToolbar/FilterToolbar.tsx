import styles from "./FilterToolbar.module.scss";
import { createMemo, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { HistoryItemType, HistorySort, HistoryTypeCounts, SelectItem } from "../../../../types";
import useTagFilterState from "../../../../states/tagFilterState";
import Select from "../../../../components/Select/Select";
import { ChevronDown, ChevronUp, File, Image, ListFilter, LucideIcon, Video } from "lucide-solid";

const SORT_ITEMS: SelectItem<HistorySort>[] = [
  { id: "date-desc", value: { field: "date", direction: "desc" }, label: "Newest first" },
  { id: "date-asc", value: { field: "date", direction: "asc" }, label: "Oldest first" },
  { id: "name-asc", value: { field: "name", direction: "asc" }, label: "Name A–Z" },
  { id: "name-desc", value: { field: "name", direction: "desc" }, label: "Name Z–A" },
];

const COUNT_ITEMS: { type: HistoryItemType, icon: LucideIcon, label: string }[] = [
  { type: "image", icon: Image, label: "image" },
  { type: "video", icon: Video, label: "video" },
  { type: "file", icon: File, label: "file" },
];

function plural(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function FilterToolbar(props: { sort: HistorySort, onSortChange: (sort: HistorySort) => void, counts: HistoryTypeCounts }) {
  const { ruleCount, activeFilterName, filtersOpen, setFiltersOpen } = useTagFilterState;

  // The panel is closed by default, so an active filter has to read from the
  // collapsed row alone.
  const hint = createMemo(() => {
    const name = activeFilterName();
    if (ruleCount() === 0) return "Show filters";
    return name ? `Filters, ${name}` : "Filters";
  });

  const total = createMemo(() => props.counts.image + props.counts.video + props.counts.file);
  const presentCounts = createMemo(() => COUNT_ITEMS.filter(item => props.counts[item.type] > 0));

  return (
    <div class={styles.Toolbar}>
      <Select
        borderless
        value={`${props.sort.field}-${props.sort.direction}`}
        items={SORT_ITEMS}
        onItemClick={item => props.onSortChange(item.value)}
      />
      <div class={styles.Counts}>
        <Show when={total() > 0}>
          <span class={styles.Total} title={plural(total(), "item")}>{plural(total(), "item")}</span>
          <span class={styles.Separator} />
        </Show>
        <For each={presentCounts()}>
          {item => {
            const count = createMemo(() => props.counts[item.type]);
            return <span class={styles.Count} title={plural(count(), item.label)}>
              <Dynamic component={item.icon} size={14} />
              {count()}
            </span>;
          }}
        </For>
      </div>
      <button
        class={styles.Toggle}
        classList={{ [styles.Active]: ruleCount() > 0 }}
        title={hint()}
        onClick={() => setFiltersOpen(open => !open)}
      >
        <ListFilter size={16} />
        <Show when={ruleCount() > 0}>
          <span class={styles.Badge}>{ruleCount()}</span>
        </Show>
        {filtersOpen() ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
    </div>
  );
}

export default FilterToolbar;
