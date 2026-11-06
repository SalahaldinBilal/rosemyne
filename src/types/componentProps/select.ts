import { JSX } from "solid-js"

export type SelectItem<T> = {
  id: string | number,
  value: T,
  label: string
}

export type SelectVariant = "default" | "bare" | "pill" | "unit";

export type SelectProps<T> = {
  value: SelectItem<T>["id"],
  items: readonly SelectItem<T>[],
  onItemClick: (item: SelectItem<T>) => any,
  placeholder?: string,
  variant?: SelectVariant,
  accent?: boolean,
  labelColor?: string,
  class?: string,
  style?: JSX.CSSProperties
}
