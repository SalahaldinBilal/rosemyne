import { JSX } from "solid-js";

export type ModalProps = {
  show: boolean;
  onHide?: () => any;
  children: JSX.Element;
  title?: JSX.Element;
  headerActions?: JSX.Element;
  footer?: JSX.Element;
  width?: number | string;
  height?: number | string;
}
