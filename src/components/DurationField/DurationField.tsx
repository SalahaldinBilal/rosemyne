import styles from "../NumberField/NumberField.module.scss";
import durationStyles from "./DurationField.module.scss";
import { createEffect, createMemo, createSignal, For, on } from "solid-js";
import { flashLimit } from "../NumberField/numberInput";

export type DurationPart = "h" | "m" | "s" | "ms";

const PART_MS: Record<DurationPart, number> = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };

function splitDuration(ms: number, parts: readonly DurationPart[]): string[] {
  let rest = Math.max(0, Math.round(ms));
  return parts.map((part, index) => {
    const value = Math.floor(rest / PART_MS[part]);
    rest -= value * PART_MS[part];
    return index === 0 ? String(value) : String(value).padStart(part === "ms" ? 3 : 2, "0");
  });
}

function padLength(part: DurationPart): number {
  return part === "ms" ? 3 : 2;
}

// Accepts "1:30", "90s", "1m 30s", "2h" and a bare number in the smallest part.
export function parseDuration(text: string, parts: readonly DurationPart[]): number | null {
  const trimmed = text.trim().toLowerCase();
  const smallest = parts[parts.length - 1];

  if (/^\d+(:\d+)+$/.test(trimmed)) {
    const numbers = trimmed.split(":").map(Number);
    const units = parts.slice(-numbers.length);
    return numbers.reduce((total, value, index) => total + value * PART_MS[units[index] ?? smallest], 0);
  }

  const pattern = /(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g;
  let match: RegExpExecArray | null;
  let total = 0;
  let found = false;
  while ((match = pattern.exec(trimmed))) {
    total += Number(match[1]) * PART_MS[match[2] as DurationPart];
    found = true;
  }
  if (found) return Math.round(total);

  return /^\d+(\.\d+)?$/.test(trimmed) ? Math.round(Number(trimmed) * PART_MS[smallest]) : null;
}

function DurationField(props: {
  valueMs: number,
  onChange: (ms: number) => void,
  parts?: readonly DurationPart[],
  disabled?: boolean,
  size?: "md" | "sm",
}) {
  const parts = createMemo<readonly DurationPart[]>(() => props.parts ?? ["h", "m", "s"]);
  const [texts, setTexts] = createSignal(splitDuration(props.valueMs, parts()));
  const [focused, setFocused] = createSignal(false);
  const inputs: HTMLInputElement[] = [];
  let box: HTMLDivElement | undefined;

  const totalOf = (values: string[]) =>
    values.reduce((total, value, index) => total + (parseInt(value, 10) || 0) * PART_MS[parts()[index]], 0);

  createEffect(on([() => props.valueMs, parts], ([ms]) => {
    if (focused() && totalOf(texts()) === ms) return;
    setTexts(splitDuration(ms, parts()));
  }, { defer: true }));

  function emit(total: number) {
    if (total !== props.valueMs) props.onChange(total);
  }

  function focusPart(index: number) {
    const input = inputs[index];
    if (!input) return;
    input.focus();
    input.select();
  }

  function step(index: number, direction: number, multiplier: number) {
    const next = totalOf(texts()) + direction * PART_MS[parts()[index]] * multiplier;
    if (next < 0) flashLimit(box, styles.Limit);
    const clamped = Math.max(0, next);
    setTexts(splitDuration(clamped, parts()));
    emit(clamped);
    queueMicrotask(() => inputs[index]?.select());
  }

  function onInput(index: number, raw: string, trusted: boolean) {
    const digits = raw.replace(/\D/g, "");
    const next = [...texts()];
    next[index] = digits;
    setTexts(next);
    if (inputs[index] && inputs[index].value !== digits) inputs[index].value = digits;
    emit(totalOf(next));

    if (trusted && index > 0 && digits.length >= padLength(parts()[index]) && index < parts().length - 1) {
      focusPart(index + 1);
    }
  }

  function onKeyDown(index: number, event: KeyboardEvent) {
    const input = event.currentTarget as HTMLInputElement;
    const last = parts().length - 1;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      step(index, event.key === "ArrowUp" ? 1 : -1, event.shiftKey ? 10 : 1);
    } else if (event.key === ":" || event.key === " " || event.key === "ArrowRight" || (event.key === "Tab" && !event.shiftKey && index < last)) {
      event.preventDefault();
      focusPart(index + 1);
    } else if (
      event.key === "ArrowLeft"
      || (event.key === "Backspace" && (input.value === "" || (input.selectionStart === 0 && input.selectionEnd === 0)))
      || (event.key === "Tab" && event.shiftKey && index > 0)
    ) {
      if (index > 0) {
        event.preventDefault();
        focusPart(index - 1);
      }
    } else if (event.key === "Enter") {
      input.blur();
    } else if (event.key.length === 1 && !/\d/.test(event.key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
    }
  }

  function onPaste(event: ClipboardEvent) {
    const ms = parseDuration(event.clipboardData?.getData("text") ?? "", parts());
    if (ms === null) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    setTexts(splitDuration(ms, parts()));
    emit(ms);
  }

  function onFocusOut(event: FocusEvent) {
    if (box?.contains(event.relatedTarget as Node | null)) return;
    setFocused(false);
    setTexts(splitDuration(totalOf(texts()), parts()));
  }

  function onWheel(event: WheelEvent) {
    const index = inputs.indexOf(document.activeElement as HTMLInputElement);
    if (index < 0 || props.disabled) return;
    event.preventDefault();
    step(index, event.deltaY < 0 ? 1 : -1, event.shiftKey ? 10 : 1);
  }

  return (
    <div
      ref={box}
      class={`${styles.NumberField} ${styles.Segments}`}
      classList={{ [styles.Disabled]: props.disabled ?? false, [styles.Small]: props.size === "sm" }}
      onFocusIn={() => setFocused(true)}
      onFocusOut={onFocusOut}
      onWheel={onWheel}
    >
      <For each={parts()}>{(part, index) => (
        <>
          <input
            ref={element => inputs[index()] = element}
            class={durationStyles.Part}
            inputmode="numeric"
            aria-label={part}
            value={texts()[index()] ?? ""}
            style={{ width: `${Math.max(2, (texts()[index()] ?? "").length) + 0.3}ch` }}
            disabled={props.disabled}
            onInput={event => onInput(index(), event.currentTarget.value, event.isTrusted)}
            onKeyDown={event => onKeyDown(index(), event)}
            onPaste={onPaste}
            onFocus={event => {
              const input = event.currentTarget;
              setTimeout(() => input.select(), 0);
            }}
          />
          <span class={durationStyles.Label}>{part}</span>
        </>
      )}</For>
    </div>
  );
}

export default DurationField;
