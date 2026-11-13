import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import Button from "@core/components/Button/Button";
import Modal from "@core/components/Modal/Modal";
import { PluginModal } from "@core/types/plugins";
import PluginView from "./PluginView";
import { createPluginSession } from "./pluginSession";

export type PluginModalRequest = {
  plugin: { id: string, name: string },
  actionId: string,
  modal: PluginModal,
}

function PluginModalBody(props: { request: PluginModalRequest, show: boolean, onHide: () => void }) {
  const session = createPluginSession(props.request.plugin, `modal:${props.request.actionId}`);
  session.show(props.request.modal.tree);
  onCleanup(session.dispose);

  const actions = createMemo(() => props.request.modal.actions ?? []);

  createEffect(() => {
    if (session.closed()) props.onHide();
  });

  return (
    <Modal
      show={props.show}
      onHide={props.onHide}
      title={props.request.modal.title}
      width={480}
      footer={<>
        <Button onClick={props.onHide}>Cancel</Button>
        <For each={actions()}>
          {action => (
            <Button
              variant={action.variant ?? "secondary"}
              disabled={session.busy()}
              onClick={() => session.send({ id: action.id, type: "click" })}
            >
              {action.label}
            </Button>
          )}
        </For>
      </>}
    >
      <PluginView pluginId={props.request.plugin.id} nodes={session.nodes} busy={session.busy()} onEvent={session.send} />
    </Modal>
  );
}

// Keeps the last request mounted after it's cleared, so the modal's exit can play with its content.
function PluginModalHost(props: { request: PluginModalRequest | null, onHide: () => void }) {
  const [current, setCurrent] = createSignal<PluginModalRequest | null>(null);

  createEffect(() => {
    if (props.request) setCurrent(props.request);
  });

  return (
    <Show when={current()} keyed>
      {request => <PluginModalBody request={request} show={props.request === request} onHide={props.onHide} />}
    </Show>
  );
}

export default PluginModalHost;
