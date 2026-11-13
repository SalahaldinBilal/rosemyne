import { UploaderCreationError } from "@core/types/request";

function uploaderErrorMessage(error: UploaderCreationError): string | null {
  switch (error.type) {
    case "invalidUrl": return `Invalid URL "${error.data.url}": ${error.data.error}`;
    case "invalidMethod": return `Invalid method "${error.data}"`;
    case "invalidHeaderName": return `Invalid header name "${error.data}"`;
    case "invalidHeaderValue": return `Invalid header value "${error.data}"`;
    case "invalidMime": return `Invalid mime type "${error.data}"`;
    case "requestFailed": return `Request failed: ${error.data.error}`;
    case "httpError": return `Server responded with status ${error.data.status}: ${error.data.body}`;
    case "responseNotJson": return `Response was not valid JSON: ${error.data}`;
    case "jsonPathNotFound": return `Path "${error.data.path}" was not found in the JSON response`;
    case "imageNotFound": return `Image "${error.data}" was not found in history`;
    case "uploaderNotFound": return `Uploader "${error.data}" no longer exists`;
    case "noDefaultUploader": return "No default uploader is configured, create one in Settings › Uploaders";
    case "fileReadFailed": return `Could not read the image file: ${error.data}`;
    case "plugin": return `The plugin failed to upload: ${error.data}`;
    default: return null;
  }
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    if ("type" in error) {
      const message = uploaderErrorMessage(error as UploaderCreationError);
      if (message) return message;
    }
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  console.error("Unrecognized error shape", error);
  return "Something went wrong, see the console for details";
}
