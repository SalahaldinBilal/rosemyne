import { createRoot } from "solid-js";
import { createStore, produce } from "solid-js/store";

export type ToastVariant = "info" | "success" | "error";
export type Toast = { id: number, message: string, variant: ToastVariant };

function useToastStateInner() {
  const [toasts, setToasts] = createStore<Array<Toast>>([]);
  let nextId = 0;

  function pushToast(message: string, variant: ToastVariant = "info", durationMs = 4000) {
    const id = nextId++;
    setToasts(produce(toasts => toasts.push({ id, message, variant })));

    if (durationMs > 0) {
      setTimeout(() => dismissToast(id), durationMs);
    }
  }

  function dismissToast(id: number) {
    setToasts(toasts => toasts.filter(toast => toast.id !== id));
  }

  return { toasts, pushToast, dismissToast };
}

const useToastState = createRoot(useToastStateInner);
export default useToastState;
