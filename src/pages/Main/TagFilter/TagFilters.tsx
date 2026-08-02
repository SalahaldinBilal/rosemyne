import styles from "./TagFilters.module.scss";
import ghost from "./controls/ghost.module.scss";
import { Show } from "solid-js";
import { TagValueTypeMap } from "../../../types";
import useTagFilterState from "../../../states/tagFilterState";
import FilterGroupView from "./FilterGroupView/FilterGroupView";
import Button from "../../../components/Button/Button";
import { ChevronDown, ChevronUp, FolderPlus, ListFilter, Plus } from "lucide-solid";

function TagFilters(props: { tagMap: TagValueTypeMap }) {
  const { root, addCondition, addGroup, ruleCount, collapsed, setCollapsed } = useTagFilterState;

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
