import styles from "./UploaderCreator.module.scss";
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import Button from "@core/components/Button/Button";
import Input from "@core/components/Input/Input";
import Select from "@core/components/Select/Select";
import { KeyValue, SavedUploader, UploaderBodyHandler, UploaderCreationError, UploaderOptions, UploaderResponseHandler, UploaderValidation } from "@core/types/request";
import RequestPicker from "./RequestPicker/RequestPicker";
import { trackDeep } from "@solid-primitives/deep";
import { safeInvoke } from "@core/helpers/safeInvoke";
import EditableTableList from "../EditableTableList/EditableTableList";

const bodyTypeItems = [
  { id: "formData", value: "formData", label: "Multipart form (file upload)" },
  { id: "binary", value: "binary", label: "Raw binary body" },
  { id: "json", value: "json", label: "JSON body" },
  { id: "formUrlEncoded", value: "formUrlEncoded", label: "URL-encoded form" },
  { id: "none", value: "none", label: "No body" },
] as const;

const responseTypeItems = [
  { id: "text", value: "text", label: "Plain text" },
  { id: "json", value: "json", label: "JSON" },
] as const;

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
    case "noDefaultUploader": return "No default uploader is configured , create one in Settings → Uploaders";
    case "fileReadFailed": return `Could not read the image file: ${typed.data}`;
    default: return JSON.stringify(error);
  }
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
  const [jsonText, setJsonText] = createSignal(
    uploader.bodyHandler.type === "json" ? JSON.stringify(uploader.bodyHandler.data, null, 2) : "{}"
  );
  const [jsonError, setJsonError] = createSignal<string | null>(null);
  const [testResult, setTestResult] = createSignal<{ ok: boolean, message: string } | null>(null);
  const [testing, setTesting] = createSignal(false);

  const tableFields = ["headers", "params"] as const satisfies Array<keyof UploaderOptions>;
  const tableFieldsNames = { headers: "Headers", params: "Query Parameters" } as const satisfies { [Key in typeof tableFields[number]]: string };

  const formData = () => (uploader.bodyHandler as Extract<UploaderBodyHandler, { type: "formData" }>).data;
  const urlEncodedFields = () => (uploader.bodyHandler as Extract<UploaderBodyHandler, { type: "formUrlEncoded" }>).data;
  const responseText = () => (uploader.responseHandler as Extract<UploaderResponseHandler, { type: "text" }>).data;
  const responseJson = () => (uploader.responseHandler as Extract<UploaderResponseHandler, { type: "json" }>).data;

  // Deferred so a brand-new (empty-URL) uploader doesn't immediately show an
  // "Invalid URL" error before the user has touched anything , validation
  // only starts once they've actually changed a field.
  createEffect(on(() => trackDeep(uploader), () => {
    const handle = setTimeout(async () => {
      const result = await safeInvoke("is_uploader_valid", { uploader: structuredClone(unwrap(uploader)) });
      setValidation(result);
    }, 250);
    onCleanup(() => clearTimeout(handle));
  }, { defer: true }));

  const errorFor = (section: "request" | "headers" | "general") => {
    const result = validation();
    if (result.valid || !result.error) return null;

    const sectionByType: { [key: string]: "request" | "headers" } = {
      invalidUrl: "request",
      invalidMethod: "request",
      invalidHeaderName: "headers",
      invalidHeaderValue: "headers",
    };

    const errorSection = sectionByType[result.error.type] ?? "general";
    return errorSection === section ? describeUploaderError(result.error) : null;
  };

  const canSave = createMemo(() =>
    validation().valid &&
    name().trim().length > 0 &&
    !(uploader.bodyHandler.type === "json" && jsonError())
  );

  function changeBodyType(type: UploaderBodyHandler["type"]) {
    if (type === uploader.bodyHandler.type) return;

    let handler: UploaderBodyHandler;
    switch (type) {
      case "formData":
        handler = { type, data: { fileName: "file", extraFields: [] } };
        break;
      case "json": {
        let data: any = {};
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

    setUploader("responseHandler", reconcile(
      type === "text" ? { type: "text", data: {} } : { type: "json", data: { path: "" } }
    ));
  }

  function onJsonInput(text: string) {
    setJsonText(text);

    try {
      const parsed = JSON.parse(text);
      setJsonError(null);
      setUploader("bodyHandler", reconcile({ type: "json", data: parsed } as UploaderBodyHandler));
    } catch {
      setJsonError("Not valid JSON , the body will not be updated until this parses");
    }
  }

  function updateExtraFields(update: (fields: KeyValue[]) => KeyValue[]) {
    setPath("bodyHandler", "data", "extraFields", update(structuredClone(unwrap(formData().extraFields ?? []))));
  }

  function updateUrlEncodedFields(update: (fields: KeyValue[]) => KeyValue[]) {
    setPath("bodyHandler", "data", update(structuredClone(unwrap(urlEncodedFields()))));
  }

  function offsetInput(value: string): number | undefined {
    if (value === "" || Number.isNaN(+value)) return undefined;
    return +value;
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);

    try {
      const result = await safeInvoke("test_uploader", { uploader: structuredClone(unwrap(uploader)) });
      setTestResult({ ok: true, message: `Test upload succeeded → ${result.url}` });
    } catch (error) {
      setTestResult({ ok: false, message: describeUploaderError(error) });
    } finally {
      setTesting(false);
    }
  }

  function save() {
    props.onSave({
      id: props.initial?.id ?? crypto.randomUUID(),
      name: name().trim(),
      autoUpload: autoUpload(),
      options: structuredClone(unwrap(uploader)),
    });
  }

  return (
    <div class={styles.RequestCreator}>
      <div class={styles.NameRow}>
        <Input
          value={name()}
          placeholder="Uploader name"
          style={{ 'flex-grow': 1 }}
          onChange={e => setName(e.currentTarget.value)}
        />
        <Button disabled={!canSave()} onClick={save}>Save</Button>
        <Button disabled={!validation().valid || testing()} onClick={runTest}>
          {testing() ? "Testing…" : "Test upload"}
        </Button>
        <Show when={props.onCancel}>
          <Button onClick={() => props.onCancel?.()}>Cancel</Button>
        </Show>
      </div>
      <Show when={testResult()}>
        {result => <div classList={{ [styles.TestResult]: true, [styles.TestError]: !result().ok }}>{result().message}</div>}
      </Show>
      <label class={styles.SettingRow}>
        <input
          type="checkbox"
          checked={autoUpload()}
          onChange={e => setAutoUpload(e.currentTarget.checked)}
        />
        <div class={styles.SettingText}>
          <span>Auto upload</span>
          <span class={styles.Hint}>Automatically upload new screenshots and recordings with this uploader when it's the default.</span>
        </div>
      </label>
      <RequestPicker
        url={uploader.url}
        method={uploader.method}
        onUrlChange={url => setUploader("url", url)}
        onMethodChange={method => setUploader("method", method)}
      />
      <Show when={errorFor("request")}>
        {message => <div class={styles.FieldError}>{message()}</div>}
      </Show>
      <div class={styles.VarHint}>
        {"${filename} and ${timestamp} are substituted in the URL, params, headers and body fields."}
      </div>
      <div class={styles.Tables}>
        <For each={tableFields}>
          {tableField =>
            <div class={styles.TableContainer}>
              <div class={styles.Header}>{tableFieldsNames[tableField]}</div>
              <EditableTableList
                values={uploader[tableField]!}
                keys={["key", "value"]}
                keyDisplayOverrides={{ key: 'Key', value: 'Value' }}
                onNewItem={item => setUploader(tableField, uploader[tableField]!.length, { key: "", value: "", ...item })}
                onValueChange={(field, value, index) => setUploader(tableField, index, field, value)}
                onDeleteItem={index => setUploader(tableField, uploader[tableField]!.filter((_, i) => i !== index))}
              />
              <Show when={tableField === "headers" && errorFor("headers")}>
                {message => <div class={styles.FieldError}>{message()}</div>}
              </Show>
            </div>
          }
        </For>
      </div>
      <div class={styles.Section}>
        <div class={styles.SectionTitle}>Body</div>
        <div class={styles.SectionRow}>
          <span>Type</span>
          <Select
            value={uploader.bodyHandler.type}
            items={bodyTypeItems}
            onItemClick={item => changeBodyType(item.value)}
          />
        </div>
        <Switch>
          <Match when={uploader.bodyHandler.type === "formData"}>
            <div class={styles.SectionRow}>
              <span>File form field</span>
              <Input
                value={formData().fileName}
                placeholder="file"
                onChange={e => setPath("bodyHandler", "data", "fileName", e.currentTarget.value)}
              />
            </div>
            <div class={styles.SectionHint}>The image is sent as this multipart field, plus any extra fields below.</div>
            <EditableTableList
              values={formData().extraFields ?? []}
              keys={["key", "value"]}
              keyDisplayOverrides={{ key: 'Field', value: 'Value' }}
              onNewItem={item => updateExtraFields(fields => [...fields, { key: "", value: "", ...item }])}
              onValueChange={(field, value, index) => updateExtraFields(fields => {
                fields[index] = { ...fields[index], [field]: value };
                return fields;
              })}
              onDeleteItem={index => updateExtraFields(fields => fields.filter((_, i) => i !== index))}
            />
          </Match>
          <Match when={uploader.bodyHandler.type === "json"}>
            <textarea
              class={styles.JsonEditor}
              value={jsonText()}
              rows={8}
              spellcheck={false}
              onInput={e => onJsonInput(e.currentTarget.value)}
            />
            <Show when={jsonError()}>
              <div class={styles.FieldError}>{jsonError()}</div>
            </Show>
          </Match>
          <Match when={uploader.bodyHandler.type === "formUrlEncoded"}>
            <EditableTableList
              values={urlEncodedFields()}
              keys={["key", "value"]}
              keyDisplayOverrides={{ key: 'Field', value: 'Value' }}
              onNewItem={item => updateUrlEncodedFields(fields => [...fields, { key: "", value: "", ...item }])}
              onValueChange={(field, value, index) => updateUrlEncodedFields(fields => {
                fields[index] = { ...fields[index], [field]: value };
                return fields;
              })}
              onDeleteItem={index => updateUrlEncodedFields(fields => fields.filter((_, i) => i !== index))}
            />
          </Match>
          <Match when={uploader.bodyHandler.type === "binary"}>
            <div class={styles.SectionHint}>The image bytes are sent as the raw request body.</div>
          </Match>
          <Match when={uploader.bodyHandler.type === "none"}>
            <div class={styles.SectionHint}>No request body is sent.</div>
          </Match>
        </Switch>
      </div>
      <div class={styles.Section}>
        <div class={styles.SectionTitle}>Response</div>
        <div class={styles.SectionRow}>
          <span>Parse as</span>
          <Select
            value={uploader.responseHandler.type}
            items={responseTypeItems}
            onItemClick={item => changeResponseType(item.value)}
          />
        </div>
        <Switch>
          <Match when={uploader.responseHandler.type === "text"}>
            <div class={styles.SectionRow}>
              <span>Start offset</span>
              <Input
                type="number"
                value={responseText().start ?? ""}
                placeholder="0"
                style={{ width: '130px' }}
                onChange={e => setPath("responseHandler", "data", "start", offsetInput(e.currentTarget.value))}
              />
              <span>End offset</span>
              <Input
                type="number"
                value={responseText().end ?? ""}
                placeholder="end"
                style={{ width: '130px' }}
                onChange={e => setPath("responseHandler", "data", "end", offsetInput(e.currentTarget.value))}
              />
            </div>
            <div class={styles.SectionHint}>
              The URL is sliced out of the response text. Negative offsets count from the end; leave both empty to use the whole response.
            </div>
          </Match>
          <Match when={uploader.responseHandler.type === "json"}>
            <div class={styles.SectionRow}>
              <span>URL path</span>
              <Input
                value={responseJson().path}
                placeholder="data.url"
                style={{ 'flex-grow': 1 }}
                onChange={e => setPath("responseHandler", "data", "path", e.currentTarget.value)}
              />
            </div>
            <div class={styles.SectionHint}>
              <div>Dot-separated path to the URL inside the JSON response , object keys by name, array items by index:</div>
              <div>{'{"data":{"url":"https://…"}}'} → data.url&ensp;•&ensp;{'{"files":[{"link":"https://…"}]}'} → files.0.link</div>
              <div>If the response only holds part of the URL, write a template with {'${path}'} placeholders:</div>
              <div>{'{"id":"a1b2c3"}'} → https://files.example.com/{'${id}'}&ensp;•&ensp;{'{"host":"cdn.example.com","file":{"key":"x9"}}'} → https://{'${host}'}/{'${file.key}'}</div>
            </div>
          </Match>
        </Switch>
      </div>
      <Show when={errorFor("general")}>
        {message => <div class={styles.FieldError}>{message()}</div>}
      </Show>
    </div>
  );
}

export default UploaderCreator;
