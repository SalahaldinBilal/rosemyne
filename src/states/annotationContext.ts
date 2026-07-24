import { createContext, useContext } from "solid-js";
import { AnnotationState } from "./annotationState";

// Lets the shared annotation components mount under either window's own independent state instance.
const AnnotationContext = createContext<AnnotationState>();

export function useAnnotationState(): AnnotationState {
  const state = useContext(AnnotationContext);
  if (!state) throw new Error("useAnnotationState must be used within an AnnotationContext.Provider");
  return state;
}

export default AnnotationContext;
