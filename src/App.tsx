import { JSX } from "solid-js";
import "./App.scss";
import Toasts from "@core/components/Toasts/Toasts";

function App(props: { children?: JSX.Element }) {
  return <>
    {props.children}
    <Toasts />
  </>;
}

export default App;
