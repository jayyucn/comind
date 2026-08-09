//! Date/time input parsing.
//!
//! Migrated from TS `src/utils/date-parser.ts`.
//! Supports: relative (today/tomorrow/yesterday/+Nd), partial (MM-DD/YYYY-MM-DD),
//! Chinese weekday (周一/下周三), and Chinese time (下午2点/早上9点半).

use std::sync::LazyLock;

use chrono::{NaiveDate, Datelike, Local, Weekday};
use serde::{Serialize, Deserialize};

/// Parse a date input string and return YYYY-MM-DD or None.
pub fn parse_date_input(input: &str) -> Option<String> {
    let trimmed = input.trim().to_lowercase();
    if trimmed.is_empty() { return None; }
    resolve_date(&trimmed).map(|d| format!("{}", d.format("%Y-%m-%d")))
}

/// Result of date+time parsing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DateTimeResult {
    /// YYYY-MM-DD
    pub date: String,
    /// HH:mm (None = all-day)
    pub time: Option<String>,
}

/// Parse date + optional time, supporting Chinese input.
pub fn parse_date_time_input(input: &str) -> Option<DateTimeResult> {
    let trimmed = input.trim();
    if trimmed.is_empty() { return None; }

    let time_info = extract_time(trimmed);
    let date_part = time_info.as_ref()
        .map(|t| t.rest.as_str())
        .unwrap_or(trimmed)
        .trim();
    if date_part.is_empty() { return None; }

    let date_str = resolve_date(&date_part.to_lowercase())?;
    Some(DateTimeResult {
        date: format!("{}", date_str.format("%Y-%m-%d")),
        time: time_info.map(|t| t.time),
    })
}

/// Combine DateTimeResult into ISO string (YYYY-MM-DDTHH:mm or YYYY-MM-DD).
pub fn combine_date_time(result: &DateTimeResult) -> String {
    match &result.time {
        Some(time) => format!("{}T{}", result.date, time),
        None => result.date.clone(),
    }
}

// ── internal helpers ──

fn today_local() -> NaiveDate {
    Local::now().date_naive()
}

struct TimeInfo {
    time: String,
    rest: String,
}

/// Pre-compiled regex for relative date: +N / -N / +Nd / +N days
static RE_RELATIVE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^([+-]?\d+)\s*(d|day|days)?$").unwrap()
});

/// Pre-compiled regex for MM-DD
static RE_MMDD: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^(\d{1,2})-(\d{1,2})$").unwrap()
});

/// Pre-compiled regex for YYYY-MM-DD
static RE_YYYYMMDD: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^(\d{4})-(\d{1,2})-(\d{1,2})$").unwrap()
});

/// Pre-compiled regex for Chinese weekday: 下周一 / 周三
static RE_WEEKDAY: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^(下?周|下?星期)([日天一二三四五六])$").unwrap()
});

/// Pre-compiled regex for numeric time: HH:MM / HH：MM
static RE_NUM_TIME: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(\d{1,2})[:：](\d{2})").unwrap()
});

/// Pre-compiled regex for Chinese time: 下午2点 / 早上9点半 / 中午12点
static RE_CN_TIME: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(早上|上午|中午|下午|晚上|凌晨)?\s*(\d{1,2})\s*点\s*(半|(\d{1,2})\s*分?)?").unwrap()
});

fn resolve_date(input: &str) -> Option<NaiveDate> {
    parse_relative_date(input)
        .or_else(|| parse_partial_date(input))
        .or_else(|| parse_weekday(input))
}

fn parse_relative_date(input: &str) -> Option<NaiveDate> {
    let today = today_local();

    if input == "today" || input == "今天" {
        return Some(today);
    }
    if input == "tomorrow" || input == "明天" {
        return Some(today + chrono::Duration::days(1));
    }
    if input == "yesterday" || input == "昨天" {
        return Some(today - chrono::Duration::days(1));
    }

    // +N / -N / +Nd / +N days
    if let Some(caps) = RE_RELATIVE.captures(input) {
        let days: i64 = caps.get(1)?.as_str().parse().ok()?;
        return Some(today + chrono::Duration::days(days));
    }

    None
}

