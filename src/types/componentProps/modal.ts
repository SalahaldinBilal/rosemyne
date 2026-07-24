import { JSX } from "solid-js";

export type ModalProps = {
  show: boolean;
  onHide?: () => any;
  children: JSX.Element;
  title?: JSX.Element;
  // Rendered in the header row, between the title and the close button, for
  // actions that would otherwise need a footer bar of their own.
  headerActions?: JSX.Element;
  width?: number | string;
  height?: number | string;
}