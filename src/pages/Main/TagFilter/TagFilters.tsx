import styles from "./TagFilters.module.scss";
import ghost from "./controls/ghost.module.scss";
import { Show, createEffect, createMemo, createSignal, on } from "solid-js";
import { FilterGroup, HistorySort, SelectItem, TagValueTypeMap } from "../../../types";
import useTagFilterState from "../../../states/tagFilterState";
import FilterGroupView from "./FilterGroupView/FilterGroupView";
import Button from "../../../components/Button/Button";
import Select from "../../../components/Select/Select";
import { ChevronDown, ChevronUp, FolderPlus, ListFilter, Plus } from "lucide-solid";

const SORT_ITEMS: SelectItem<HistorySort>[] = [
  { id: "date-desc", value: { field: "date", direction: "desc" }, label: "Newest first" },
  { id: "date-asc", value: { field: "date", direction: "asc" }, label: "Oldest first" },
  { id: "name-asc", value: { field: "name", direction: "asc" }, label: "Name A–Z" },
  { id: "name-desc", value: { field: "name", direction: "desc" }, label: "Name Z–A" },
];

function TagFilters(props: { tagMap: TagValueTypeMap, sort: HistorySort, onSortChange: (sort: HistorySort) => void }) {
  const { root, addCondition, addGroup } = useTagFilterState;
  const [collapsed, setCollapsed] = createSignal(false);

  const ruleCount = createMemo(() => {
    const walk = (group: FilterGroup): number =>
      group.children.reduce((sum, child) => sum + (child.kind === "group" ? walk(child) : 1), 0);
    return walk(root);
  });

  // With nothing to collapse the toggle disappears; never stay stuck collapsed.
  createEffect(on(ruleCount, count => {
    if (count === 0) setCollapsed(false);
  }));

  return (
    <div class={styles.TagFilters}>
      <div class={styles.Header}>
        <div class={styles.Title}>
          <ListFilter size={15} /> Filters
        </div>
        <Show when={collapsed() && ruleCount() > 0}>
          <span class={styles.Badge}>{ruleCount()} {ruleCount() === 1 ? "rule" : "rules"}</span>
        </Show>
        <div class={styles.Actions}>
          <Select
            value={`${props.sort.field}-${props.sort.direction}`}
            items={SORT_ITEMS}
            onItemClick={item => props.onSortChange(item.value)}
          />
          <Show when={!collapsed()}>
            <button class={ghost.Ghost} onClick={() => addCondition(root.id)}>
              <Plus size={15} /> Condition
            </button>
            <button class={ghost.Ghost} onClick={() => addGroup(root.id)}>
              <FolderPlus size={15} /> Group
            </button>
          </Show>
          <Show when={ruleCount() > 0}>
            <Button
              isIcon
              color="var(--base-font-color)"
              tooltip={collapsed() ? "Expand filters" : "Collapse filters"}
              onClick={() => setCollapsed(current => !current)}
            >
              {collapsed() ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={!collapsed() && root.children.length > 0}>
        <FilterGroupView node={root} tagMap={props.tagMap} isRoot />
      </Show>
    </div>
  );
}

export default TagFilters;
