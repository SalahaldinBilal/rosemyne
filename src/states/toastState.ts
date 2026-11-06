import { createRoot } from "solid-js";
import { createStore, produce } from "solid-js/store";

export type ToastVariant = "info" | "success" | "error";
export type Toast = {
  id: number,
  message: string,
  variant: ToastVariant,
  durationMs: number,
  restarts: number,
  leaving: boolean,
};

const MAX_TOASTS = 3;
const EXIT_MS = 180;

function useToastStateInner() {
  const [toasts, setToasts] = createStore<Array<Toast>>([]);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextId = 0;

  function schedule(id: number, durationMs: number) {
    clearTimeout(timers.get(id));
    if (durationMs > 0) timers.set(id, setTimeout(() => dismissToast(id), durationMs));
  }

  function pushToast(message: string, variant: ToastVariant = "info", durationMs = 4000) {
    const existing = toasts.find(toast => !toast.leaving && toast.message === message && toast.variant === variant);
    if (existing) {
      setToasts(toast => toast.id === existing.id, produce(toast => {
        toast.restarts++;
        toast.durationMs = durationMs;
      }));
      schedule(existing.id, durationMs);
      return;
    }

    const visible = toasts.filter(toast => !toast.leaving);
    visible.slice(0, Math.max(0, visible.length - MAX_TOASTS + 1)).forEach(toast => dismissToast(toast.id));

    const id = nextId++;
    setToasts(produce(list => list.push({ id, message, variant, durationMs, restarts: 0, leaving: false })));
    schedule(id, durationMs);
  }

  function dismissToast(id: number) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    setToasts(toast => toast.id === id, "leaving", true);
    setTimeout(() => setToasts(list => list.filter(toast => toast.id !== id)), EXIT_MS);
  }

  return { toasts, pushToast, dismissToast };
}

const useToastState = createRoot(useToastStateInner);
export default useToastState;
