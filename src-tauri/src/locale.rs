//! The user's actual date/time formatting preference, which can differ from
//! their UI language , Windows lets "Regional format" be set independently
//! of display language, and Linux's `LC_TIME` does the same independently of
//! `LANG`. The frontend can't get this itself: WebView2/browsers only expose
//! the UI language via `navigator.language`, not the format override, and a
//! locale tag alone (e.g. "en-GB") wouldn't capture further user
//! customization like a hand-edited short date pattern , so this returns the
//! OS's own literal format pattern instead.
//!
//! Normalized to Windows' custom-format-picture token syntax (`yyyy`, `MM`,
//! `dd`, `HH`, `mm`, `tt`, ...) regardless of platform, so the frontend only
//! ever implements one substitution syntax.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DateTimePatterns {
    pub short_date: String,
    pub time: String,
}

#[cfg(target_os = "windows")]
pub fn system_datetime_patterns() -> Option<DateTimePatterns> {
    use windows::Win32::Globalization::{GetLocaleInfoEx, LOCALE_SSHORTDATE, LOCALE_STIMEFORMAT};
    use windows::core::PCWSTR;

    fn query(lctype: u32) -> Option<String> {
        let mut buffer = [0u16; 128];
        let len = unsafe { GetLocaleInfoEx(PCWSTR::null(), lctype, Some(&mut buffer)) };
        if len <= 1 {
            return None;
        }

        // `len` includes the null terminator.
        Some(String::from_utf16_lossy(&buffer[..(len as usize - 1)]))
    }

    // Windows' own pattern syntax already matches what this module standardizes
    // on, so these are returned as-is , no translation needed.
    Some(DateTimePatterns {
        short_date: query(LOCALE_SSHORTDATE)?,
        time: query(LOCALE_STIMEFORMAT)?,
    })
}

#[cfg(target_os = "linux")]
pub fn system_datetime_patterns() -> Option<DateTimePatterns> {
    use std::process::Command;

    // `locale -k LC_TIME` prints the active LC_TIME category's keywords,
    // including `d_fmt`/`t_fmt` (strftime pictures) , shelling out avoids a
    // libc FFI dependency for something only queried once per session,
    // matching this codebase's existing convention of shelling out to small
    // system utilities on Linux (see file_clipboard/linux.rs).
    let output = Command::new("locale").arg("-k").arg("LC_TIME").output().ok()?;
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8(output.stdout).ok()?;
    let extract = |key: &str| -> Option<String> {
        let prefix = format!("{key}=");
        text.lines()
            .find_map(|line| line.strip_prefix(prefix.as_str()))
            .map(|value| value.trim_matches('"').to_string())
            .filter(|value| !value.is_empty())
    };

    let short_date = extract("d_fmt")?;
    // Prefer the 12-hour form if the locale defines one; falls back to
    // whatever `t_fmt` (often 24-hour) says otherwise.
    let time = extract("t_fmt_ampm").or_else(|| extract("t_fmt"))?;

    Some(DateTimePatterns {
        short_date: strftime_to_pattern(&short_date),
        time: strftime_to_pattern(&time),
    })
}

#[cfg(target_os = "linux")]
fn strftime_to_pattern(strftime: &str) -> String {
    let mut result = String::new();
    let mut chars = strftime.chars().peekable();

    while let Some(c) = chars.next() {
        if c != '%' {
            result.push(c);
            continue;
        }

        match chars.next() {
            Some('d') => result.push_str("dd"),
            Some('e') => result.push('d'),
            Some('m') => result.push_str("MM"),
            Some('Y') => result.push_str("yyyy"),
            Some('y') => result.push_str("yy"),
            Some('H') => result.push_str("HH"),
            Some('I') => result.push_str("hh"),
            Some('M') => result.push_str("mm"),
            Some('S') => result.push_str("ss"),
            Some('p') => result.push_str("tt"),
            Some('a') => result.push_str("ddd"),
            Some('A') => result.push_str("dddd"),
            Some('b') | Some('h') => result.push_str("MMM"),
            Some('B') => result.push_str("MMMM"),
            Some('%') => result.push('%'),
            // Unrecognized specifier , pass through verbatim rather than
            // silently dropping it.
            Some(other) => {
                result.push('%');
                result.push(other);
            }
            None => result.push('%'),
        }
    }

    result
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn system_datetime_patterns() -> Option<DateTimePatterns> {
    None
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::strftime_to_pattern;

    #[test]
    fn translates_common_us_pictures() {
        assert_eq!(strftime_to_pattern("%m/%d/%Y"), "MM/dd/yyyy");
        assert_eq!(strftime_to_pattern("%I:%M:%S %p"), "hh:mm:ss tt");
    }

    #[test]
    fn translates_common_uk_pictures() {
        assert_eq!(strftime_to_pattern("%d/%m/%Y"), "dd/MM/yyyy");
        assert_eq!(strftime_to_pattern("%H:%M:%S"), "HH:mm:ss");
    }

    #[test]
    fn passes_through_literals_and_unknown_specifiers() {
        assert_eq!(strftime_to_pattern("%A, %d %B %Y"), "dddd, dd MMMM yyyy");
        assert_eq!(strftime_to_pattern("%%"), "%");
        assert_eq!(strftime_to_pattern("%Z"), "%Z");
    }
}
