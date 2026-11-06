import { createEffect, createSignal, on } from "solid-js";

export type NumberInputOptions = {
  value: number | null;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  allowEmpty?: boolean;
  onChange: (value: number) => void;
  onEmpty?: () => void;
};

const COMPLETE_NUMBER = /^-?\d*\.?\d+$/;
const PARTIAL_NUMBER = /^-?$|^-?\d+\.$/;

export function formatNumber(value: number, decimals: number): string {
  return decimals > 0 ? String(+value.toFixed(decimals)) : String(Math.round(value));
}

export function rangeMessage(min: number, max: number): string {
  if (max === Infinity) return `At least ${min}`;
  if (min === -Infinity) return `At most ${max}`;
  return `Between ${min} and ${max}`;
}

export function stepMultiplier(event: { shiftKey: boolean, altKey: boolean }): number {
  if (event.shiftKey) return 10;
  if (event.altKey) return 0.1;
  return 1;
}

// Only ever commits a valid, in-range value. Bad text stays local until it's fixed or the field is left.
export function createNumberInput(options: () => NumberInputOptions, onClamp: () => void) {
  const min = () => options().min ?? 0;
  const max = () => options().max ?? Infinity;
  const decimals = () => options().decimals ?? 0;
  const display = (value: number | null) => value === null ? "" : formatNumber(value, decimals());

  const [text, setText] = createSignal(display(options().value));
  const [focused, setFocused] = createSignal(false);

  const isBad = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "" || PARTIAL_NUMBER.test(trimmed)) return false;
    if (!COMPLETE_NUMBER.test(trimmed)) return true;
    const value = parseFloat(trimmed);
    return value < min() || value > max();
  };
  const [bad, setBad] = createSignal(false);

  createEffect(on(() => options().value, value => {
    if (focused() && parseFloat(text()) === value) return;
    setText(display(value));
    setBad(false);
  }, { defer: true }));

  function commit(value: number) {
    const clamped = Math.min(max(), Math.max(min(), value));
    if (clamped !== value) onClamp();

    const rounded = parseFloat(formatNumber(clamped, decimals()));
    setText(formatNumber(rounded, decimals()));
    setBad(false);
    if (rounded !== options().value) options().onChange(rounded);
  }

  function revert() {
    setText(display(options().value));
    setBad(false);
  }

  function step(direction: number, multiplier: number) {
    const current = parseFloat(text());
    const base = Number.isFinite(current) ? current : (options().value ?? 0);
    commit(base + direction * (options().step ?? 1) * multiplier);
  }

  function onInput(raw: string) {
    setText(raw);
    const trimmed = raw.trim();
    const nowBad = isBad(trimmed);
    setBad(nowBad);
    if (nowBad || PARTIAL_NUMBER.test(trimmed)) return;

    if (trimmed === "") {
      if (options().allowEmpty) options().onEmpty?.();
      return;
    }

    const value = parseFloat(formatNumber(parseFloat(trimmed), decimals()));
    if (value !== options().value) options().onChange(value);
  }

  function onBlur() {
    setFocused(false);
    const trimmed = text().trim();

    if (trimmed === "") {
      if (!options().allowEmpty) revert();
      return;
    }

    const value = parseFloat(trimmed);
    if (Number.isFinite(value) && /^-?\d*\.?\d*$/.test(trimmed)) commit(value);
    else revert();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      step(event.key === "ArrowUp" ? 1 : -1, stepMultiplier(event));
      return;
    }

    if (event.key === "Enter") {
      (event.currentTarget as HTMLInputElement).blur();
      return;
    }

    if (event.key.length !== 1 || event.ctrlKey || event.metaKey) return;

    const allowed = /\d/.test(event.key)
      || (event.key === "." && decimals() > 0)
      || (event.key === "-" && min() < 0);
    if (!allowed) event.preventDefault();
  }

  function onPaste(event: ClipboardEvent) {
    const pasted = event.clipboardData?.getData("text").trim() ?? "";
    const fits = COMPLETE_NUMBER.test(pasted) && (decimals() > 0 || !pasted.includes("."));
    if (!fits) event.preventDefault();
  }

  function onFocus(event: FocusEvent) {
    setFocused(true);
    const input = event.currentTarget as HTMLInputElement;
    setTimeout(() => input.select(), 0);
  }

  return { text, bad, step, onInput, onBlur, onKeyDown, onPaste, onFocus, rangeMessage: () => rangeMessage(min(), max()) };
}

export function flashLimit(element: HTMLElement | undefined, className: string) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}
