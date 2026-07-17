import mitt from "mitt";
import { ShowContextMenuParams } from "../../types";

type Events = {
  show: ShowContextMenuParams;
  hide: string | number;
  hideAll: void;
};

export const contextMenuEventHandler = mitt<Events>();