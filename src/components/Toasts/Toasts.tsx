import styles from "./Toasts.module.scss";
import { For } from "solid-js";
import useToastState from "@core/states/toastState";
import { X } from "lucide-solid";

function Toasts() {
  const { toasts, dismissToast } = useToastState;

  return (
    <div class={styles.ToastContainer} role="status" aria-live="polite">
      <For each={toasts}>
        {toast => (
          <div class={styles.Toast} classList={{ [styles.success]: toast.variant === "success", [styles.error]: toast.variant === "error" }}>
            <span>{toast.message}</span>
            <button class={styles.Close} onClick={() => dismissToast(toast.id)}>
              <X size={14} />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}

export default Toasts;
