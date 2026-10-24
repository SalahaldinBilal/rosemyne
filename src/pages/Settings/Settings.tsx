import { createMemo, For, JSX } from "solid-js";
import styles from "./Settings.module.scss";
import { ArrowLeft } from "lucide-solid";
import { useLocation, useNavigate } from "@solidjs/router";
import SideNavItem from "@core/components/SideNav/SideNavItem";
import { SETTINGS_ROUTES } from "@core/constants/settingsRoutes";

function Settings(props: { children?: JSX.Element }) {
  const location = useLocation();
  const page = createMemo(() => location.pathname.split("/")[2]);
  const navigate = useNavigate();

  return <div class={styles.Main}>
    <div class={styles.SideBar}>
      <SideNavItem icon={<ArrowLeft />} onClick={() => navigate('/')}>
        Back to app
      </SideNavItem>
      <div class={styles.Separator} />
      <For each={SETTINGS_ROUTES}>
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
      <div class={styles.Body}>
        {props.children}
      </div>
    </div>
  </div>
}

export default Settings;
