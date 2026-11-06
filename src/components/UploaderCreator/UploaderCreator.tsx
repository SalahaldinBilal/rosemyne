import styles from "./UploaderCreator.module.scss";
import { createEffect, createMemo, createSignal, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import Button from "@core/components/Button/Button";
import Input from "@core/components/Input/Input";
import Select from "@core/components/Select/Select";
import Segmented from "@core/components/Segmented/Segmented";
import SwitchToggle from "@core/components/Switch/Switch";
import NumberField from "@core/components/NumberField/NumberField";
import Modal from "@core/components/Modal/Modal";
import TemplateInput from "@core/components/TemplateInput/TemplateInput";
import { methodColor } from "@core/components/Badge/Badge";
import { Spinner } from "@core/components/Progress/Progress";
import { UPLOADER_VARIABLES } from "@core/constants/templateVariables";
import { KeyValue, SavedUploader, UploaderBodyHandler, UploaderCreationError, UploaderOptions, UploaderResponseHandler, UploaderTestResult, UploaderValidation } from "@core/types/request";
import { trackDeep } from "@solid-primitives/deep";
import { safeInvoke } from "@core/helpers/safeInvoke";
import useTitleBarState from "@core/states/titleBarState";
import KeyValueList from "./KeyValueList/KeyValueList";
import { previewLink, urlWithQuery } from "./linkPreview";
import { ArrowLeft, CircleAlert, CircleCheck, Copy, FlaskConical, X } from "lucide-solid";

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "Custom"] as const;
const METHOD_ITEMS = METHODS.map(method => ({ id: method, value: method, label: method }));

type Part = "headers" | "query" | "body" | "response";
type BodyType = UploaderBodyHandler["type"];

const BODY_LABELS: Record<BodyType, string> = {
  formData: "Multipart",
  binary: "Binary",
  json: "JSON",
  formUrlEncoded: "URL-encoded",
  none: "None",
};
const BODY_ITEMS = (Object.keys(BODY_LABELS) as BodyType[]).map(type => ({ id: type, label: BODY_LABELS[type] }));
const RESPONSE_ITEMS = [{ id: "text" as const, label: "Text" }, { id: "json" as const, label: "JSON" }];

type TestOutcome =
  | { kind: "ok", result: UploaderTestResult }
  | { kind: "failed", error: UploaderCreationError | unknown };

function emptyOptions(): UploaderOptions {
  return {
    url: "",
    method: "POST",
    headers: [],
    params: [],
    bodyHandler: { type: "formData", data: { fileName: "file", extraFields: [] } },
    responseHandler: { type: "text", data: {} },
  };
}

