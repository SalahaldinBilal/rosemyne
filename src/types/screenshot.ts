import { Position } from "."
import { UploaderCreationError } from "./request"

export type Data = {
  imageId: number
  windows: Array<WindowInfo>,
  monitorPositions: Array<Dimensions>,
  mousePosition: Position,
  pickRegion?: boolean,
  record?: boolean,
  scrollCapture?: boolean,
  cursor: CursorImageInfo | null,
  cursorImageName: string,
  autoPlaceCursor: boolean,
}

// Emitted as "cursor://updated" once a fresher grab finishes encoding.
export type CursorImageInfo = {
  version: number,
  width: number,
  height: number,
  hotspotX: number,
  hotspotY: number,
}

// The user's own cursor scheme, re-read alongside the live cursor and pushed as "cursors://updated".
export type SystemCursorInfo = CursorImageInfo & {
  id: string,
  name: string,
}

export type CursorSource = "live" | "picked";

export type OverlayImage = {
  name: string,
  fileName: string,
}

export type RecordingStatus = {
  startedAtMs: number,
  withAudio: boolean,
}

// Pushed as "scroll-capture://progress" once per captured frame.
export type ScrollCaptureProgress = {
  frame: number,
  maxFrames: number,
}

export type StitchMatchMode = "normal" | "edges";

export type StitchParams = {
  windowSize: number,
  crop: number,
  matchMode: StitchMatchMode,
}

// Fetched via `get_scroll_capture_session` on mount, a brand-new webview isn't guaranteed to be listening for a push.
export type ScrollCaptureSession = {
  sessionId: number,
  imageId: number,
  width: number,
  height: number,
  frameCount: number,
  defaultParams: StitchParams,
}

export type RestitchResult = {
  imageId: number,
  width: number,
  height: number,
}

// A saved history image staged back into ScreenshotManager for re-editing; saving
// it writes a new history entry rather than overwriting the original.
export type ImageEditSession = {
  imageId: number,
  width: number,
  height: number,
}

export type WindowInfo = {
  name: string,
  processName: string,
  dimensions: DimensionsWithOrder,
  subDimensions: Array<DimensionsWithOrder>,
  visiblePercentage: number,
  visibleBounds: Array<Dimensions>,
}

export type Dimensions = {
  x: number,
  y: number,
  width: number,
  height: number,
}

export type DimensionsWithOrder = Dimensions & {
  zOrder: number
}

export type HistoryItemType = "image" | "video" | "file";

export type ImageHistoryData = {
  fileName: string,
  filePath: string,
  type: HistoryItemType,
  dateTime: string,
  tags: { [key: string]: TagValue } | null,
  fileSize?: number,
  host?: string,
  url?: string,
  deletionUrl?: string,
  uploadError?: UploaderCreationError,
}

export type UploadStartedEvent = { fileName: string }
export type UploadProgressEvent = { fileName: string, sent: number, total: number }
export type UploadFinishedEvent = { fileName: string, url: string, copied: boolean }
export type UploadFailedEvent = { fileName: string, error: UploaderCreationError }

export type HistoryCursor = {
  key: number | string,
  id: number,
}

export type HistorySort = {
  field: "date" | "name",
  direction: "asc" | "desc",
}

export type HistoryTypeCounts = Record<HistoryItemType, number>

export type HistoryPage = {
  items: Array<ImageHistoryData>,
  counts: HistoryTypeCounts | null,
  nextCursor: HistoryCursor | null,
}

export type TagMetadata = {
  schema: TagValueTypeMap,
}

export enum FilterRelationOperations {
  and,
  or
}

export enum FilterOperations {
  equals,
  notEquals,
  greaterThan,
  lessThan,
  greaterThanOrEqualTo,
  lessThanOrEqualTo,
  contains,
  notContains,
  startsWith,
  endsWith,
  fuzzy
}

export type TagValue = number | string | boolean | { [key: string]: TagValue } | Array<number> | Array<string> | Array<boolean> | Array<{ [key: string]: TagValue }> | null;
export type TagValueTypeMap = {
  [key: string]: { type: FilterValueType | TagValueTypeMap, isArray: boolean }
}

export type FilterScalar = number | string | boolean;
export type FilterValueType = "number" | "string" | "boolean" | "time" | "dateTime" | "byteSize";

// Wrapped-value convention for Time/DateTime tags, mirrors `TIME_TAG_KEY`/
// `DATE_TIME_TAG_KEY` in `screen_manager::screenshot_manager` (Rust).
export const TIME_TAG_KEY = "$time";
export const DATE_TIME_TAG_KEY = "$dateTime";

export type FilterCondition = {
  id: number,
  kind: "condition",
  path: string[],
  valueType: FilterValueType,
  operation: FilterOperations,
  values: FilterScalar[],
  caseSensitive: boolean,
};

export type FilterGroup = {
  id: number,
  kind: "group",
  relation: FilterRelationOperations,
  scope: string[],
  children: FilterNode[],
};

export type FilterNode = FilterCondition | FilterGroup;

export type SavedFilter = {
  name: string,
  filter: FilterGroup,
};

export type TagValueSuggestion = { value: string | number, count: number };

export const RELATION_LABELS: Record<FilterRelationOperations, string> = {
  [FilterRelationOperations.and]: "Match all (AND)",
  [FilterRelationOperations.or]: "Match any (OR)",
};

export const OPERATION_LABELS: Record<FilterOperations, string> = {
  [FilterOperations.equals]: "Equals",
  [FilterOperations.notEquals]: "Not equals",
  [FilterOperations.greaterThan]: "Greater than",
  [FilterOperations.lessThan]: "Less than",
  [FilterOperations.greaterThanOrEqualTo]: "At least",
  [FilterOperations.lessThanOrEqualTo]: "At most",
  [FilterOperations.contains]: "Contains",
  [FilterOperations.notContains]: "Doesn't contain",
  [FilterOperations.startsWith]: "Starts with",
  [FilterOperations.endsWith]: "Ends with",
  [FilterOperations.fuzzy]: "Fuzzy match",
};

export const OPERATIONS_BY_TYPE: Record<FilterValueType, FilterOperations[]> = {
  number: [
    FilterOperations.equals,
    FilterOperations.notEquals,
    FilterOperations.greaterThan,
    FilterOperations.greaterThanOrEqualTo,
    FilterOperations.lessThan,
    FilterOperations.lessThanOrEqualTo,
  ],
  string: [
    FilterOperations.equals,
    FilterOperations.notEquals,
    FilterOperations.contains,
    FilterOperations.notContains,
    FilterOperations.startsWith,
    FilterOperations.endsWith,
    FilterOperations.fuzzy,
  ],
  boolean: [
    FilterOperations.equals,
    FilterOperations.notEquals,
  ],
  time: [
    FilterOperations.equals,
    FilterOperations.notEquals,
    FilterOperations.greaterThan,
    FilterOperations.greaterThanOrEqualTo,
    FilterOperations.lessThan,
    FilterOperations.lessThanOrEqualTo,
  ],
  dateTime: [
    FilterOperations.equals,
    FilterOperations.notEquals,
    FilterOperations.greaterThan,
    FilterOperations.greaterThanOrEqualTo,
    FilterOperations.lessThan,
    FilterOperations.lessThanOrEqualTo,
  ],
  byteSize: [
    FilterOperations.equals,
    FilterOperations.notEquals,
    FilterOperations.greaterThan,
    FilterOperations.greaterThanOrEqualTo,
    FilterOperations.lessThan,
    FilterOperations.lessThanOrEqualTo,
  ],
};