/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { Navigate, Route, Router } from "@solidjs/router";
import Main from "./pages/Main/Main";
import Onboarding from "./pages/Onboarding/Onboarding";
import RecordingBorder from "./pages/RecordingBorder/RecordingBorder";
import RecordingHud from "./pages/RecordingHud/RecordingHud";
import Screenshot from "./pages/Screenshot/Screenshot";
import '@fontsource-variable/inter/index.css';
import '@thednp/solid-color-picker/style.css';
import Settings from "./pages/Settings/Settings";
import GeneralSettings from "./pages/Settings/GeneralSettings/GeneralSettings";
import ShortcutSettings from "./pages/Settings/ShortcutSettings/ShortcutSettings";
import UploaderSettings from "./pages/Settings/UploaderSettings/UploaderSettings";
import SoundSettings from "./pages/Settings/SoundSettings/SoundSettings";
import ShareXImport from "./pages/Settings/ShareXImport/ShareXImport";
import UpdateSettings from "./pages/Settings/UpdateSettings/UpdateSettings";
import OverlayDefaultsSettings from "./pages/Settings/OverlayDefaultsSettings/OverlayDefaultsSettings";

render(
  () => <Router root={App}>
    <Route path="/" component={Main} />
    <Route path="/onboarding" component={Onboarding} />
    <Route path="/screenshot" component={Screenshot} />
    <Route path="/recording-hud" component={RecordingHud} />
    <Route path="/recording-border" component={RecordingBorder} />
    <Route path="/settings" component={Settings}>
      <Route path="/" component={() => <Navigate href="/settings/general" />} />
      <Route path="/general" component={GeneralSettings}></Route>
      <Route path="/shortcuts" component={ShortcutSettings}></Route>
      <Route path="/uploaders" component={UploaderSettings}></Route>
      <Route path="/sounds" component={SoundSettings}></Route>
      <Route path="/overlay-defaults" component={OverlayDefaultsSettings}></Route>
      <Route path="/sharex" component={ShareXImport}></Route>
      <Route path="/updates" component={UpdateSettings}></Route>
    </Route>
  </Router>,
  document.getElementById("root") as HTMLElement
);
