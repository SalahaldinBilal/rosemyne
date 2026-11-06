import styles from "./Toasts.module.scss";
import { For, Show } from "solid-js";
import useToastState, { Toast, ToastVariant } from "@core/states/toastState";
import { CircleAlert, CircleCheck, Info, X } from "lucide-solid";

const ICONS: Record<ToastVariant, typeof Info> = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
};

function ToastItem(props: { toast: Toast, onDismiss: () => void }) {
  const Icon = ICONS[props.toast.variant];

  return (
    <div
      class={styles.Toast}
      classList={{
        [styles.Success]: props.toast.variant === "success",
        [styles.Error]: props.toast.variant === "error",
        [styles.Leaving]: props.toast.leaving,
      }}
    >
      <span class={styles.Icon}><Icon size={14} /></span>
      <span class={styles.Message}>{props.toast.message}</span>
      <button type="button" class={styles.Close} aria-label="Dismiss" onClick={() => props.onDismiss()}>
        <X size={14} />
      </button>
      <Show when={props.toast.durationMs > 0 && `${props.toast.restarts}`} keyed>
        {_restart => <span class={styles.Life} style={{ "animation-duration": `${props.toast.durationMs}ms` }} data-keep-motion />}
      </Show>
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useToastState;

  return (
    <div class={styles.ToastContainer} role="status" aria-live="polite">
      <For each={toasts}>
        {toast => <ToastItem toast={toast} onDismiss={() => dismissToast(toast.id)} />}
      </For>
    </div>
  );
}

export default Toasts;