fn parse_partial_date(input: &str) -> Option<NaiveDate> {
    let today = today_local();

    // MM-DD
    if let Some(caps) = RE_MMDD.captures(input) {
        let month: u32 = caps.get(1)?.as_str().parse().ok()?;
        let day: u32 = caps.get(2)?.as_str().parse().ok()?;
        if month == 0 || month > 12 || day == 0 || day > 31 { return None; }
        let mut d = NaiveDate::from_ymd_opt(today.year(), month, day)?;
        // If in the past, assume next year
        if d < today {
            d = NaiveDate::from_ymd_opt(today.year() + 1, month, day)?;
        }
        return Some(d);
    }

    // YYYY-MM-DD
    if let Some(caps) = RE_YYYYMMDD.captures(input) {
        let year: i32 = caps.get(1)?.as_str().parse().ok()?;
        let month: u32 = caps.get(2)?.as_str().parse().ok()?;
        let day: u32 = caps.get(3)?.as_str().parse().ok()?;
        if !(2000..=2100).contains(&year) || month == 0 || month > 12 || day == 0 || day > 31 {
            return None;
        }
        return NaiveDate::from_ymd_opt(year, month, day);
    }

    None
}

fn weekday_index(s: &str) -> Option<u32> {
    match s {
        "日" | "天" => Some(0),
        "一" => Some(1),
        "二" => Some(2),
        "三" => Some(3),
        "四" => Some(4),
        "五" => Some(5),
        "六" => Some(6),
        _ => None,
    }
}

fn weekday_from_num(n: u32) -> Weekday {
    match n {
        0 => Weekday::Sun,
        1 => Weekday::Mon,
        2 => Weekday::Tue,
        3 => Weekday::Wed,
        4 => Weekday::Thu,
        5 => Weekday::Fri,
        _ => Weekday::Sat,
    }
}

fn parse_weekday(input: &str) -> Option<NaiveDate> {
    let caps = RE_WEEKDAY.captures(input)?;
    let target = weekday_index(caps.get(2)?.as_str())?;
    let is_next_week = caps.get(1)?.as_str().starts_with('下');
    let today = today_local();

    // This week's occurrence of target weekday
    let target_weekday = weekday_from_num(target);
    let days_back = (today.weekday().num_days_from_monday() as i32
        - target_weekday.num_days_from_monday() as i32 + 7) % 7;
    let mut this_week = today - chrono::Duration::days(days_back as i64);

    if is_next_week {
        this_week += chrono::Duration::weeks(1);
    } else if this_week <= today {
        // Excluding today: if this week's occurrence has passed (or is today), move to next week
        this_week += chrono::Duration::weeks(1);
    }

    Some(this_week)
}

