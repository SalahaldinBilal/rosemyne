import { onMount } from "solid-js";

// Click-through, capture-excluded window inflated by the border width around
// the recorded region , the stroke sits entirely outside the recorded pixels.
function RecordingBorder() {
  onMount(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  });

  return <div style={{
    position: "fixed",
    inset: "0",
    border: "3px solid #e5484d",
    "box-sizing": "border-box",
    "pointer-events": "none",
  }} />;
}

export default RecordingBorder;
