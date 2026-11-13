import { definePlugin, host, PluginNode, UiResponse } from "@rosemyne/plugin";

const API = "https://litterbox.catbox.moe/resources/internals/api.php";
const UPLOADS_KEY = "uploads";
const SHARED_LINK_KEY = "shared-link";

function uploadCount(): number {
  return Number(host.kvGetText(UPLOADS_KEY) ?? "0");
}

function settingsTree(): PluginNode[] {
  return [{
    type: "group",
    title: "Activity",
    children: [{
      type: "inline",
      label: "Uploads so far",
      children: [
        { type: "badge", text: String(uploadCount()) },
        { type: "button", id: "reset", label: "Reset" },
      ],
    }],
  }];
}

function copyShared(format: (link: string) => string, what: string): UiResponse {
  const link = host.kvGetText(SHARED_LINK_KEY);
  if (link === null) return { close: true, toast: { kind: "error", text: "The link is gone, open the menu again" } };
  host.clipboardWriteText(format(link));
  return { close: true, toast: { kind: "success", text: `${what} copied` } };
}

export default definePlugin({
  upload({ capture }) {
    const keepFor = host.setting<string>("keepFor");
    if (keepFor === null) throw new Error("The keep-for setting is missing");

    const response = host.http({
      method: "POST",
      url: API,
      body: {
        type: "multipart",
        parts: [
          { name: "reqtype", text: "fileupload" },
          { name: "time", text: keepFor },
          { name: "fileToUpload", captureFile: true, fileName: capture.fileName },
        ],
      },
    });

    const link = response.text().trim();
    if (!response.ok || !link.startsWith("https://")) {
      throw new Error(`Litterbox answered ${response.status}: ${link.slice(0, 200)}`);
    }

    host.kvSet(UPLOADS_KEY, String(uploadCount() + 1));
    return { url: link };
  },

  ui_render() {
    return { tree: settingsTree() };
  },

  ui_event({ view, id }) {
    if (view === "settings" && id === "reset") {
      host.kvDelete(UPLOADS_KEY);
      return { tree: settingsTree() };
    }
    if (view === "modal:share" && id === "markdown") return copyShared(link => `![](${link})`, "Markdown");
    if (view === "modal:share" && id === "bbcode") return copyShared(link => `[img]${link}[/img]`, "BBCode");
    return {};
  },

  card_action({ capture }) {
    if (!capture.url) return { toast: { kind: "info", text: "Upload this capture first" } };

    // Modal events carry no capture, so the link waits here for the button click.
    host.kvSet(SHARED_LINK_KEY, capture.url);
    return {
      modal: {
        title: "Share link",
        tree: [{
          type: "group",
          children: [
            { type: "label", text: capture.url },
            { type: "label", tone: "muted", text: "Litterbox deletes the file when its time is up." },
          ],
        }],
        actions: [
          { id: "bbcode", label: "Copy as BBCode" },
          { id: "markdown", label: "Copy as Markdown", variant: "primary" },
        ],
      },
    };
  },
});
