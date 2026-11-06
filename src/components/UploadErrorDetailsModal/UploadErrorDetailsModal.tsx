import styles from "./UploadErrorDetailsModal.module.scss";
import { createMemo, For, Show } from "solid-js";
import Modal from "@core/components/Modal/Modal";
import Button from "@core/components/Button/Button";
import Badge, { MethodBadge } from "@core/components/Badge/Badge";
import { RequestSnapshot, UploaderCreationError } from "@core/types/request";

export function errorHasRequestDetails(error: UploaderCreationError | undefined): boolean {
  return error?.type === "requestFailed" || error?.type === "httpError";
}

function requestOf(error: UploaderCreationError | undefined): RequestSnapshot | undefined {
  if (!error) return undefined;
  if (error.type === "requestFailed" || error.type === "httpError") return error.data.request;
  return undefined;
}

function networkErrorOf(error: UploaderCreationError | undefined): string | undefined {
  if (!error || error.type !== "requestFailed") return undefined;
  return error.data.error;
}

function responseOf(error: UploaderCreationError | undefined) {
  if (!error || error.type !== "httpError") return undefined;
  return { status: error.data.status, headers: error.data.responseHeaders, body: error.data.body };
}

function HeaderTable(props: { headers: Array<[string, string]> }) {
  return <div class={styles.Headers}>
    <For each={props.headers}>
      {([name, value]) => <div class={styles.HeaderRow}>
        <span class={styles.HeaderName}>{name}</span>
        <span class={styles.HeaderValue}>{value}</span>
      </div>}
    </For>
  </div>;
}

function UploadErrorDetailsModal(props: {
  show: boolean,
  onHide: () => void,
  error: UploaderCreationError | undefined,
}) {
  const request = createMemo(() => requestOf(props.error));
  const networkError = createMemo(() => networkErrorOf(props.error));
  const response = createMemo(() => responseOf(props.error));

  return <Modal
    show={props.show}
    onHide={props.onHide}
    title="Upload failure details"
    width={640}
    height={600}
    footer={<Button variant="primary" onClick={props.onHide}>Close</Button>}
  >
    <div class={styles.Content}>
      <Show when={networkError()}>
        {message => <section class={styles.Section}>
          <h4 class={styles.SectionTitle}>Error</h4>
          <div class={styles.ErrorMessage}>{message()}</div>
        </section>}
      </Show>
      <Show when={request()}>
        {req => <section class={styles.Section}>
          <h4 class={styles.SectionTitle}>Request</h4>
          <div class={styles.RequestLine}>
            <MethodBadge method={req().method} />
            <span class={styles.Url}>{req().url}</span>
          </div>
          <Show when={(req().headers?.length ?? 0) > 0}>
            <HeaderTable headers={req().headers} />
          </Show>
          <pre class={styles.Body}>{req().body}</pre>
        </section>}
      </Show>
      <Show when={response()}>
        {res => <section class={styles.Section}>
          <h4 class={styles.SectionTitle}>
            Response
            <Badge tone={res().status >= 400 ? "danger" : "ok"}>{res().status}</Badge>
          </h4>
          <Show when={(res().headers?.length ?? 0) > 0}>
            <HeaderTable headers={res().headers} />
          </Show>
          <pre class={styles.Body}>{res().body || "(empty body)"}</pre>
        </section>}
      </Show>
    </div>
  </Modal>;
}

export default UploadErrorDetailsModal;
