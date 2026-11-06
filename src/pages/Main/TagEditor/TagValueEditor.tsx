import styles from "./TagValueEditor.module.scss";
import { createMemo, Match, Switch } from "solid-js";
import Input from "../../../components/Input/Input";
import NumberField from "../../../components/NumberField/NumberField";
import DurationField from "../../../components/DurationField/DurationField";
import DateField from "../../../components/DateField/DateField";
import Segmented from "../../../components/Segmented/Segmented";
import { ChevronRight } from "lucide-solid";
import { TagEntry } from "./tagEntry";
import { useTagEditor } from "./tagEditorContext";

// Past this, the value overflows to Infinity, which JSON serializes as null, silently turning the tag empty.
const NUMBER_MIN = -Number.MAX_VALUE;
const NUMBER_MAX = Number.MAX_VALUE;

const YES_NO = [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] as const;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// The value side of a tag, shared by the node and table views. Groups and lists show a count that opens or closes them.
function TagValueEditor(props: { entry: TagEntry, onSummaryClick?: () => void, summaryHint?: string }) {
  const editor = useTagEditor();
  const summary = createMemo(() => props.entry.kind === "array"
    ? plural(props.entry.children.length, "item")
    : plural(props.entry.children.length, "tag"));

  return (
    <div class={styles.Value} data-tag-value={props.entry.id}>
      <Switch>
        <Match when={props.entry.kind === "object" || props.entry.kind === "array"}>
          <button
            type="button"
            class={styles.Summary}
            classList={{ [styles.Open]: props.entry.expanded }}
            onClick={() => props.onSummaryClick ? props.onSummaryClick() : editor.toggleExpanded(props.entry.id)}
          >
            <ChevronRight size={14} class={styles.SummaryChevron} />
            {summary()}
            <span class={styles.SummaryHint}>{props.summaryHint ?? (props.entry.expanded ? "Hide" : "Show")}</span>
          </button>
        </Match>
        <Match when={props.entry.kind === "string"}>
          <Input value={props.entry.scalar as string} placeholder="Empty" onChange={event => editor.setScalar(props.entry.id, event.currentTarget.value)} />
        </Match>
        <Match when={props.entry.kind === "number"}>
          <NumberField min={NUMBER_MIN} max={NUMBER_MAX} decimals={10} value={props.entry.scalar as number} onChange={value => editor.setScalar(props.entry.id, value)} />
        </Match>
        <Match when={props.entry.kind === "boolean"}>
          <Segmented
            items={YES_NO}
            stretch
            value={props.entry.scalar ? "yes" : "no"}
            onChange={value => editor.setScalar(props.entry.id, value === "yes")}
          />
        </Match>
        <Match when={props.entry.kind === "time"}>
          <DurationField parts={["h", "m", "s", "ms"]} valueMs={props.entry.scalar as number} onChange={ms => editor.setScalar(props.entry.id, ms)} />
        </Match>
        <Match when={props.entry.kind === "dateTime"}>
          <DateField withTime value={props.entry.scalar as number} onChange={ms => editor.setScalar(props.entry.id, ms)} />
        </Match>
        <Match when={props.entry.kind === "null"}>
          <span class={styles.Empty}>Empty</span>
        </Match>
      </Switch>
    </div>
  );
}

export default TagValueEditor;
