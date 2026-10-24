import { CloudUpload, Import, PictureInPicture2, RefreshCw, ScrollText, Settings2, Shapes, SquareSlash, Volume2 } from "lucide-solid";

export const SETTINGS_ROUTES = [
  { path: "general", title: "General", icon: Settings2 },
  { path: "shortcuts", title: "Shortcuts", icon: SquareSlash },
  { path: "uploaders", title: "Uploaders", icon: CloudUpload },
  { path: "sounds", title: "Sounds", icon: Volume2 },
  { path: "overlay-defaults", title: "Overlay Defaults", icon: Shapes },
  { path: "capture-preview", title: "Capture Preview", icon: PictureInPicture2 },
  { path: "scrolling-capture", title: "Scrolling Capture", icon: ScrollText },
  { path: "sharex", title: "ShareX import", icon: Import },
  { path: "updates", title: "Updates", icon: RefreshCw },
];