fn extract_time(input: &str) -> Option<TimeInfo> {
    let pad = |n: u32| format!("{:02}", n);
    let clamp = |n: u32, max: u32| n.min(max);

    // HH:MM or HH:MM
    if let Some(caps) = RE_NUM_TIME.captures(input) {
        let h: u32 = caps.get(1)?.as_str().parse().ok()?;
        let min: u32 = caps.get(2)?.as_str().parse().ok()?;
        let h = clamp(h, 23);
        let min = clamp(min, 59);
        let rest = input.replacen(caps.get(0)?.as_str(), "", 1);
        return Some(TimeInfo { time: format!("{}:{}", pad(h), pad(min)), rest });
    }

    // 中文时间: 下午2点 / 早上9点半 / 中午12点 / 凌晨1点
    if let Some(caps) = RE_CN_TIME.captures(input) {
        let mut h: u32 = caps.get(2)?.as_str().parse().ok()?;
        let period = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        match period {
            "下午" | "晚上" => if h < 12 { h += 12 },
            "中午" => h = 12,
            "凌晨" => if h == 12 { h = 0 },
            _ => {}
        }
        let mut min = 0u32;
        if caps.get(3).map(|m| m.as_str()) == Some("半") {
            min = 30;
        } else if let Some(m4) = caps.get(4) {
            min = m4.as_str().parse().unwrap_or(0);
        }
        let rest = input.replacen(caps.get(0)?.as_str(), "", 1);
        return Some(TimeInfo { time: format!("{}:{}", pad(h), pad(min)), rest });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    mod parse_date_input {
        use super::*;

        #[test]
        fn today_english() {
            let d = parse_date_input("today").unwrap();
            assert_eq!(d, format!("{}", today_local().format("%Y-%m-%d")));
        }

        #[test]
        fn tomorrow() {
            let d = parse_date_input("tomorrow").unwrap();
            let exp = today_local() + chrono::Duration::days(1);
            assert_eq!(d, format!("{}", exp.format("%Y-%m-%d")));
        }

        #[test]
        fn chinese_today() {
            let d = parse_date_input("今天").unwrap();
            assert_eq!(d, format!("{}", today_local().format("%Y-%m-%d")));
        }

        #[test]
        fn relative_plus_days() {
            let d = parse_date_input("+3").unwrap();
            let exp = today_local() + chrono::Duration::days(3);
            assert_eq!(d, format!("{}", exp.format("%Y-%m-%d")));
        }

        #[test]
        fn relative_minus_days() {
            let d = parse_date_input("-1d").unwrap();
            let exp = today_local() - chrono::Duration::days(1);
            assert_eq!(d, format!("{}", exp.format("%Y-%m-%d")));
        }

        #[test]
        fn partial_mmdd() {
            let d = parse_date_input("07-15").unwrap();
            assert!(d.ends_with("-07-15"));
        }

        #[test]
        fn full_yyyymmdd() {
            assert_eq!(parse_date_input("2026-08-01").unwrap(), "2026-08-01");
        }

        #[test]
        fn chinese_weekday() {
            let d = parse_date_input("周一").unwrap();
            assert!(d.len() == 10); // YYYY-MM-DD
        }

        #[test]
        fn empty_returns_none() {
            assert_eq!(parse_date_input(""), None);
        }

        #[test]
        fn garbage_returns_none() {
            assert_eq!(parse_date_input("blah blah"), None);
        }
    }

    mod parse_date_time_input {
        use super::*;

        #[test]
        fn date_with_time() {
            let r = parse_date_time_input("2026-08-01 14:30").unwrap();
            assert_eq!(r.date, "2026-08-01");
            assert_eq!(r.time.as_deref(), Some("14:30"));
        }

        #[test]
        fn chinese_time_only_returns_none() {
            // Pure time with no date part should return None
            assert!(parse_date_time_input("下午2点半").is_none());
        }

        #[test]
        fn chinese_date_and_time() {
            let r = parse_date_time_input("明天下午2点半").unwrap();
            assert!(r.date.len() == 10);
            assert_eq!(r.time.as_deref(), Some("14:30"));
        }

        #[test]
        fn date_only() {
            let r = parse_date_time_input("2026-08-01").unwrap();
            assert_eq!(r.date, "2026-08-01");
            assert_eq!(r.time, None);
        }
    }

    mod combine_date_time {
        use super::*;

        #[test]
        fn with_time() {
            let r = DateTimeResult { date: "2026-08-01".into(), time: Some("14:30".into()) };
            assert_eq!(combine_date_time(&r), "2026-08-01T14:30");
        }

        #[test]
        fn all_day() {
            let r = DateTimeResult { date: "2026-08-01".into(), time: None };
            assert_eq!(combine_date_time(&r), "2026-08-01");
        }
    }
}
