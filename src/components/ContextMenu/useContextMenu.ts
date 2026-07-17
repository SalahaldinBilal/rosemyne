import { generateRandomId } from "../../helpers";
import { ShowContextMenuParams } from "../../types";
import { contextMenuEventHandler } from "./eventHandler";

export type UseContextMenuProps = Partial<
  Pick<ShowContextMenuParams, "id" | "props">
>;

export const useContextMenu = (props?: UseContextMenuProps) => {
  const givenId = props?.id || generateRandomId();

  return {
    id: givenId,
    show: (
      event: MouseEvent,
      params?: Partial<Omit<ShowContextMenuParams, "event">>
    ) => {
      contextMenuEventHandler.emit("hideAll")
      contextMenuEventHandler.emit("show", {
        id: (params?.id ?? givenId) as string,
        props: params?.props ?? props?.props,
        event: event,
        position: params?.position,
      });
    },
    hide: (id: string | number) => {
      contextMenuEventHandler.emit("hide", id ?? givenId)
    },
    hideAll: () => {
      contextMenuEventHandler.emit("hideAll");
    },
  };
};