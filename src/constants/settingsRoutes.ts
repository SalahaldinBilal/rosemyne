import { CloudUpload, Import, PictureInPicture2, Puzzle, RefreshCw, ScrollText, Settings2, Shapes, SquareSlash, Volume2 } from "lucide-solid";

export const SETTINGS_ROUTES = [
  { path: "general", title: "General", icon: Settings2 },
  { path: "shortcuts", title: "Shortcuts", icon: SquareSlash },
  { path: "uploaders", title: "Uploaders", icon: CloudUpload },
  { path: "sounds", title: "Sounds", icon: Volume2 },
  { path: "overlay-defaults", title: "Overlay defaults", icon: Shapes },
  { path: "capture-preview", title: "Capture preview", icon: PictureInPicture2 },
  { path: "scrolling-capture", title: "Scrolling capture", icon: ScrollText },
  { path: "plugins", title: "Plugins", icon: Puzzle },
  { path: "sharex", title: "ShareX import", icon: Import },
  { path: "updates", title: "Updates", icon: RefreshCw },
];
