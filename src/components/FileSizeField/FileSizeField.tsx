import { createMemo, createSignal } from "solid-js";
import { SelectItem } from "../../types";
import NumberField from "../NumberField/NumberField";

type Unit = "KB" | "MB" | "GB";

const UNIT_BYTES: Record<Unit, number> = {
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
};

const UNIT_ITEMS: SelectItem<string>[] = (Object.keys(UNIT_BYTES) as Unit[]).map(unit => ({ id: unit, value: unit, label: unit }));

function largestFittingUnit(bytes: number): Unit {
  if (bytes >= UNIT_BYTES.GB) return "GB";
  if (bytes >= UNIT_BYTES.MB) return "MB";
  return "KB";
}

// Switching the unit keeps the byte count and rescales the number shown.
function FileSizeField(props: { valueBytes: number, onChange: (bytes: number) => void, width?: number | string, size?: "md" | "sm" }) {
  const [unit, setUnit] = createSignal<Unit>(largestFittingUnit(props.valueBytes));
  const displayValue = createMemo(() => props.valueBytes / UNIT_BYTES[unit()]);

  return (
    <NumberField
      value={displayValue()}
      decimals={2}
      width={props.width ?? 140}
      size={props.size}
      unit={unit()}
      units={UNIT_ITEMS}
      onUnitChange={next => setUnit(next as Unit)}
      onChange={value => props.onChange(Math.round(value * UNIT_BYTES[unit()]))}
    />
  );
}

export default FileSizeField;
