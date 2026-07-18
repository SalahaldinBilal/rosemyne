import { createMemo, For, JSX } from "solid-js";
import styles from "./Settings.module.scss";
import { ArrowLeft, CloudUpload, Import, PictureInPicture2, RefreshCw, Settings2, Shapes, SquareSlash, Volume2 } from "lucide-solid";
import { useLocation, useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import SideNavItem from "@core/components/SideNav/SideNavItem";

const routes = [
  { path: "general", title: "General", icon: Settings2 },
  { path: "shortcuts", title: "Shortcuts", icon: SquareSlash },
  { path: "uploaders", title: "Uploaders", icon: CloudUpload },
  { path: "sounds", title: "Sounds", icon: Volume2 },
  { path: "overlay-defaults", title: "Overlay Defaults", icon: Shapes },
  { path: "capture-preview", title: "Capture Preview", icon: PictureInPicture2 },
  { path: "sharex", title: "ShareX import", icon: Import },
  { path: "updates", title: "Updates", icon: RefreshCw },
]

function Settings(props: { children?: JSX.Element }) {
  const location = useLocation();
  const page = createMemo(() => location.pathname.split("/")[2]);
  const currentTab = createMemo(() => routes.find(e => e.path === page()))
  const navigate = useNavigate();

  return <div class={styles.Main}>
    <div class={styles.SideBar}>
      <SideNavItem icon={<ArrowLeft />} onClick={() => navigate('/')}>
        Back to app
      </SideNavItem>
      <div class={styles.Separator} />
      <For each={routes}>
        {route => <SideNavItem
          icon={<route.icon />}
          active={page() === route.path}
          onClick={() => navigate(`/settings/${route.path}`)}
        >
          {route.title}
        </SideNavItem>}
      </For>
    </div>
    <div class={styles.Content}>
      <div class={styles.Title}>
        <div class={styles.Icon}>
          <Dynamic component={currentTab()?.icon} width={22} height={22} />
        </div>
        {currentTab()?.title}
      </div>
      <div class={styles.Body}>
        {props.children}
      </div>
    </div>
  </div>
}

export default Settings;
