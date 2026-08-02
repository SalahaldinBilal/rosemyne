import styles from "./FilterToolbar.module.scss";
import { createMemo, Show } from "solid-js";
import { HistorySort, SelectItem } from "../../../../types";
import useTagFilterState from "../../../../states/tagFilterState";
import Select from "../../../../components/Select/Select";
import { ChevronDown, ChevronUp, ListFilter } from "lucide-solid";

const SORT_ITEMS: SelectItem<HistorySort>[] = [
  { id: "date-desc", value: { field: "date", direction: "desc" }, label: "Newest first" },
  { id: "date-asc", value: { field: "date", direction: "asc" }, label: "Oldest first" },
  { id: "name-asc", value: { field: "name", direction: "asc" }, label: "Name A–Z" },
  { id: "name-desc", value: { field: "name", direction: "desc" }, label: "Name Z–A" },
];

function FilterToolbar(props: { sort: HistorySort, onSortChange: (sort: HistorySort) => void }) {
  const { ruleCount, activeFilterName, filtersOpen, setFiltersOpen } = useTagFilterState;

  // The panel is closed by default, so an active filter has to read from the
  // collapsed row alone.
  const hint = createMemo(() => {
    const name = activeFilterName();
    if (ruleCount() === 0) return "Show filters";
    return name ? `Filters, ${name}` : "Filters";
  });

  return (
    <div class={styles.Toolbar}>
      <Select
        borderless
        value={`${props.sort.field}-${props.sort.direction}`}
        items={SORT_ITEMS}
        onItemClick={item => props.onSortChange(item.value)}
      />
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
