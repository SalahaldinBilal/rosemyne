import fieldStyles from "../NumberField/NumberField.module.scss";
import styles from "./DateField.module.scss";
import { createEffect, createMemo, createSignal, For, JSX, on, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-solid";
import Button from "../Button/Button";
import Tooltip from "../Tooltip/Tooltip";
import { systemDateOrder } from "../../helpers/systemDateFormat";

type Part = "d" | "m" | "y" | "hour" | "minute";
type Texts = Record<Part, string>;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MAX_LENGTH: Record<Part, number> = { d: 2, m: 2, y: 4, hour: 2, minute: 2 };
const PLACEHOLDER: Record<Part, string> = { d: "dd", m: "mm", y: "yyyy", hour: "hh", minute: "mm" };
const CALENDAR_MARGIN = 6;
const CLOSE_DURATION = 110;

const pad2 = (value: number) => String(value).padStart(2, "0");
const EMPTY: Texts = { d: "", m: "", y: "", hour: "", minute: "" };

function textsFor(ms: number | null): Texts {
  if (ms === null) return { ...EMPTY };
  const date = new Date(ms);
  return {
    d: pad2(date.getDate()),
    m: pad2(date.getMonth() + 1),
    y: String(date.getFullYear()),
    hour: pad2(date.getHours()),
    minute: pad2(date.getMinutes()),
  };
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function DateField(props: {
  value: number | null,
  onChange: (ms: number) => void,
  onClear?: () => void,
  withTime?: boolean,
  size?: "md" | "sm",
  disabled?: boolean,
}) {
  const parts = createMemo<Part[]>(() => [...systemDateOrder(), ...(props.withTime ? ["hour", "minute"] as Part[] : [])]);
  const [texts, setTexts] = createSignal<Texts>(textsFor(props.value));
  const [focused, setFocused] = createSignal(false);
  const [bad, setBad] = createSignal(false);
  const inputs: Partial<Record<Part, HTMLInputElement>> = {};
  let box: HTMLDivElement | undefined;

  function read(values: Texts): number | null {
    const day = parseInt(values.d, 10);
    const month = parseInt(values.m, 10);
    const year = parseInt(values.y, 10);
    if (!day || !month || !year || year < 1000) return null;

    const hours = props.withTime ? parseInt(values.hour, 10) || 0 : 0;
    const minutes = props.withTime ? parseInt(values.minute, 10) || 0 : 0;
    if (hours > 23 || minutes > 59) return null;

    const date = new Date(year, month - 1, day, hours, minutes);
    if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date.getTime();
  }

  createEffect(on(() => props.value, value => {
    if (focused() && read(texts()) === value) return;
    setTexts(textsFor(value));
    setBad(false);
  }, { defer: true }));

  function emit(ms: number) {
    setBad(false);
    if (ms !== props.value) props.onChange(ms);
  }

  function write(ms: number) {
    setTexts(textsFor(ms));
    emit(ms);
  }

  function focusPart(part: Part | undefined) {
    if (!part) return;
    const input = inputs[part];
    input?.focus();
    input?.select();
  }

  function neighbour(part: Part, offset: number): Part | undefined {
    return parts()[parts().indexOf(part) + offset];
  }

  function step(part: Part, direction: number) {
    const current = read(texts());
    const date = current !== null ? new Date(current) : startOfDay(new Date());
    if (part === "d") date.setDate(date.getDate() + direction);
    if (part === "m") date.setMonth(date.getMonth() + direction);
    if (part === "y") date.setFullYear(date.getFullYear() + direction);
    if (part === "hour") date.setHours(date.getHours() + direction);
    if (part === "minute") date.setMinutes(date.getMinutes() + direction);
    write(date.getTime());
    queueMicrotask(() => inputs[part]?.select());
  }

  function onInput(part: Part, raw: string, trusted: boolean) {
    const digits = raw.replace(/\D/g, "").slice(0, MAX_LENGTH[part]);
    const next = { ...texts(), [part]: digits };
    setTexts(next);
    if (inputs[part] && inputs[part]!.value !== digits) inputs[part]!.value = digits;

    if (trusted && digits.length >= MAX_LENGTH[part]) focusPart(neighbour(part, 1));

    const ms = read(next);
    const dateFull = next.d.length > 0 && next.m.length > 0 && next.y.length >= 4;
    const allEmpty = parts().every(key => next[key] === "");

    if (ms !== null) emit(ms);
    else if (allEmpty && props.onClear) {
      setBad(false);
      props.onClear();
    } else {
      setBad(dateFull);
    }
  }

  function onKeyDown(part: Part, event: KeyboardEvent) {
    const input = event.currentTarget as HTMLInputElement;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      step(part, event.key === "ArrowUp" ? 1 : -1);
    } else if (["/", "-", ".", " ", ":", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      focusPart(neighbour(part, 1));
    } else if (event.key === "ArrowLeft" || (event.key === "Backspace" && input.value === "")) {
      const previous = neighbour(part, -1);
      if (previous) {
        event.preventDefault();
        focusPart(previous);
      }
    } else if (event.key === "Enter") {
      input.blur();
    } else if (event.key.length === 1 && !/\d/.test(event.key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
    }
  }

  function onPartBlur(part: Part) {
    const value = texts()[part];
    if (!value || part === "y") return;
    const padded = pad2(parseInt(value, 10) || (part === "d" || part === "m" ? 1 : 0));
    if (padded !== value) setTexts({ ...texts(), [part]: padded });
  }

  function onFocusOut(event: FocusEvent) {
    if (box?.contains(event.relatedTarget as Node | null)) return;
    setFocused(false);
    if (bad()) return;
    setTexts(textsFor(props.value));
  }

  function onWheel(event: WheelEvent) {
    const part = parts().find(key => inputs[key] === document.activeElement);
    if (!part || props.disabled) return;
    event.preventDefault();
    step(part, event.deltaY < 0 ? 1 : -1);
  }

  const [calendarOpen, setCalendarOpen] = createSignal(false);
  const [calendarMounted, setCalendarMounted] = createSignal(false);
  const [calendarStyle, setCalendarStyle] = createSignal<JSX.CSSProperties>({});
  const [calendarUpwards, setCalendarUpwards] = createSignal(false);
  const [viewMonth, setViewMonth] = createSignal(new Date());
  const [slide, setSlide] = createSignal(0);
  let calendar: HTMLDivElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const selectedDate = createMemo(() => props.value !== null ? new Date(props.value) : null);
  const monthLabel = createMemo(() => `${MONTHS[viewMonth().getMonth()]} ${viewMonth().getFullYear()}`);
  const days = createMemo(() => {
    const first = new Date(viewMonth().getFullYear(), viewMonth().getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  });

  function openCalendar() {
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const estimatedHeight = 330;
    const upwards = rect.bottom + estimatedHeight + CALENDAR_MARGIN > window.innerHeight && rect.top > estimatedHeight;
    const view = selectedDate() ?? new Date();

    clearTimeout(closeTimer);
    setViewMonth(new Date(view.getFullYear(), view.getMonth(), 1));
    setSlide(0);
    setCalendarUpwards(upwards);
    setCalendarStyle({
      left: Math.max(8, Math.min(window.innerWidth - 272, rect.left)) + "px",
      ...(upwards
        ? { bottom: (window.innerHeight - rect.top + CALENDAR_MARGIN) + "px" }
        : { top: (rect.bottom + CALENDAR_MARGIN) + "px" }),
    });
    setCalendarMounted(true);
    setCalendarOpen(true);
  }

  function closeCalendar() {
    if (!calendarOpen()) return;
    setCalendarOpen(false);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setCalendarMounted(false), CLOSE_DURATION);
  }

  onCleanup(() => clearTimeout(closeTimer));

  createEffect(() => {
    if (!calendarOpen()) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (calendar?.contains(target) || box?.contains(target)) return;
      closeCalendar();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeCalendar();
    };
    const onScroll = (event: Event) => {
      if (calendar && event.target instanceof Node && calendar.contains(event.target)) return;
      closeCalendar();
    };

    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeCalendar);
    onCleanup(() => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeCalendar);
    });
  });

  function moveMonth(direction: number) {
    setSlide(direction);
    setViewMonth(current => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  }

  function pick(date: Date) {
    const previous = selectedDate();
    const picked = new Date(date);
    if (props.withTime && previous) picked.setHours(previous.getHours(), previous.getMinutes());
    write(picked.getTime());
    closeCalendar();
  }

  return (
    <div
      ref={box}
      class={`${fieldStyles.NumberField} ${fieldStyles.Segments}`}
      classList={{
        [fieldStyles.Bad]: bad(),
        [fieldStyles.Small]: props.size === "sm",
        [fieldStyles.Disabled]: props.disabled ?? false,
      }}
      onFocusIn={() => setFocused(true)}
      onFocusOut={onFocusOut}
      onWheel={onWheel}
    >
      <For each={parts()}>{(part, index) => (
        <>
          <Show when={index() > 0}>
            <span class={styles.Separator} classList={{ [styles.TimeGap]: part === "hour" }}>
              {part === "minute" ? ":" : part === "hour" ? "" : "/"}
            </span>
          </Show>
          <input
            ref={element => inputs[part] = element}
            class={styles.Part}
            classList={{ [styles.Year]: part === "y" }}
            inputmode="numeric"
            maxLength={MAX_LENGTH[part]}
            placeholder={PLACEHOLDER[part]}
            aria-label={part}
            value={texts()[part]}
            disabled={props.disabled}
            onInput={event => onInput(part, event.currentTarget.value, event.isTrusted)}
            onKeyDown={event => onKeyDown(part, event)}
            onBlur={() => onPartBlur(part)}
            onPaste={event => event.preventDefault()}
            onFocus={event => {
              const input = event.currentTarget;
              setTimeout(() => input.select(), 0);
            }}
          />
        </>
      )}</For>
      <button
        type="button"
        tabIndex={-1}
        class={styles.CalendarButton}
        classList={{ [styles.Open]: calendarOpen() }}
        aria-label="Pick a date"
        disabled={props.disabled}
        onClick={() => calendarOpen() ? closeCalendar() : openCalendar()}
      >
        <Calendar size={14} />
      </button>
      <Tooltip anchor={() => box} text={bad() ? "Not a real date" : undefined} />

      <Show when={calendarMounted()}>
        <Portal>
          <div
            ref={calendar}
            class={styles.Calendar}
            classList={{ [styles.Upwards]: calendarUpwards(), [styles.Closing]: !calendarOpen() }}
            style={calendarStyle()}
          >
            <div class={styles.CalendarHeader}>
              <Button isIcon size="sm" tooltip="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={15} /></Button>
              <b>{monthLabel()}</b>
              <Button isIcon size="sm" tooltip="Next month" onClick={() => moveMonth(1)}><ChevronRight size={15} /></Button>
            </div>
            <Show when={monthLabel()} keyed>
              {_month => (
                <div class={styles.Grid} classList={{ [styles.FromRight]: slide() > 0, [styles.FromLeft]: slide() < 0 }}>
                  <For each={WEEKDAYS}>{day => <span class={styles.Weekday}>{day}</span>}</For>
                  <For each={days()}>{date => (
                    <button
                      type="button"
                      class={styles.Day}
                      classList={{
                        [styles.Outside]: date.getMonth() !== viewMonth().getMonth(),
                        [styles.Today]: sameDay(date, new Date()),
                        [styles.Selected]: selectedDate() !== null && sameDay(date, selectedDate()!),
                      }}
                      onClick={() => pick(date)}
                    >
                      {date.getDate()}
                    </button>
                  )}</For>
                </div>
              )}
            </Show>
            <div class={styles.CalendarFooter}>
              <Button size="sm" variant="ghost" onClick={() => pick(startOfDay(new Date()))}>Today</Button>
              <Show when={props.onClear}>
                <Button size="sm" variant="ghost" onClick={() => { setTexts({ ...EMPTY }); props.onClear?.(); closeCalendar(); }}>Clear</Button>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

export default DateField;
