import { JSX, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.scss";
import Toasts from "@core/components/Toasts/Toasts";
import TitleBar from "@core/components/TitleBar/TitleBar";

const TITLE_BAR_WINDOWS = ["main", "scroll-capture-result"];
const HAS_TITLE_BAR = TITLE_BAR_WINDOWS.includes(getCurrentWindow().label);

if (HAS_TITLE_BAR) document.documentElement.classList.add("HasTitleBar");

function App(props: { children?: JSX.Element }) {
  return <>
    <Show when={HAS_TITLE_BAR} fallback={props.children}>
      <div class="AppFrame">
        <TitleBar />
        <div class="AppContent">{props.children}</div>
      </div>
    </Show>
    <Toasts />
  </>;
}

export default App;
