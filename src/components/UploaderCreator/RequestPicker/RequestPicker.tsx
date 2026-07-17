import styles from "./RequestPicker.module.scss";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { SelectItem, UploaderMethod } from "../../../types";
import Input from "@core/components/Input/Input";
import Select from "@core/components/Select/Select";

const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "Custom"] as const;
const selectItems = methods.map(method => ({ id: method, value: method, label: method }));

function RequestPicker(props: { url: string, method: UploaderMethod, onUrlChange: (url: string) => any, onMethodChange: (method: UploaderMethod) => any }) {
  const [isCustomMethod, setIsCustomerMethod] = createSignal(false);
  const methodColor = createMemo(() => {
    switch (props.method) {
      case "GET":
        return 'var(--success-color)'
      case "PATCH":
        return 'var(--warning-color)'
      case "POST":
        return 'var(--method-post-color)'
      case "DELETE":
        return 'var(--danger-color)'
      case "PUT":
        return 'var(--method-put-color)'
    }
  })

  onMount(() => {
    if (!methods.includes(props.method as any)) setIsCustomerMethod(true)
  })

  function methodHandler(method: SelectItem<(typeof methods)[number]>) {
    if (method.value === "Custom") {
      props.onMethodChange("");
      setIsCustomerMethod(true);
      return;
    }

    setIsCustomerMethod(false);
    props.onMethodChange(method.value)
  }

  return (
    <div class={styles.RequestPickerContainer}>
      <Input
        beforeInput={
          <>
            <Select
              borderless
              noRadius
              style={{ 'border-right': '1px solid var(--control-border)', 'min-width': '95px', 'max-width': '95px' }}
              color={methodColor()}
              value={isCustomMethod() ? "Custom" : props.method}
              items={selectItems}
              onItemClick={methodHandler}
            />
            <Show when={isCustomMethod()}>
              <Input
                borderless
                noRadius
                style={{ 'border-right': '1px solid var(--control-border)' }}
                value={props.method}
                placeholder="GET"
                onChange={e => props.onMethodChange(e.currentTarget.value)}
              />
            </Show>
          </>
        }
        style={{ 'flex-grow': 1 }}
        value={props.url}
        placeholder="https://www.google.com"
        onChange={e => props.onUrlChange(e.currentTarget.value)}
      />
    </div>
  );
}

export default RequestPicker;