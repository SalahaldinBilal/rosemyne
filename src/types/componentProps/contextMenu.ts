import { LucideIcon, LucideProps } from "lucide-solid"
import { JSX } from "solid-js"
import { Position } from ".."

export type ContextMenuItemProps = {
  children: JSX.Element,
  icon?: { icon: LucideIcon, props?: LucideProps },
  onClick?: (event: MouseEvent) => void,
  disabled?: boolean,
  shouldCloseOnClick?: boolean,
  danger?: boolean
}

export type AbbyContextMenuProps = {
  id: string | number,
  children: JSX.Element
}

export type ShowContextMenuParams = {
  id: string | number;
  event: MouseEvent;
  props?: any;
  position?: Position;
};