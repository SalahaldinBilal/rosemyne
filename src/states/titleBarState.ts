import { createRoot, createSignal } from "solid-js";

// Extra crumb parts a page pushes below its route's own title, like the uploader being edited.
function useTitleBarStateInner() {
  const [crumbTail, setCrumbTail] = createSignal<string[]>([]);
  return { crumbTail, setCrumbTail };
}

const useTitleBarState = createRoot(useTitleBarStateInner);
export default useTitleBarState;
