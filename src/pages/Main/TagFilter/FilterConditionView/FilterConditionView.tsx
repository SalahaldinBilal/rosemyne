import { createEffect, createMemo, Index, JSX, Match, on, onMount, Show, Switch } from "solid-js";
import styles from "./FilterConditionView.module.scss";
import { FilterCondition, FilterGroup, FilterOperations, FilterRelationOperations, FilterScalar, TagValueTypeMap } from "../../../../types";
import useTagFilterState, { endOfDay, RangeShape, startOfDay } from "../../../../states/tagFilterState";
import Button from "../../../../components/Button/Button";
import Select from "../../../../components/Select/Select";
import Segmented from "../../../../components/Segmented/Segmented";
import NumberField from "../../../../components/NumberField/NumberField";
import DateField from "../../../../components/DateField/DateField";
import DurationField from "../../../../components/DurationField/DurationField";
import FileSizeField from "../../../../components/FileSizeField/FileSizeField";
import FilterValueField from "../controls/FilterValueField";
import TagPicker from "../TagPicker/TagPicker";
import { operationId, operationItems, ruleOperation } from "../filterOperations";
import { CaseSensitive, Plus, Trash2, X } from "lucide-solid";

const FOCUS_DELAY_MS = 220;

export function RuleJoiner(props: { index: number, parent: FilterGroup }) {
  const { toggleRelation } = useTagFilterState;
  const word = createMemo(() => props.parent.relation === FilterRelationOperations.and ? "and" : "or");

  return (
    <Show when={props.index > 0} fallback={<span class={styles.JoinerFirst}>Where</span>}>
      <button type="button" class={styles.Joiner} title="Switch between all and any" onClick={() => toggleRelation(props.parent.id)}>
        {word()}
      </button>
    </Show>
  );
}

