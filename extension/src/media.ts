const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/apng": "apng",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/ogg": "ogv",
  "video/x-matroska": "mkv",
};

const MAX_STEM_LENGTH = 80;

function hasAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function gifHasSeveralFrames(bytes: Uint8Array): boolean {
  const colorTableSize = (flags: number): number => (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0);

  function skipSubBlocks(position: number): number {
    while (position < bytes.length && bytes[position] !== 0) {
      position += bytes[position] + 1;
    }
    return position + 1;
  }

  let position = 13 + colorTableSize(bytes[10]);
  let frames = 0;

  while (position < bytes.length) {
    const block = bytes[position];
    if (block === 0x2c) {
      frames++;
      if (frames > 1) return true;
      position = skipSubBlocks(position + 11 + colorTableSize(bytes[position + 9]));
    } else if (block === 0x21) {
      position = skipSubBlocks(position + 2);
    } else {
      break;
    }
  }

  return false;
}

function pngIsAnimated(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = 8;

  while (position + 8 <= bytes.length) {
    if (hasAscii(bytes, position + 4, "acTL")) return true;
    if (hasAscii(bytes, position + 4, "IDAT")) return false;
    position += 12 + view.getUint32(position);
  }

  return false;
}

export async function isAnimated(blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.arrayBuffer());

  if (hasAscii(bytes, 0, "GIF8")) return gifHasSeveralFrames(bytes);
  if (hasAscii(bytes, 0, "\x89PNG")) return pngIsAnimated(bytes);
  if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP")) {
    return hasAscii(bytes, 12, "VP8X") && (bytes[20] & 0x02) !== 0;
  }
  return hasAscii(bytes, 4, "ftyp") && hasAscii(bytes, 8, "avis");
}

function nameFromUrl(url: string): string {
  if (!/^https?:/.test(url)) return "";

  const segment = new URL(url).pathname.split("/").pop() ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function extensionFromBytes(head: Uint8Array): string | null {
  if (hasAscii(head, 0, "GIF8")) return "gif";
  if (hasAscii(head, 0, "\x89PNG")) return "png";
  if (hasAscii(head, 0, "\xff\xd8\xff")) return "jpg";
  if (hasAscii(head, 0, "RIFF") && hasAscii(head, 8, "WEBP")) return "webp";
  if (hasAscii(head, 0, "\x1a\x45\xdf\xa3")) return "webm";
  if (hasAscii(head, 4, "ftyp")) return hasAscii(head, 8, "avi") ? "avif" : "mp4";
  return null;
}

export async function fileNameFor(url: string, blob: Blob): Promise<string> {
  const name = nameFromUrl(url);
  const dot = name.lastIndexOf(".");
  const hasExtension = dot > 0 && /^[a-z0-9]{2,5}$/i.test(name.slice(dot + 1));
  const stem = (hasExtension ? name.slice(0, dot) : name).slice(0, MAX_STEM_LENGTH) || "media";
  if (hasExtension) return `${stem}.${name.slice(dot + 1)}`;

  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const extension = MIME_EXTENSIONS[blob.type.split(";")[0].trim().toLowerCase()] ?? extensionFromBytes(head);

  // Rosemyne types imports by extension, so an unknown type goes in as a plain file.
  return `${stem}.${extension ?? "bin"}`;
}
