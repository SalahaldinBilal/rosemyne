import { JSX } from "solid-js"

export type SelectItem<T> = {
  id: string | number,
  value: T,
  label: string
}

export type SelectProps<T> = {
  value: SelectItem<T>["id"],
  items: readonly SelectItem<T>[],
  onItemClick: (item: SelectItem<T>) => any,
  placeholder?: string,
  accent?: boolean,
  noRadius?: boolean,
  borderless?: boolean,
  color?: string,
  style?: JSX.CSSProperties
}
