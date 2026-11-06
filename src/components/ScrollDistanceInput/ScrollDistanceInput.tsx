import { createMemo } from "solid-js";
import NumberField from "../NumberField/NumberField";
import { ScrollDistance, SelectItem } from "../../types";

const UNIT_ITEMS: SelectItem<string>[] = [
  { id: "percent", value: "percent", label: "%" },
  { id: "pixels", value: "pixels", label: "px" },
];

const MAX_PERCENT = 100;
const MAX_PIXELS = 100_000;

function toDistance(type: ScrollDistance["type"], data: number): ScrollDistance {
  return type === "percent" ? { type: "percent", data: Math.min(MAX_PERCENT, data) } : { type: "pixels", data };
}

// Shared by the Settings page and the live-select overlay's per-instance panel.
function ScrollDistanceInput(props: { value: ScrollDistance, onChange: (value: ScrollDistance) => void, size?: "md" | "sm", width?: number | string }) {
  const type = createMemo(() => props.value.type);

  return (
    <NumberField
      value={props.value.data}
      min={1}
      max={type() === "percent" ? MAX_PERCENT : MAX_PIXELS}
      size={props.size}
      width={props.width ?? 110}
      unit={type()}
      units={UNIT_ITEMS}
      tooltip={type() === "percent" ? "Percent of the selected region's height" : undefined}
      onUnitChange={unit => props.onChange(toDistance(unit as ScrollDistance["type"], props.value.data))}
      onChange={data => props.onChange(toDistance(type(), data))}
    />
  );
}

export default ScrollDistanceInput;