function FilterConditionView(props: {
  rule: FilterCondition | RangeShape,
  index: number,
  parent: FilterGroup,
  tagMap: TagValueTypeMap,
  pathPrefix?: string[],
}) {
  const {
    setConditionPath, setUiOperation, setOperation, setCaseSensitive, addValue, setValue, removeValue, removeNode, setRangeDay,
    pendingPickerId, setPendingPickerId, focusRequest, setFocusRequest,
  } = useTagFilterState;
  let valuesCell: HTMLDivElement | undefined;

  const range = createMemo(() => "group" in props.rule ? props.rule : null);
  const condition = createMemo(() => range()?.low ?? (props.rule as FilterCondition));
  const nodeId = createMemo(() => range()?.group.id ?? condition().id);
  const valueType = createMemo(() => condition().valueType);
  const hasPath = createMemo(() => condition().path.length > 0);
  const operation = createMemo(() => ruleOperation(props.rule));
  const items = createMemo(() => operationItems(valueType(), operation()));
  const suggestPath = createMemo(() => [...(props.pathPrefix ?? []), ...condition().path]);
  const isPercent = createMemo(() => /percent/i.test(condition().path[condition().path.length - 1] ?? ""));
  const isOperationPlain = createMemo(() => operation().kind === "plain");
  const booleanValue = createMemo(() => {
    const value = condition().values[0] === true;
    return condition().operation === FilterOperations.notEquals ? !value : value;
  });

  function focusValue() {
    setTimeout(() => valuesCell?.querySelector<HTMLInputElement>("input")?.focus(), FOCUS_DELAY_MS);
  }

  onMount(() => {
    if (focusRequest() === nodeId()) {
      setFocusRequest(null);
      focusValue();
    }
  });

  createEffect(on(focusRequest, id => {
    if (id === null || id !== nodeId()) return;
    setFocusRequest(null);
    focusValue();
  }, { defer: true }));

  function pickPath(path: string[]) {
    setFocusRequest(setConditionPath(nodeId(), path, props.tagMap));
  }

  function setDate(id: number, ms: number, edge: "start" | "end" | "raw") {
    setValue(id, 0, edge === "start" ? startOfDay(ms) : edge === "end" ? endOfDay(ms) : ms);
  }

  function plainDateEdge(): "start" | "end" | "raw" {
    const current = condition().operation;
    if (current === FilterOperations.greaterThan) return "end";
    if (current === FilterOperations.lessThan) return "start";
    return "raw";
  }

  function scalarControl(target: FilterCondition, index: number, value: FilterScalar, dateEdge: "start" | "end" | "raw"): JSX.Element {
    return (
      <Switch fallback={
        <FilterValueField value={String(value ?? "")} path={suggestPath()} onChange={raw => setValue(target.id, index, raw)} />
      }>
        <Match when={valueType() === "number"}>
          <NumberField
            size="sm"
            width="100%"
            min={-Number.MAX_VALUE}
            max={isPercent() ? 100 : Number.MAX_VALUE}
            decimals={4}
            unit={isPercent() ? "%" : undefined}
            value={typeof value === "number" ? value : null}
            onChange={number => setValue(target.id, index, number)}
          />
        </Match>
        <Match when={valueType() === "dateTime"}>
          <DateField size="sm" value={typeof value === "number" ? value : null} onChange={ms => setDate(target.id, ms, dateEdge)} />
        </Match>
        <Match when={valueType() === "byteSize"}>
          <FileSizeField size="sm" width="100%" valueBytes={typeof value === "number" ? value : 0} onChange={bytes => setValue(target.id, index, bytes)} />
        </Match>
        <Match when={valueType() === "time"}>
          <DurationField size="sm" valueMs={typeof value === "number" ? value : 0} onChange={ms => setValue(target.id, index, ms)} />
        </Match>
      </Switch>
    );
  }

  return (
    <div class={styles.Row}>
      <RuleJoiner index={props.index} parent={props.parent} />

      <TagPicker
        tagMap={props.tagMap}
        path={condition().path}
        onPick={pickPath}
        autoOpen={pendingPickerId() === nodeId()}
        onAutoOpened={() => setPendingPickerId(null)}
      />

      <Show when={hasPath()} fallback={<span />}>
        <Show when={valueType() !== "boolean"} fallback={<span class={styles.FixedOperation}>is</span>}>
          <Select
            variant="pill"
            accent
            class={styles.Operation}
            value={operationId(operation())}
            items={items()}
            onItemClick={item => setUiOperation(nodeId(), item.value)}
          />
        </Show>
      </Show>

      <div class={styles.Values} ref={valuesCell}>
        <Show when={hasPath()}>
          <Switch>
            <Match when={valueType() === "boolean"}>
              <Segmented
                size="sm"
                items={[{ id: "yes", label: "Yes" }, { id: "no", label: "No" }]}
                value={booleanValue() ? "yes" : "no"}
                onChange={choice => {
                  setOperation(condition().id, FilterOperations.equals);
                  setValue(condition().id, 0, choice === "yes");
                }}
              />
            </Match>
            <Match when={range()?.kind === "on"}>
              <DateField
                size="sm"
                value={range()!.low.values[0] as number}
                onChange={ms => setRangeDay(range()!.group.id, ms)}
              />
            </Match>
            <Match when={range()}>
              {current => <>
                {scalarControl(current().low, 0, current().low.values[0], "start")}
                <span class={styles.ValueJoin}>and</span>
                {scalarControl(current().high, 0, current().high.values[0], "end")}
              </>}
            </Match>
            <Match when={isOperationPlain()}>
              <Index each={condition().values}>{(value, index) => <>
                <Show when={index > 0}><span class={styles.ValueJoin}>or</span></Show>
                {scalarControl(condition(), index, value(), plainDateEdge())}
                <Show when={condition().values.length > 1}>
                  <Button isIcon size="xs" tooltip="Remove value" onClick={() => removeValue(condition().id, index)}>
                    <X size={13} />
                  </Button>
                </Show>
              </>}</Index>
              <Show when={valueType() === "string"}>
                <Button
                  isIcon
                  size="sm"
                  active={condition().caseSensitive}
                  tooltip={condition().caseSensitive ? "Matching case" : "Ignoring case"}
                  onClick={() => setCaseSensitive(condition().id, !condition().caseSensitive)}
                >
                  <CaseSensitive size={15} />
                </Button>
              </Show>
              <Show when={valueType() === "string" || valueType() === "number"}>
                <Button isIcon size="sm" tooltip="Add another value (any of them matches)" onClick={() => addValue(condition().id)}>
                  <Plus size={14} />
                </Button>
              </Show>
            </Match>
          </Switch>
        </Show>
      </div>

      <Button isIcon size="sm" variant="danger" tooltip="Remove" onClick={() => removeNode(nodeId())}>
        <Trash2 size={14} />
      </Button>
    </div>
  );
}

export default FilterConditionView;