export function describeUploaderError(error: UploaderCreationError | unknown): string {
  if (typeof error === "string") return error;

  const typed = error as UploaderCreationError;

  switch (typed?.type) {
    case "invalidUrl": return `Invalid URL "${typed.data.url}": ${typed.data.error}`;
    case "invalidMethod": return `Invalid method "${typed.data}"`;
    case "invalidHeaderName": return `Invalid header name "${typed.data}"`;
    case "invalidHeaderValue": return `Invalid header value "${typed.data}"`;
    case "invalidMime": return `Invalid mime type "${typed.data}"`;
    case "requestFailed": return `Request failed: ${typed.data.error}`;
    case "httpError": return `Server responded with status ${typed.data.status}: ${typed.data.body}`;
    case "responseNotJson": return `Response was not valid JSON: ${typed.data}`;
    case "jsonPathNotFound": return `Path "${typed.data.path}" was not found in the JSON response`;
    case "imageNotFound": return `Image "${typed.data}" was not found in history`;
    case "uploaderNotFound": return `Uploader "${typed.data}" no longer exists`;
    case "noDefaultUploader": return "No default uploader is configured, create one in Settings › Uploaders";
    case "fileReadFailed": return `Could not read the image file: ${typed.data}`;
    default: return JSON.stringify(error);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function failureHeadline(error: UploaderCreationError | unknown): string {
  const typed = error as UploaderCreationError;
  if (typed?.type === "requestFailed") return `Couldn't connect · ${hostOf(typed.data.request.url)}: ${typed.data.error}`;
  if (typed?.type === "httpError") return `${typed.data.status} · the server refused the upload`;
  return describeUploaderError(error);
}

function failureBody(error: UploaderCreationError | unknown): string | null {
  const typed = error as UploaderCreationError;
  return typed?.type === "httpError" ? typed.data.body : null;
}

function UploaderCreator(props: {
  initial?: SavedUploader,
  onSave: (uploader: SavedUploader) => any,
  onCancel?: () => any,
}) {
  const [uploader, setUploader] = createStore<UploaderOptions>(
    props.initial ? structuredClone(props.initial.options) : emptyOptions()
  );
  const setPath = setUploader as (...args: any[]) => void;
  const [name, setName] = createSignal(props.initial?.name ?? "");
  const [autoUpload, setAutoUpload] = createSignal(props.initial?.autoUpload ?? true);
  const [validation, setValidation] = createSignal<UploaderValidation>({ valid: true });
  const [urlTouched, setUrlTouched] = createSignal(!!props.initial);
  const [jsonText, setJsonText] = createSignal(
    uploader.bodyHandler.type === "json" ? JSON.stringify(uploader.bodyHandler.data, null, 2) : "{}"
  );
  const [jsonError, setJsonError] = createSignal<string | null>(null);
  const [test, setTest] = createSignal<TestOutcome | null>(null);
  const [showResponse, setShowResponse] = createSignal(false);
  const [testing, setTesting] = createSignal(false);
  const [part, setPart] = createSignal<Part>("headers");
  const [isCustomMethod, setIsCustomMethod] = createSignal(!METHODS.includes(uploader.method as typeof METHODS[number]));
  const [confirmingDiscard, setConfirmingDiscard] = createSignal(false);
  const { setCrumbTail } = useTitleBarState;

  const snapshot = () => JSON.stringify({ name: name().trim(), autoUpload: autoUpload(), options: unwrap(uploader) });
  const initialSnapshot = snapshot();

  const headers = createMemo(() => uploader.headers ?? []);
  const params = createMemo(() => uploader.params ?? []);
  const formData = createMemo(() => (uploader.bodyHandler as Extract<UploaderBodyHandler, { type: "formData" }>).data);
  const urlEncodedFields = createMemo(() => (uploader.bodyHandler as Extract<UploaderBodyHandler, { type: "formUrlEncoded" }>).data);
  const responseText = createMemo(() => (uploader.responseHandler as Extract<UploaderResponseHandler, { type: "text" }>).data);
  const responseJson = createMemo(() => (uploader.responseHandler as Extract<UploaderResponseHandler, { type: "json" }>).data);
  const crumbName = createMemo(() => name().trim() || (props.initial ? props.initial.name : "New uploader"));

  onMount(() => setCrumbTail([crumbName()]));
  createEffect(on(crumbName, current => setCrumbTail([current]), { defer: true }));
  onCleanup(() => setCrumbTail([]));

  createEffect(on(() => trackDeep(uploader), () => {
    const handle = setTimeout(async () => {
      setValidation(await safeInvoke("is_uploader_valid", { uploader: structuredClone(unwrap(uploader)) }));
    }, 250);
    onCleanup(() => clearTimeout(handle));
  }));

  const dirty = createMemo(() => {
    trackDeep(uploader);
    return snapshot() !== initialSnapshot;
  });

  function errorFor(section: "request" | "headers" | "general"): string | null {
    const result = validation();
    if (result.valid || !result.error) return null;

    const sectionByType: { [key: string]: "request" | "headers" } = {
      invalidUrl: "request",
      invalidMethod: "request",
      invalidHeaderName: "headers",
      invalidHeaderValue: "headers",
    };
    return (sectionByType[result.error.type] ?? "general") === section ? describeUploaderError(result.error) : null;
  }

  const requestError = createMemo(() => urlTouched() ? errorFor("request") : null);
  const headersError = createMemo(() => errorFor("headers"));
  const generalError = createMemo(() => errorFor("general"));

  const saveBlocker = createMemo(() => {
    if (!name().trim()) return "Give the uploader a name first";
    if (!validation().valid) return "Fix the errors first";
    if (uploader.bodyHandler.type === "json" && jsonError()) return "Fix the JSON body first";
    if (!dirty()) return "Nothing changed";
    return null;
  });
  const testBlocker = createMemo(() => {
    if (testing()) return "Testing";
    if (!uploader.url.trim() || errorFor("request")) return "Enter a valid URL first";
    if (!validation().valid) return "Fix the errors first";
    return null;
  });

  const partItems = createMemo(() => [
    { id: "headers" as const, label: <>Headers<span class={styles.Count}>{headers().length}</span></> },
    { id: "query" as const, label: <>Query<span class={styles.Count}>{params().length}</span></> },
    { id: "body" as const, label: <>Body<span class={styles.Sub}>{BODY_LABELS[uploader.bodyHandler.type]}</span></> },
    { id: "response" as const, label: <>Response<span class={styles.Sub}>{uploader.responseHandler.type === "json" ? "JSON" : "Text"}</span></> },
  ]);

  const methodSelectValue = createMemo(() => isCustomMethod() ? "Custom" : uploader.method);
  const currentMethodColor = createMemo(() => methodColor(isCustomMethod() ? "" : uploader.method));
  const finalUrl = createMemo(() => urlWithQuery(uploader.url, params()));
  const lastBody = createMemo(() => {
    const outcome = test();
    if (!outcome) return null;
    return outcome.kind === "ok" ? outcome.result.body : failureBody(outcome.error);
  });
  const linkCheck = createMemo(() => {
    const body = lastBody();
    if (body === null) return null;
    trackDeep(uploader.responseHandler);
    return previewLink(unwrap(uploader.responseHandler), body);
  });

  function pickMethod(method: typeof METHODS[number]) {
    if (method === "Custom") {
      setIsCustomMethod(true);
      setUploader("method", "");
      return;
    }
    setIsCustomMethod(false);
    setUploader("method", method);
  }

  function changeBodyType(type: BodyType) {
    if (type === uploader.bodyHandler.type) return;

    let handler: UploaderBodyHandler;
    switch (type) {
      case "formData":
        handler = { type, data: { fileName: "file", extraFields: [] } };
        break;
      case "json": {
        let data: unknown = {};
        try { data = JSON.parse(jsonText()); } catch { }
        handler = { type, data };
        break;
      }
      case "formUrlEncoded":
        handler = { type, data: [] };
        break;
      default:
        handler = { type } as UploaderBodyHandler;
    }

    setUploader("bodyHandler", reconcile(handler));
  }

  function changeResponseType(type: UploaderResponseHandler["type"]) {
    if (type === uploader.responseHandler.type) return;
    setUploader("responseHandler", reconcile(type === "text" ? { type: "text", data: {} } : { type: "json", data: { path: "" } }));
  }

  function onJsonInput(text: string) {
    setJsonText(text);

    try {
      const parsed = JSON.parse(text);
      setJsonError(null);
      setUploader("bodyHandler", reconcile({ type: "json", data: parsed } as UploaderBodyHandler));
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Not valid JSON");
    }
  }

  function listActions(read: () => KeyValue[], write: (next: KeyValue[]) => void) {
    return {
      onAdd: () => write([...structuredClone(unwrap(read())), { key: "", value: "" }]),
      onChange: (index: number, field: keyof KeyValue, value: string) => {
        const next = structuredClone(unwrap(read()));
        next[index] = { ...next[index], [field]: value };
        write(next);
      },
      onRemove: (index: number) => write(read().filter((_, i) => i !== index)),
    };
  }

  const headerActions = listActions(() => headers(), next => setUploader("headers", next));
  const queryActions = listActions(() => params(), next => setUploader("params", next));
  const extraFieldActions = listActions(() => formData().extraFields ?? [], next => setPath("bodyHandler", "data", "extraFields", next));
  const urlEncodedActions = listActions(() => urlEncodedFields(), next => setPath("bodyHandler", "data", next));

  async function runTest() {
    if (testBlocker()) return;
    setUrlTouched(true);
    setTesting(true);
    setShowResponse(false);

    try {
      const result = await safeInvoke("test_uploader", { uploader: structuredClone(unwrap(uploader)) });
      setTest({ kind: "ok", result });
    } catch (error) {
      setTest({ kind: "failed", error });
    } finally {
      setTesting(false);
    }
  }

  function save() {
    if (saveBlocker()) return;
    props.onSave({
      id: props.initial?.id ?? crypto.randomUUID(),
      name: name().trim(),
      autoUpload: autoUpload(),
      options: structuredClone(unwrap(uploader)),
    });
  }

  function leave() {
    if (dirty()) setConfirmingDiscard(true);
    else props.onCancel?.();
  }

  function copyTestLink(url: string) {
    safeInvoke("copy_text_to_clipboard", { text: url }).catch(() => { });
  }

  return (
    <div class={styles.Editor}>
      <div class={styles.Header}>
        <Button isIcon variant="ghost" tooltip="Back to uploaders" onClick={leave}><ArrowLeft size={17} /></Button>
        <input
          class={styles.Name}
          value={name()}
          placeholder="Uploader name"
          spellcheck={false}
          onInput={event => setName(event.currentTarget.value)}
        />
        <label class={styles.AutoUpload} title="Upload new captures with this uploader when it's the default">
          <SwitchToggle checked={autoUpload()} onChange={setAutoUpload} />
          Auto upload
        </label>
        <Button tooltip={testBlocker() ?? "Upload a small test image"} disabled={!!testBlocker()} onClick={runTest}>
          <Show when={testing()} fallback={<FlaskConical size={15} />}><Spinner size="sm" /></Show>Test
        </Button>
        <Button onClick={leave}>Cancel</Button>
        <Button variant="primary" tooltip={saveBlocker() ?? undefined} disabled={!!saveBlocker()} onClick={save}>Save</Button>
      </div>

      <div class={styles.Request} classList={{ [styles.Bad]: !!requestError() }}>
        <Select
          variant="bare"
          class={styles.Method}
          labelColor={currentMethodColor()}
          value={methodSelectValue()}
          items={METHOD_ITEMS}
          onItemClick={item => pickMethod(item.value)}
        />
        <Show when={isCustomMethod()}>
          <Input
            borderless
            noRadius
            mono
            class={styles.CustomMethod}
            value={uploader.method}
            placeholder="METHOD"
            onChange={event => setUploader("method", event.currentTarget.value)}
          />
        </Show>
        <TemplateInput
          class={styles.Url}
          value={uploader.url}
          placeholder="https://example.com/upload"
          variables={UPLOADER_VARIABLES}
          onChange={url => { setUrlTouched(true); setUploader("url", url); }}
        />
      </div>
      <div class={styles.RequestFoot}>
        <Show when={requestError()}>
          {message => <span class={styles.Error}><CircleAlert size={13} />{message()}</span>}
        </Show>
        <span class={styles.VarHint}>Type <code>$</code> in any field for <code>{"${filename}"}</code> or <code>{"${timestamp}"}</code></span>
      </div>

      <Show when={test()} keyed>
        {outcome => (
          <>
            <Switch>
              <Match when={outcome.kind === "ok" && outcome.result}>
                {result => (
                  <div class={styles.Banner} classList={{ [styles.Ok]: !!result().url, [styles.Warn]: !result().url }}>
                    <Show when={result().url} fallback={<CircleAlert size={15} />}><CircleCheck size={15} /></Show>
                    <span class={styles.BannerText}>
                      <b>{result().status} OK · {result().elapsedMs} ms</b>
                      <Show
                        when={result().url}
                        fallback={<span> · The upload worked, but the link path found nothing in the response.</span>}
                      >
                        {url => <span class={styles.Mono}> · {url()}</span>}
                      </Show>
                    </span>
                    <Show when={result().url}>
                      {url => <Button isIcon size="xs" tooltip="Copy link" onClick={() => copyTestLink(url())}><Copy size={12} /></Button>}
                    </Show>
                    <Button size="xs" variant="ghost" active={showResponse()} onClick={() => setShowResponse(value => !value)}>Response</Button>
                    <Button isIcon size="xs" variant="ghost" tooltip="Close" onClick={() => setTest(null)}><X size={13} /></Button>
                  </div>
                )}
              </Match>
              <Match when={outcome.kind === "failed" && outcome}>
                {failed => (
                  <div class={styles.Banner} classList={{ [styles.Danger]: true }}>
                    <CircleAlert size={15} />
                    <span class={styles.BannerText}><b>{failureHeadline((failed() as { error: unknown }).error)}</b></span>
                    <Show when={failureBody((failed() as { error: unknown }).error) !== null}>
                      <Button size="xs" variant="ghost" active={showResponse()} onClick={() => setShowResponse(value => !value)}>Response</Button>
                    </Show>
                    <Button isIcon size="xs" variant="ghost" tooltip="Close" onClick={() => setTest(null)}><X size={13} /></Button>
                  </div>
                )}
              </Match>
            </Switch>
            <Show when={showResponse() && lastBody() !== null}>
              <pre class={styles.Response}>{lastBody() || "(empty response)"}</pre>
            </Show>
          </>
        )}
      </Show>

      <Segmented class={styles.Parts} items={partItems()} value={part()} onChange={setPart} />

      <div class={styles.Panel}>
        <Switch>
          <Match when={part() === "headers"}>
            <KeyValueList values={headers()} keyPlaceholder="Header" addLabel="Add header" {...headerActions} />
            <Show when={headersError()}>
              {message => <span class={styles.Error}><CircleAlert size={13} />{message()}</span>}
            </Show>
          </Match>

          <Match when={part() === "query"}>
            <KeyValueList values={params()} keyPlaceholder="Parameter" addLabel="Add parameter" {...queryActions} />
            <div class={styles.Preview}>
              <span>Final URL</span>
              <span class={styles.Mono} title={finalUrl()}>{finalUrl() || "Enter a URL above"}</span>
            </div>
          </Match>

          <Match when={part() === "body"}>
            <Segmented size="sm" items={BODY_ITEMS} value={uploader.bodyHandler.type} onChange={changeBodyType} />
            <Switch>
              <Match when={uploader.bodyHandler.type === "formData"}>
                <div class={styles.Field}>
                  <span class={styles.Label}>File field</span>
                  <Input size="sm" mono class={styles.FieldInput} value={formData().fileName} placeholder="file" onChange={e => setPath("bodyHandler", "data", "fileName", e.currentTarget.value)} />
                </div>
                <div class={styles.Field} classList={{ [styles.Top]: true }}>
                  <span class={styles.Label}>Extra fields</span>
                  <div class={styles.FieldInput}>
                    <KeyValueList values={formData().extraFields ?? []} keyPlaceholder="Field" addLabel="Add field" {...extraFieldActions} />
                  </div>
                </div>
              </Match>
              <Match when={uploader.bodyHandler.type === "json"}>
                <TemplateInput multiline value={jsonText()} variables={UPLOADER_VARIABLES} invalid={!!jsonError()} onChange={onJsonInput} />
                <Show when={jsonError()}>
                  {message => <span class={styles.Error}><CircleAlert size={13} />{message()}. The body keeps its last valid value.</span>}
                </Show>
              </Match>
              <Match when={uploader.bodyHandler.type === "formUrlEncoded"}>
                <KeyValueList values={urlEncodedFields()} keyPlaceholder="Field" addLabel="Add field" {...urlEncodedActions} />
              </Match>
              <Match when={uploader.bodyHandler.type === "binary"}>
                <span class={styles.Hint}>The file is sent as the raw request body.</span>
              </Match>
              <Match when={uploader.bodyHandler.type === "none"}>
                <span class={styles.Hint}>No request body is sent.</span>
              </Match>
            </Switch>
          </Match>

          <Match when={part() === "response"}>
            <Segmented size="sm" items={RESPONSE_ITEMS} value={uploader.responseHandler.type} onChange={changeResponseType} />
            <Switch>
              <Match when={uploader.responseHandler.type === "text"}>
                <div class={styles.Field}>
                  <span class={styles.Label}>Cut from</span>
                  <NumberField
                    size="sm"
                    width={90}
                    allowEmpty
                    min={-1_000_000}
                    max={1_000_000}
                    placeholder="start"
                    value={responseText().start ?? null}
                    onChange={value => setPath("responseHandler", "data", "start", value)}
                    onEmpty={() => setPath("responseHandler", "data", "start", undefined)}
                  />
                  <span class={styles.Label}>to</span>
                  <NumberField
                    size="sm"
                    width={90}
                    allowEmpty
                    min={-1_000_000}
                    max={1_000_000}
                    placeholder="end"
                    value={responseText().end ?? null}
                    onChange={value => setPath("responseHandler", "data", "end", value)}
                    onEmpty={() => setPath("responseHandler", "data", "end", undefined)}
                  />
                </div>
                <span class={styles.Hint}>Negative numbers count from the end. Leave both empty to use the whole response.</span>
              </Match>
              <Match when={uploader.responseHandler.type === "json"}>
                <div class={styles.Field}>
                  <span class={styles.Label}>Link path</span>
                  <Input size="sm" mono class={styles.FieldInput} value={responseJson().path} placeholder="data.url" onChange={e => setPath("responseHandler", "data", "path", e.currentTarget.value)} />
                </div>
                <div class={styles.Examples}>
                  <span class={styles.Faint}>{'{"data":{"url":"…"}}'}</span><span>→</span><span>data.url</span>
                  <span class={styles.Faint}>{'{"files":[{"link":"…"}]}'}</span><span>→</span><span>files.0.link</span>
                  <span class={styles.Faint}>{'{"id":"a1b2"}'}</span><span>→</span><span>{"https://example.com/${id}"}</span>
                </div>
              </Match>
            </Switch>
            <div class={styles.LinkCheck} classList={{ [styles.Ok]: !!linkCheck(), [styles.Danger]: lastBody() !== null && !linkCheck() }}>
              <Switch fallback={<span>Run a test to check what the link comes out as.</span>}>
                <Match when={linkCheck()}>
                  {link => <><CircleCheck size={14} /><span>From the last test this gives <span class={styles.Mono}>{link()}</span></span></>}
                </Match>
                <Match when={lastBody() !== null}>
                  <CircleAlert size={14} /><span>Not found in the last test response</span>
                </Match>
              </Switch>
            </div>
          </Match>
        </Switch>
      </div>

      <Show when={generalError()}>
        {message => <span class={styles.Error}><CircleAlert size={13} />{message()}</span>}
      </Show>

      <Modal
        show={confirmingDiscard()}
        onHide={() => setConfirmingDiscard(false)}
        title="Discard changes?"
        width={420}
        footer={<>
          <Button onClick={() => setConfirmingDiscard(false)}>Keep editing</Button>
          <Button variant="danger-solid" onClick={() => { setConfirmingDiscard(false); props.onCancel?.(); }}>Discard</Button>
        </>}
      >
        <p>Your changes to this uploader haven't been saved.</p>
      </Modal>
    </div>
  );
}

export default UploaderCreator;
