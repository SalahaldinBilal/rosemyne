import styles from "./DurationField.module.scss";
import { createMemo, createSignal } from "solid-js";
import { SelectItem } from "../../../../types";
import Select from "../../../../components/Select/Select";

type Unit = "bytes" | "kb" | "mb" | "gb";

const UNIT_BYTES: Record<Unit, number> = {
  bytes: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
};

const UNIT_ITEMS: SelectItem<Unit>[] = [
  { id: "bytes", value: "bytes", label: "bytes" },
  { id: "kb", value: "kb", label: "KB" },
  { id: "mb", value: "mb", label: "MB" },
  { id: "gb", value: "gb", label: "GB" },
];

// A number + unit picker, the byte-size counterpart to DurationField (reuses
// its layout styles): switching the unit only changes the display scale, not
// the underlying byte count , picking `bytes` is the escape hatch for exact
// values.
function FileSizeField(props: { valueBytes: number, onChange: (bytes: number) => void }) {
  const [unit, setUnit] = createSignal<Unit>("mb");
  const displayValue = createMemo(() => props.valueBytes / UNIT_BYTES[unit()]);

  function updateNumber(raw: string) {
    const parsed = Number(raw);
    props.onChange(Number.isFinite(parsed) ? Math.max(0, parsed) * UNIT_BYTES[unit()] : 0);
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

export default FileSizeField;
