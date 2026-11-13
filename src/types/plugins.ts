export type PluginPermissions = {
  capturesRead: boolean,
  capturesEdit: boolean,
  tagsRead: boolean,
  tagsWrite: boolean,
  clipboardWrite: boolean,
  toast: boolean,
  network: string[],
}

export type PluginPermissionName = Exclude<keyof PluginPermissions, "network">;

export type PluginCardAction = {
  id: string,
  label: string,
  types: Array<"image" | "video" | "file">,
}

export type PluginManifest = {
  apiVersion: number,
  id: string,
  name: string,
  version: string,
  author: string | null,
  description: string | null,
  homepage: string | null,
  minAppVersion: string | null,
  tagKey: string | null,
  permissions: PluginPermissions,
  hooks: string[],
  uploaders: Array<{ id: string, name: string }>,
  cardActions: PluginCardAction[],
  settings: PluginNode[],
}

export type PluginStatus = "ok" | "disabled" | "paused" | "error" | "changedOnDisk" | "unusable";

export type PluginInfo = {
  manifest: PluginManifest,
  enabled: boolean,
  dev: boolean,
  status: PluginStatus,
  problem: string | null,
  lastError: string | null,
  hasIcon: boolean,
}

export type PluginInspection = {
  manifest: PluginManifest,
  wasmSha256: string,
  installedVersion: string | null,
  addedPermissions: PluginPermissionName[],
  addedHosts: string[],
}

export type PluginUploaderInfo = {
  id: string,
  name: string,
  autoUpload: boolean,
  pluginId: string,
  pluginName: string,
  uploaderId: string,
}

export type PluginLogLine = {
  timeMs: number,
  level: "debug" | "info" | "warn" | "error",
  text: string,
}

export type PluginLogEvent = { pluginId: string, line: PluginLogLine };

export type PluginToastEvent = {
  pluginId: string,
  pluginName: string,
  kind: "info" | "success" | "error",
  text: string,
}

// A node of a plugin's view. Props depend on `type`, and unknown types are skipped when rendering.
export type PluginNode = {
  type: string,
  id?: string,
  children?: PluginNode[],
  [prop: string]: unknown,
}

export type PluginUiEvent = {
  id: string,
  type: "change" | "click",
  value?: unknown,
}

export type PluginToast = { kind?: "info" | "success" | "error", text: string };

export type PluginUiResponse = {
  tree?: PluginNode[] | null,
  toast?: PluginToast | null,
  close?: boolean,
  refreshAfterMs?: number | null,
} | null;

export type PluginModalAction = {
  id: string,
  label: string,
  variant?: "primary" | "secondary" | "danger-solid",
}

export type PluginModal = {
  title: string,
  tree: PluginNode[],
  actions?: PluginModalAction[],
}

export type PluginCardActionResponse = {
  modal?: PluginModal | null,
  toast?: PluginToast | null,
} | null;
