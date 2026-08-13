//! Journal title detection and normalization.
//!
//! Migrated from TS `src/utils/journal-detect.ts`.
//! 8 date formats supported; canonical form is YYYY-MM-DD.

use chrono::NaiveDate;
use regex::Regex;

/// 8 journal date formats, tried in order during detection.
/// Canonical format is YYYY-MM-DD (used for storage).
static JOURNAL_FORMAT_ITEMS: &[&str] = &[
    "%Y-%m-%d",       // 2026-04-26 (canonical)
    "%Y/%m/%d",       // 2026/04/26
    "%Y_%m_%d",       // 2026_04_26
    "%b %e, %Y",      // Apr 26, 2026
    "%A, %B %e, %Y",  // Saturday, April 26, 2026
    "%m/%d/%Y",       // 04/26/2026
    "%d.%m.%Y",       // 26.04.2026
];

/// Chinese date format: 2026年4月26日
static CN_DATE_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
    Regex::new(r"^(\d{4})年(\d{1,2})月(\d{1,2})日$").unwrap()
});

/// Try to parse a title string into a NaiveDate.
/// Tries all journal formats + Chinese format. Returns None if no match.
pub fn parse_to_date(title: &str) -> Option<NaiveDate> {
    let trimmed = title.trim();
    if trimmed.is_empty() { return None; }

    // Try Chinese format first (chrono can't parse it natively)
    if let Some(caps) = CN_DATE_RE.captures(trimmed) {
        let year: i32 = caps.get(1)?.as_str().parse().ok()?;
        let month: u32 = caps.get(2)?.as_str().parse().ok()?;
        let day: u32 = caps.get(3)?.as_str().parse().ok()?;
        return NaiveDate::from_ymd_opt(year, month, day);
    }

    // Try standard formats via chrono
    for fmt in JOURNAL_FORMAT_ITEMS {
        if let Ok(d) = NaiveDate::parse_from_str(trimmed, fmt) {
            return Some(d);
        }
    }

    None
}

/// Check if a page title matches any journal date format.
pub fn is_journal_title(title: &str) -> bool {
    parse_to_date(title).is_some()
}

/// Normalize a journal title to canonical YYYY-MM-DD form.
/// Returns None if the title is not a recognized journal date.
pub fn normalize_journal_title(title: &str) -> Option<String> {
    parse_to_date(title).map(|d| format!("{}", d.format("%Y-%m-%d")))
}

/// Infer page type from title.
/// Returns "journal" if the title matches a journal format, "normal" otherwise.
pub fn infer_page_type(title: &str) -> &'static str {
    if is_journal_title(title) { "journal" } else { "normal" }
}

/// Check whether a normalized title represents today.
pub fn is_today_title(normalized_title: &str) -> bool {
    if let Some(d) = parse_to_date(normalized_title) {
        let today = chrono::Local::now().date_naive();
        return d == today;
    }
    false
}

/// Canonical journal format string (for reference).
pub const JOURNAL_CANONICAL_FORMAT: &str = "%Y-%m-%d";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_canonical_format() {
        let d = parse_to_date("2026-04-26").unwrap();
        assert_eq!(d, NaiveDate::from_ymd_opt(2026, 4, 26).unwrap());
    }

    #[test]
    fn parse_slash_format() {
        let d = parse_to_date("2026/04/26").unwrap();
        assert_eq!(d, NaiveDate::from_ymd_opt(2026, 4, 26).unwrap());
    }

    #[test]
    fn parse_us_format() {
        let d = parse_to_date("04/26/2026").unwrap();
        assert_eq!(d, NaiveDate::from_ymd_opt(2026, 4, 26).unwrap());
    }

    #[test]
    fn parse_chinese_format() {
        let d = parse_to_date("2026年4月26日").unwrap();
        assert_eq!(d, NaiveDate::from_ymd_opt(2026, 4, 26).unwrap());
    }

    #[test]
    fn non_journal_title() {
        assert!(parse_to_date("Meeting Notes").is_none());
        assert!(parse_to_date("").is_none());
    }

    #[test]
    fn journal_detection() {
        assert!(is_journal_title("2026-04-26"));
        assert!(!is_journal_title("Project Plan"));
    }

    #[test]
    fn normalization() {
        assert_eq!(normalize_journal_title("2026/04/26"), Some("2026-04-26".into()));
        assert_eq!(normalize_journal_title("2026年4月26日"), Some("2026-04-26".into()));
        assert_eq!(normalize_journal_title("random"), None);
    }

    #[test]
    fn infer_page_type_test() {
        assert_eq!(infer_page_type("2026-04-26"), "journal");
        assert_eq!(infer_page_type("Meeting Notes"), "normal");
    }

    #[test]
    fn today_detection() {
        let today_str = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();
        assert!(is_today_title(&today_str));
        assert!(!is_today_title("2020-01-01"));
    }
}
