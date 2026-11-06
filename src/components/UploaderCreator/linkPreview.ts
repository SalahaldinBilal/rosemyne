import { KeyValue, UploaderResponseHandler } from "../../types/request";

// Mirrors UploaderResponseHandler::parse_response in image_uploader/uploader_options.rs.
const PLACEHOLDER = /\$\{([^}]+)\}/g;

function valueAt(json: unknown, path: string): string | null {
  let current: unknown = json;

  for (const segment of path.split(".").filter(Boolean)) {
    if (Array.isArray(current)) {
      const index = /^\d+$/.test(segment) ? Number(segment) : NaN;
      current = Number.isNaN(index) ? undefined : current[index];
    } else if (current !== null && typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      current = undefined;
    }
    if (current === undefined) return null;
  }

  return typeof current === "string" ? current : JSON.stringify(current);
}

export function previewLink(handler: UploaderResponseHandler, body: string): string | null {
  if (handler.type === "text") {
    const chars = [...body];
    const resolve = (index: number | undefined | null, fallback: number) => {
      const value = index ?? fallback;
      const fromStart = value < 0 ? chars.length + value : value;
      return Math.min(chars.length, Math.max(0, fromStart));
    };
    const start = resolve(handler.data.start, 0);
    const end = resolve(handler.data.end, chars.length);
    return start < end ? chars.slice(start, end).join("") : "";
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }

  const path = handler.data.path;
  if (!new RegExp(PLACEHOLDER.source).test(path)) return valueAt(json, path);

  let missing = false;
  const result = path.replace(PLACEHOLDER, (_, inner: string) => {
    const value = valueAt(json, inner);
    if (value === null) missing = true;
    return value ?? "";
  });
  return missing ? null : result;
}

// The URL with the query parameters appended, variables left as typed.
export function urlWithQuery(url: string, params: KeyValue[]): string {
  const query = params
    .filter(param => param.key.trim() !== "")
    .map(param => `${encodeURIComponent(param.key)}=${encodeURIComponent(param.value).replace(/%24%7B/gi, "${").replace(/%7D/gi, "}")}`)
    .join("&");
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}
