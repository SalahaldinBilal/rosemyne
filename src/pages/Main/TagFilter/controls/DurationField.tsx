import styles from "./DurationField.module.scss";
import { createMemo, createSignal } from "solid-js";
import { SelectItem } from "../../../../types";
import Select from "../../../../components/Select/Select";

type Unit = "ms" | "seconds" | "minutes" | "hours";

const UNIT_MS: Record<Unit, number> = {
  ms: 1,
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
};

const UNIT_ITEMS: SelectItem<Unit>[] = [
  { id: "ms", value: "ms", label: "milliseconds" },
  { id: "seconds", value: "seconds", label: "seconds" },
  { id: "minutes", value: "minutes", label: "minutes" },
  { id: "hours", value: "hours", label: "hours" },
];

// A number + unit picker, matching how duration thresholds read elsewhere
// ("older than 30 minutes"); switching the unit doesn't change the
// underlying value, only its display scale , picking `milliseconds` is the
// escape hatch for exact/sub-second precision.
function DurationField(props: { valueMs: number, onChange: (ms: number) => void }) {
  const [unit, setUnit] = createSignal<Unit>("seconds");
  const displayValue = createMemo(() => props.valueMs / UNIT_MS[unit()]);

  function updateNumber(raw: string) {
    const parsed = Number(raw);
    props.onChange(Number.isFinite(parsed) ? Math.max(0, parsed) * UNIT_MS[unit()] : 0);
  }

  return (
    <div class={styles.Duration}>
      <input
        class={styles.Input}
        type="number"
        min={0}
        value={displayValue()}
        onInput={e => updateNumber(e.currentTarget.value)}
      />
      <Select value={unit()} items={UNIT_ITEMS} onItemClick={item => setUnit(item.value)} />
    </div>
  );
}

export default DurationField;
