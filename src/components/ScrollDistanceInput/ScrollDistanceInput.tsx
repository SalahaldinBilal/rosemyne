import { createMemo, JSX } from "solid-js";
import Input from "../Input/Input";
import Select from "../Select/Select";
import { ScrollDistance, SelectItem } from "../../types";

const DISTANCE_TYPE_ITEMS: SelectItem<ScrollDistance["type"]>[] = [
  { id: "percent", value: "percent", label: "% of region" },
  { id: "pixels", value: "pixels", label: "px" },
];

// Shared by the Settings page and the live-select overlay's per-instance panel.
function ScrollDistanceInput(props: { value: ScrollDistance, onChange: (value: ScrollDistance) => void, style?: JSX.CSSProperties }) {
  const type = createMemo(() => props.value.type);

  return (
    <div style={{ display: "flex", gap: "6px", ...(props.style ?? {}) }}>
      <Input
        type="number"
        min={1}
        max={type() === "percent" ? 100 : undefined}
        value={props.value.data}
        onChange={e => {
          const data = Math.max(1, e.currentTarget.valueAsNumber || 1);
          props.onChange(type() === "percent" ? { type: "percent", data } : { type: "pixels", data });
        }}
        style={{ width: "80px" }}
      />
      <Select
        value={type()}
        items={DISTANCE_TYPE_ITEMS}
        onItemClick={item => props.onChange(
          item.value === "percent" ? { type: "percent", data: props.value.data } : { type: "pixels", data: props.value.data }
        )}
      />
    </div>
  );
}

export default ScrollDistanceInput;
