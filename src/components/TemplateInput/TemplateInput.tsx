import styles from "./TemplateInput.module.scss";
import { createEffect, createMemo, createSignal, For, JSX, on, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { TemplateVariable } from "../../constants/templateVariables";
import { tokenizeTemplate, variableQueryAt } from "./templateTokens";

const MENU_GAP = 6;
const MENU_WIDTH = 320;
const CLOSE_DURATION = 110;

type Suggestions = { start: number, query: string, items: TemplateVariable[], left: number, top: number, bottom: number };

function TemplateInput(props: {
  value: string,
  onChange: (value: string) => void,
  variables: readonly TemplateVariable[],
  multiline?: boolean,
  placeholder?: string,
  invalid?: boolean,
  disabled?: boolean,
  class?: string,
  style?: JSX.CSSProperties,
  onBlur?: () => void,
  onKeyDown?: (event: KeyboardEvent) => void,
}) {
  const [suggestions, setSuggestions] = createSignal<Suggestions | null>(null);
  const [mounted, setMounted] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);
  const [scroll, setScroll] = createSignal({ left: 0, top: 0 });
  const segments = createMemo(() => tokenizeTemplate(props.value, props.variables));
  const hasBad = createMemo(() => segments().some(segment => segment.kind === "bad"));
  const className = createMemo(() => [styles.Field, props.class].filter(Boolean).join(" "));

  let field: HTMLInputElement | HTMLTextAreaElement | undefined;
  let layer: HTMLDivElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function growToContent() {
    if (!props.multiline || !field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }

  onMount(growToContent);
  createEffect(on(() => props.value, () => queueMicrotask(growToContent), { defer: true }));

  // A hidden copy of the layer up to the caret, so the list can open right where the caret is.
  function caretPoint(index: number): { left: number, top: number, bottom: number } {
    const fieldRect = field!.getBoundingClientRect();
    if (!layer) return { left: fieldRect.left, top: fieldRect.top, bottom: fieldRect.bottom };

    const mirror = layer.cloneNode(false) as HTMLDivElement;
    mirror.style.visibility = "hidden";
    mirror.textContent = props.value.slice(0, index);
    const marker = document.createElement("span");
    marker.textContent = "​";
    mirror.appendChild(marker);
    layer.parentElement!.appendChild(mirror);

    // The copy keeps the layer's scroll transform, so this rect is already where the caret shows.
    const markerRect = marker.getBoundingClientRect();
    mirror.remove();

    const left = Math.min(markerRect.left, window.innerWidth - MENU_WIDTH - 8);
    return props.multiline
      ? { left, top: markerRect.top, bottom: markerRect.bottom }
      : { left, top: fieldRect.top, bottom: fieldRect.bottom };
  }

  function refreshSuggestions(force = false) {
    if (!field) return;
    const caret = field.selectionStart ?? props.value.length;
    const match = variableQueryAt(props.value, caret);

    if (!match && !force) return closeSuggestions();

    const start = match?.start ?? caret;
    const query = (match?.query ?? "").toLowerCase();
    const items = props.variables.filter(variable => variable.name.toLowerCase().includes(query));
    if (items.length === 0) return closeSuggestions();

    clearTimeout(closeTimer);
    const point = caretPoint(start);
    setSuggestions({ start, query, items, ...point });
    setHighlight(current => Math.min(current, items.length - 1));
    setMounted(true);
  }

  function closeSuggestions() {
    if (!suggestions()) return;
    setSuggestions(null);
    setHighlight(0);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setMounted(false), CLOSE_DURATION);
  }

  onCleanup(() => clearTimeout(closeTimer));

  function insert(variable: TemplateVariable) {
    const current = suggestions();
    if (!field || !current) return;

    const caret = field.selectionStart ?? props.value.length;
    const after = props.value.slice(caret);
    const closingBrace = /^[A-Za-z]*\}/.exec(after)?.[0].length ?? 0;
    const argument = variable.argument ? `:${variable.argument.default}` : "";
    const token = `\${${variable.name}${argument}}`;
    const next = props.value.slice(0, current.start) + token + after.slice(closingBrace);

    props.onChange(next);
    closeSuggestions();

    const selectFrom = variable.argument
      ? current.start + 2 + variable.name.length + 1
      : current.start + token.length;
    const selectTo = variable.argument ? selectFrom + String(variable.argument.default).length : selectFrom;
    queueMicrotask(() => {
      field?.focus();
      field?.setSelectionRange(selectFrom, selectTo);
    });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === " " && event.ctrlKey) {
      event.preventDefault();
      refreshSuggestions(true);
      return;
    }

    const open = suggestions();
    if (open) {
      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp":
          event.preventDefault();
          setHighlight(index => (index + (event.key === "ArrowDown" ? 1 : -1) + open.items.length) % open.items.length);
          return;
        case "Enter":
        case "Tab":
          event.preventDefault();
          insert(open.items[highlight()]);
          return;
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          closeSuggestions();
          return;
      }
    }

    props.onKeyDown?.(event);
  }

  function onInput(value: string) {
    props.onChange(value);
    queueMicrotask(() => refreshSuggestions());
  }

  function onScroll() {
    if (!field) return;
    setScroll({ left: field.scrollLeft, top: field.scrollTop });
  }

  createEffect(() => {
    if (!suggestions()) return;
    const close = () => closeSuggestions();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, { capture: true });
    onCleanup(() => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, { capture: true });
    });
  });

  const menuStyle = createMemo<JSX.CSSProperties>(() => {
    const open = suggestions();
    if (!open) return {};
    const below = open.bottom + MENU_GAP;
    const fitsBelow = below + 280 < window.innerHeight;
    return {
      left: `${Math.max(8, open.left)}px`,
      ...(fitsBelow ? { top: `${below}px` } : { bottom: `${window.innerHeight - open.top + MENU_GAP}px` }),
    };
  });

  const fieldProps = {
    class: styles.Control,
    spellcheck: false,
    autocomplete: "off",
  } as const;

  return (
    <div
      class={className()}
      classList={{
        [styles.Multiline]: props.multiline ?? false,
        [styles.Invalid]: (props.invalid ?? false) || hasBad(),
        [styles.Disabled]: props.disabled ?? false,
      }}
      style={props.style}
    >
      <div
        ref={layer}
        class={styles.Layer}
        aria-hidden="true"
        style={{ transform: `translate(${-scroll().left}px, ${-scroll().top}px)` }}
      >
        <For each={segments()}>{segment => (
          <span classList={{ [styles.Variable]: segment.kind === "variable", [styles.Bad]: segment.kind === "bad" }}>
            {segment.text}
          </span>
        )}</For>
        {props.multiline ? "\n" : ""}
      </div>
      <Show
        when={props.multiline}
        fallback={
          <input
            {...fieldProps}
            ref={element => field = element}
            value={props.value}
            placeholder={props.placeholder}
            disabled={props.disabled}
            onInput={event => onInput(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            onScroll={onScroll}
            onSelect={onScroll}
            onBlur={() => { closeSuggestions(); props.onBlur?.(); }}
          />
        }
      >
        <textarea
          {...fieldProps}
          ref={element => field = element}
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          rows={4}
          onInput={event => { onInput(event.currentTarget.value); growToContent(); }}
          onKeyDown={onKeyDown}
          onScroll={onScroll}
          onBlur={() => { closeSuggestions(); props.onBlur?.(); }}
        />
      </Show>

      <Show when={mounted()}>
        <Portal>
          <div
            class={styles.Suggestions}
            classList={{ [styles.Closing]: !suggestions() }}
            style={menuStyle()}
            onMouseDown={event => event.preventDefault()}
          >
            <For each={suggestions()?.items ?? []}>{(variable, index) => (
              <button
                type="button"
                class={styles.Suggestion}
                classList={{ [styles.Active]: index() === highlight() }}
                onMouseEnter={() => setHighlight(index())}
                onClick={() => insert(variable)}
              >
                <code>{`\${${variable.name}${variable.argument ? ":N" : ""}}`}</code>
                <span>{variable.description}</span>
              </button>
            )}</For>
            <div class={styles.Footer}>
              <span>↑↓ to pick</span>
              <span>Tab or Enter to insert</span>
              <span>Esc to close</span>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

export default TemplateInput;
