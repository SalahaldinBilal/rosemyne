import { createMemo, For, Show } from "solid-js";
import styles from "./FilterGroupView.module.scss";
import ghost from "../controls/ghost.module.scss";
import { FilterGroup, FilterRelationOperations, SelectItem, TagValueTypeMap } from "../../../../types";
import useTagFilterState, { keyLabel, scopePaths, tagMapAtPath, tagPathKey } from "../../../../states/tagFilterState";
import Button from "../../../../components/Button/Button";
import Select from "../../../../components/Select/Select";
import FilterConditionView from "../FilterConditionView/FilterConditionView";
import { FolderPlus, Plus, Trash2 } from "lucide-solid";

const ICON_STYLE = { height: "34px", "min-width": "34px" } as const;
const NO_SCOPE = tagPathKey([]);

function FilterGroupView(props: { node: FilterGroup, tagMap: TagValueTypeMap, pathPrefix?: string[], isRoot?: boolean }) {
  const { setRelation, setGroupScope, addCondition, addGroup, removeNode } = useTagFilterState;
  const isAnd = createMemo(() => props.node.relation === FilterRelationOperations.and);
  // The relation only distinguishes anything with two or more children.
  const showSegment = createMemo(() => props.node.children.length > 1);

  const scopeItems = createMemo<SelectItem<string[]>[]>(() => [
    { id: NO_SCOPE, value: [], label: "Anywhere in the capture" },
    ...scopePaths(props.tagMap).map(path => ({
      id: tagPathKey(path),
      value: path,
      label: `Same ${path.map(keyLabel).join(" › ")} entry`,
    })),
  ]);

  const scopeKey = createMemo(() => tagPathKey(props.node.scope));
  const childTagMap = createMemo(() => tagMapAtPath(props.tagMap, props.node.scope));
  const childPrefix = createMemo(() => [...(props.pathPrefix ?? []), ...props.node.scope]);

  return (
    <div class={styles.Group} classList={{ [styles.Nested]: !props.isRoot }}>
      <Show when={!props.isRoot || showSegment()}>
        <div class={styles.Head}>
          <Show when={showSegment()}>
            <div class={styles.Segment}>
              <button classList={{ [styles.Active]: isAnd() }} onClick={() => setRelation(props.node.id, FilterRelationOperations.and)}>All · AND</button>
              <button classList={{ [styles.Active]: !isAnd() }} onClick={() => setRelation(props.node.id, FilterRelationOperations.or)}>Any · OR</button>
            </div>
          </Show>
          <Show when={!props.isRoot && scopeItems().length > 1}>
            <div class={styles.Scope}>
              <span class={styles.ScopeLabel}>Match in</span>
              <Select
                borderless
                value={scopeKey()}
                items={scopeItems()}
                onItemClick={item => setGroupScope(props.node.id, item.value)}
              />
            </div>
          </Show>
          <Show when={!props.isRoot}>
            <div class={styles.Actions}>
              <button class={ghost.Ghost} onClick={() => addCondition(props.node.id)}>
                <Plus size={15} /> Condition
              </button>
              <button class={ghost.Ghost} onClick={() => addGroup(props.node.id)}>
                <FolderPlus size={15} /> Group
              </button>
              <Button isIcon tooltip="Remove group" color="var(--danger-color)" style={ICON_STYLE} onClick={() => removeNode(props.node.id)}>
                <Trash2 size={15} />
              </Button>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={props.node.children.length > 0}>
        <div class={styles.Children}>
          <For each={props.node.children}>{child =>
            child.kind === "group"
              ? <FilterGroupView node={child} tagMap={childTagMap()} pathPrefix={childPrefix()} />
              : <FilterConditionView node={child} tagMap={childTagMap()} pathPrefix={childPrefix()} />
          }</For>
        </div>
      </Show>
    </div>
  );
}

export default FilterGroupView;
