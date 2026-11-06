import { createMemo, For, Show } from "solid-js";
import { TransitionGroup } from "solid-transition-group";
import styles from "./FilterGroupView.module.scss";
import { FilterGroup, FilterNode, FilterRelationOperations, SelectItem, TagValueTypeMap } from "../../../../types";
import useTagFilterState, { asRange, keyLabel, scopePaths, tagMapAtPath, tagPathKey } from "../../../../states/tagFilterState";
import Button from "../../../../components/Button/Button";
import Select from "../../../../components/Select/Select";
import Segmented from "../../../../components/Segmented/Segmented";
import FilterConditionView, { RuleJoiner } from "../FilterConditionView/FilterConditionView";
import { Layers, Plus, Trash2 } from "lucide-solid";

const NO_SCOPE = tagPathKey([]);
const RELATION_ITEMS = [
  { id: FilterRelationOperations.and, label: "All" },
  { id: FilterRelationOperations.or, label: "Any" },
];

function animateIn(element: Element, done: () => void) {
  element.animate(
    [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }],
    { duration: 280, easing: "cubic-bezier(.22,.8,.24,1)" },
  ).finished.then(done);
}

function animateOut(element: Element, done: () => void) {
  element.animate(
    [{ opacity: 1 }, { opacity: 0, transform: "translateY(-4px)" }],
    { duration: 160, easing: "cubic-bezier(.55,0,.75,.2)" },
  ).finished.then(done);
}

function GroupChildren(props: { group: FilterGroup, tagMap: TagValueTypeMap, pathPrefix: string[] }) {
  return (
    <div class={styles.Rows}>
      <TransitionGroup onEnter={animateIn} onExit={animateOut}>
        <For each={props.group.children}>
          {(child, index) => <ChildRow child={child} index={index()} parent={props.group} tagMap={props.tagMap} pathPrefix={props.pathPrefix} />}
        </For>
      </TransitionGroup>
    </div>
  );
}

function ChildRow(props: { child: FilterNode, index: number, parent: FilterGroup, tagMap: TagValueTypeMap, pathPrefix: string[] }) {
  const range = createMemo(() => asRange(props.child));
  const nested = createMemo(() => !range() && props.child.kind === "group" ? props.child as FilterGroup : null);

  return (
    <Show
      when={nested()}
      fallback={
        <FilterConditionView
          rule={range() ?? (props.child as Exclude<FilterNode, FilterGroup>)}
          index={props.index}
          parent={props.parent}
          tagMap={props.tagMap}
          pathPrefix={props.pathPrefix}
        />
      }
    >
      {group => (
        <div class={styles.NestedRow}>
          <RuleJoiner index={props.index} parent={props.parent} />
          <NestedGroup group={group()} tagMap={props.tagMap} pathPrefix={props.pathPrefix} />
        </div>
      )}
    </Show>
  );
}

function NestedGroup(props: { group: FilterGroup, tagMap: TagValueTypeMap, pathPrefix: string[] }) {
  const { setRelation, setGroupScope, addCondition, addGroup, removeNode } = useTagFilterState;

  const scopeItems = createMemo<SelectItem<string[]>[]>(() => [
    { id: NO_SCOPE, value: [], label: "Anywhere in the capture" },
    ...scopePaths(props.tagMap).map(path => ({
      id: tagPathKey(path),
      value: path,
      label: `The same ${path.map(keyLabel).join(" › ")} entry`,
    })),
  ]);
  const scopeKey = createMemo(() => tagPathKey(props.group.scope));
  const scoped = createMemo(() => props.group.scope.length > 0);
  const childTagMap = createMemo(() => tagMapAtPath(props.tagMap, props.group.scope));
  const childPrefix = createMemo(() => [...props.pathPrefix, ...props.group.scope]);

  return (
    <div class={styles.Group} classList={{ [styles.Nested]: true, [styles.Scoped]: scoped() }}>
      <div class={styles.Head}>
        <span class={styles.Label}>Match</span>
        <Segmented size="sm" items={RELATION_ITEMS} value={props.group.relation} onChange={relation => setRelation(props.group.id, relation)} />
        <Show when={scopeItems().length > 1}>
          <span class={styles.Label}>in</span>
          <Select variant="pill" value={scopeKey()} items={scopeItems()} onItemClick={item => setGroupScope(props.group.id, item.value)} />
        </Show>
        <span class={styles.Spacer} />
        <Button size="sm" variant="ghost" onClick={() => addCondition(props.group.id)}><Plus size={14} />Condition</Button>
        <Button size="sm" variant="ghost" onClick={() => addGroup(props.group.id)}><Layers size={14} />Group</Button>
        <Button isIcon size="sm" variant="danger" tooltip="Remove group" onClick={() => removeNode(props.group.id)}>
          <Trash2 size={14} />
        </Button>
      </div>
      <Show when={props.group.children.length > 0} fallback={<div class={styles.Empty}>Empty group. Add a condition to it.</div>}>
        <GroupChildren group={props.group} tagMap={childTagMap()} pathPrefix={childPrefix()} />
      </Show>
    </div>
  );
}

function FilterGroupView(props: { node: FilterGroup, tagMap: TagValueTypeMap }) {
  const { setRelation, addCondition, addGroup } = useTagFilterState;

  return (
    <div class={styles.Group}>
      <div class={styles.Head}>
        <span class={styles.Label}>Match</span>
        <Segmented size="sm" items={RELATION_ITEMS} value={props.node.relation} onChange={relation => setRelation(props.node.id, relation)} />
        <span class={styles.Spacer} />
        <Button size="sm" variant="ghost" onClick={() => addCondition(props.node.id)}><Plus size={14} />Condition</Button>
        <Button size="sm" variant="ghost" onClick={() => addGroup(props.node.id)}><Layers size={14} />Group</Button>
      </div>
      <Show when={props.node.children.length > 0} fallback={<div class={styles.Empty}>No conditions. Add one to filter by any tag.</div>}>
        <GroupChildren group={props.node} tagMap={props.tagMap} pathPrefix={[]} />
      </Show>
    </div>
  );
}

export default FilterGroupView;
