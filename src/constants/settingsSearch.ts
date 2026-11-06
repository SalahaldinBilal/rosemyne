// What the settings search can find. Only the open page is ever mounted, so this mirrors the pages by hand:
// keep `label` identical to the row's label (or group title) there, it's how a result finds its row to scroll to.
export type SettingsSearchEntry = {
  page: string,
  group?: string,
  label: string,
  hint?: string,
  // Extra words people might search for that the label and hint don't contain.
  keywords?: string,
  // Page results open the page itself instead of scrolling to a row.
  isPage?: boolean,
};

export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  { page: "general", isPage: true, label: "General", hint: "Capture behavior, files and startup." },
  { page: "general", group: "Capture", label: "Copy screenshots to the clipboard", hint: "Every saved screenshot is also put on the clipboard." },
  { page: "general", group: "Capture", label: "Include the mouse cursor", hint: "Adds the cursor as an overlay you can move, resize or delete before saving." },
  { page: "general", group: "Capture", label: "Trim the window border when snapping", hint: "Windows 11 draws a 1px border blended with what's behind a window. Turn off to keep it." },
  { page: "general", group: "Capture", label: "Minimum selection size", hint: "Smaller drags count as a click and capture the window under the cursor. 0 keeps every drawn region." },
  { page: "general", group: "Recording", label: "Record system audio", hint: "Recordings include what you hear. Applies when a recording starts.", keywords: "sound microphone" },
  { page: "general", group: "Recording", label: "Video codec", hint: "Only codecs your GPU can start are listed.", keywords: "h264 hevc av1 encoder" },
  { page: "general", group: "Recording", label: "Frame rate", hint: "1 to 240 fps.", keywords: "fps" },
  { page: "general", group: "Files", label: "Screenshot format", hint: "Default WebP.", keywords: "png jpg jpeg webp" },
  { page: "general", group: "Files", label: "Save directory", hint: "Where captures, history and settings live. Existing files are not moved.", keywords: "folder location path" },
  { page: "general", group: "Files", label: "Save path template", hint: "Sub-folder under files/. Type $ for variables.", keywords: "folder" },
  { page: "general", group: "Files", label: "File name template", hint: "The extension is added for you. Type $ for variables.", keywords: "filename" },
  { page: "general", group: "History", label: "Show whole images on cards", hint: "Shrinks each image to fit its card, with bars around it, instead of cropping it to fill the card.", keywords: "thumbnail fit crop" },
  { page: "general", group: "Startup", label: "Start with Windows", hint: "Launch Rosemyne in the tray when you log in.", keywords: "autostart boot" },
  { page: "general", group: "Startup", label: "Check for updates on startup", hint: "You get a notification when a new version is out." },
  { page: "general", group: "Context menu", label: "Upload from the right-click menu", hint: "Adds Upload image, Upload video and Upload file to your file manager.", keywords: "explorer context menu" },
  { page: "general", group: "Context menu", label: "Show in the Windows 11 menu", hint: "Adds it to Explorer's main right-click menu. Needs Developer Mode and uses windows11-context-rs." },

  { page: "shortcuts", isPage: true, label: "Shortcuts", hint: "Global keys that work from any app.", keywords: "hotkeys keybinds" },
  { page: "shortcuts", group: "Capture", label: "Take screenshot", keywords: "hotkey keybind" },
  { page: "shortcuts", group: "Capture", label: "Start or stop recording", hint: "Opens the region picker when idle, stops and saves while recording.", keywords: "hotkey keybind video" },
  { page: "shortcuts", group: "Capture", label: "Scrolling capture", hint: "Scrolls and captures the selection, then opens the result.", keywords: "hotkey keybind" },
  { page: "shortcuts", label: "Instant captures", hint: "Capture a whole monitor or a fixed region with one key, no editor opens.", keywords: "hotkey monitor region" },

  { page: "uploaders", isPage: true, label: "Uploaders", hint: "Where captures go when you upload them." },
  { page: "uploaders", label: "Saved uploaders", hint: "Add, edit and test uploaders, pick the default one and turn on auto upload.", keywords: "sharex sxcu host link default auto upload" },

  { page: "sounds", isPage: true, label: "Sounds", hint: "What plays after a capture or a task." },
  { page: "sounds", group: "Sounds", label: "Screenshot captured", hint: "Plays right after a screenshot is saved to history. Can also play for instant captures.", keywords: "volume audio" },
  { page: "sounds", group: "Sounds", label: "Task finished successfully", hint: "Plays when a background task completes, like an instant capture's auto upload.", keywords: "volume audio" },

  { page: "overlay-defaults", isPage: true, label: "Overlay defaults", hint: "Starting values for newly drawn boxes, text and effects. Items you already placed keep their own.", keywords: "box text blur pixelate arrow line color font" },
  { page: "overlay-defaults", group: "Image library", label: "Cursor placed on a capture", hint: "Used when Include the mouse cursor is on, under General." },
  { page: "overlay-defaults", label: "Image library", hint: "Images the Image tool can stamp onto a capture. They're copied in as WebP.", keywords: "stamp sticker" },

  { page: "capture-preview", isPage: true, label: "Capture preview", hint: "A small popup with the capture after it's saved, or after the upload if auto upload is on.", keywords: "popup notification" },
  { page: "capture-preview", group: "Popup", label: "Show a capture preview", keywords: "popup" },
  { page: "capture-preview", group: "Position", label: "Monitor", keywords: "screen display" },
  { page: "capture-preview", group: "Position", label: "Corner", hint: "Click a corner of the screen." },
  { page: "capture-preview", group: "Position", label: "Margin from the edge", hint: "Horizontal and vertical." },
  { page: "capture-preview", group: "Position", label: "Maximum size", hint: "Shrinks to fit and keeps the aspect ratio." },
  { page: "capture-preview", group: "Behavior", label: "Close after", hint: "How long the preview stays, or Never.", keywords: "dismiss timeout" },
  { page: "capture-preview", group: "Behavior", label: "Show the countdown", hint: "A thin line along the bottom shrinks until it closes." },
  { page: "capture-preview", group: "Behavior", label: "Left click", hint: "What clicking the preview does.", keywords: "open copy folder link" },
  { page: "capture-preview", group: "Behavior", label: "Right click", hint: "What right-clicking the preview does.", keywords: "open copy folder link" },

  { page: "scrolling-capture", isPage: true, label: "Scrolling capture", hint: "Defaults for scrolling captures. The selection panel can change them for one capture.", keywords: "long page stitch" },
  { page: "scrolling-capture", group: "Capture", label: "Delay between frames", hint: "How long to wait after each scroll for the page to redraw." },
  { page: "scrolling-capture", group: "Capture", label: "Scroll amount", hint: "How far one step tries to scroll. Percent follows the selection's height." },
  { page: "scrolling-capture", group: "Capture", label: "Maximum frames", hint: "A safety cap. Capturing normally stops once scrolling stops changing the content." },

  { page: "sharex", isPage: true, label: "ShareX import", hint: "Bring your ShareX history over. Files are copied, your ShareX folder isn't touched.", keywords: "migrate" },
  { page: "sharex", group: "Source", label: "ShareX folder", hint: "Close ShareX before importing.", keywords: "migrate history" },

  { page: "updates", isPage: true, label: "Updates", hint: "Check for new versions and install them.", keywords: "changelog" },
  { page: "updates", group: "Version", label: "Current version", hint: "Check for updates and read the full changelog.", keywords: "changelog release notes" },
];
