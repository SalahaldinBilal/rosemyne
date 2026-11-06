// Must match expand_save_dir and expand_file_name_template in history_store/store.rs,
// and UploadFile::vars in image_uploader/uploader_options.rs.

export type TemplateVariable = {
  name: string;
  description: string;
  argument?: { min: number; max: number; default: number };
};

const DATE_VARIABLES: TemplateVariable[] = [
  { name: "year", description: "Four-digit year" },
  { name: "month", description: "Month, 01 to 12" },
  { name: "day", description: "Day of the month, 01 to 31" },
  { name: "hour", description: "Hour, 00 to 23" },
  { name: "minute", description: "Minute, 00 to 59" },
  { name: "second", description: "Second, 00 to 59" },
];

export const SAVE_PATH_VARIABLES: TemplateVariable[] = [
  ...DATE_VARIABLES,
  { name: "type", description: "image, video or file" },
];

export const FILE_NAME_VARIABLES: TemplateVariable[] = [
  { name: "process", description: "App of the window covering most of the capture" },
  { name: "windowTitle", description: "Title of that window" },
  ...DATE_VARIABLES,
  { name: "millisecond", description: "Millisecond, 000 to 999" },
  { name: "width", description: "Capture width in pixels" },
  { name: "height", description: "Capture height in pixels" },
  { name: "random", description: "Random letters and digits, 8 by default", argument: { min: 1, max: 32, default: 10 } },
  { name: "guid", description: "A random GUID" },
];

export const UPLOADER_VARIABLES: TemplateVariable[] = [
  { name: "filename", description: "Name of the uploaded file" },
  { name: "timestamp", description: "Upload time in Unix milliseconds" },
];
