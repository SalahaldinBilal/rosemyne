import { createSignal } from "solid-js";
import { safeInvoke } from "./safeInvoke";
import { DateTimePatterns } from "@core/types";

// A signal (not a plain variable) so that JSX already rendered with the
// fallback format reactively re-renders once the real pattern loads, instead
// of being stuck on the fallback for the rest of the session.
const [patterns, setPatterns] = createSignal<DateTimePatterns | null>(null);

/**
 * Fetches the OS's actual date/time format once (see `locale.rs` , this
 * reflects the user's Regional format/LC_TIME override, which can differ
 * from their UI language and isn't otherwise visible to a WebView). Safe to
 * call more than once; only the first call does any work.
 */
export async function loadSystemDateTimePatterns(): Promise<void> {
  if (patterns()) return;

  try {
    setPatterns(await safeInvoke("get_system_datetime_patterns"));
  } catch (error) {
    console.error("Failed to load the system date/time format", error);
  }
}

const TOKEN_PATTERN = /yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|tt|t|'[^']*'/g;

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** Applies a Windows custom-format-picture pattern (see DateTimePatterns) to a Date. */
function applyPattern(pattern: string, date: Date): string {
  return pattern.replace(TOKEN_PATTERN, token => {
    switch (token) {
      case "yyyy": return String(date.getFullYear());
      case "yy": return pad(date.getFullYear() % 100);
      case "MMMM": return MONTHS_LONG[date.getMonth()];
      case "MMM": return MONTHS_SHORT[date.getMonth()];
      case "MM": return pad(date.getMonth() + 1);
      case "M": return String(date.getMonth() + 1);
      case "dddd": return DAYS_LONG[date.getDay()];
      case "ddd": return DAYS_SHORT[date.getDay()];
      case "dd": return pad(date.getDate());
      case "d": return String(date.getDate());
      case "HH": return pad(date.getHours());
      case "H": return String(date.getHours());
      case "hh": return pad(((date.getHours() + 11) % 12) + 1);
      case "h": return String(((date.getHours() + 11) % 12) + 1);
      case "mm": return pad(date.getMinutes());
      case "m": return String(date.getMinutes());
      case "ss": return pad(date.getSeconds());
      case "s": return String(date.getSeconds());
      case "tt": return date.getHours() < 12 ? "AM" : "PM";
      case "t": return date.getHours() < 12 ? "A" : "P";
      default:
        // A quoted literal , strip the surrounding single quotes.
        return token.startsWith("'") && token.endsWith("'") ? token.slice(1, -1) : token;
    }
  });
}

/**
 * Formats a date using the OS's real short-date + time preference, falling
 * back to the browser default until `loadSystemDateTimePatterns` resolves
 * (or if it couldn't determine one). Reactive , re-evaluates once the real
 * pattern loads if called from within JSX/a computation.
 */
export function formatSystemDateTime(date: Date): string {
  const current = patterns();
  if (!current) return date.toLocaleString();
  return `${applyPattern(current.shortDate, date)}, ${applyPattern(current.time, date)}`;
}
