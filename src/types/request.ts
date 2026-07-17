export type UploaderMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | (string & {});

export type UploaderOptions = {
  url: string,
  method: UploaderMethod,
  responseHandler: UploaderResponseHandler,
  bodyHandler: UploaderBodyHandler,
  params?: Array<KeyValue>,
  headers?: Array<KeyValue>,
}

export type SavedUploader = {
  id: string,
  name: string,
  autoUpload: boolean,
  options: UploaderOptions,
}

export type KeyValue = {
  key: string,
  value: string
}

export type BaseUploaderType<Type extends String, Data> = [Data] extends [XPathNSResolver] ? { type: Type } : { type: Type, data: Data };

export type UploaderResponseHandler =
  BaseUploaderType<"text", { start?: number, end?: number }> |
  BaseUploaderType<"json", { path: string }>

// Exactly what was sent for a failed upload request , `body` is a
// human-readable summary (the real text for JSON/form bodies; a byte-count/
// mime description for binary and multipart file parts).
export type RequestSnapshot = {
  method: string,
  url: string,
  headers: Array<[string, string]>,
  body: string,
}

export type UploaderCreationError =
  BaseUploaderType<"invalidUrl", { url: string, error: string }> | BaseUploaderType<"invalidMethod", string> |
  BaseUploaderType<"invalidHeaderName", string> | BaseUploaderType<"invalidHeaderValue", string> |
  BaseUploaderType<"invalidMime", string> |
  BaseUploaderType<"requestFailed", { request: RequestSnapshot, error: string }> |
  BaseUploaderType<"httpError", { status: number, body: string, request: RequestSnapshot, responseHeaders: Array<[string, string]> }> |
  BaseUploaderType<"responseNotJson", string> | BaseUploaderType<"jsonPathNotFound", { path: string }> |
  BaseUploaderType<"imageNotFound", string> | BaseUploaderType<"uploaderNotFound", string> |
  BaseUploaderType<"noDefaultUploader", never> | BaseUploaderType<"fileReadFailed", string>;

export type UploaderValidation = {
  valid: boolean,
  error?: UploaderCreationError,
}

export type UploadResult = {
  url: string,
  /** Whether the backend managed to put the URL on the clipboard. */
  copied: boolean,
}

export type UploaderBodyHandler =
  BaseUploaderType<"formData", { fileName: string, extraFields?: Array<KeyValue> }> |
  BaseUploaderType<"binary", never> | BaseUploaderType<"none", never> | BaseUploaderType<"json", unknown> |
  BaseUploaderType<"formUrlEncoded", Array<KeyValue>>;
