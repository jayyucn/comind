//! Recurrence rule calculation.
//!
//! Input: local ISO string (2026-07-15T14:00 or 2026-07-15, no timezone suffix Z)
//! Output: same-format local ISO advanced by one unit.
//!
//! Migrated from TS `src/utils/recurrence.ts`.

use chrono::{NaiveDate, NaiveDateTime, NaiveTime, Datelike, Timelike};

/// Advance a local ISO datetime string by one recurrence step.
/// `rule` is one of: daily, weekly, monthly, yearly.
/// Returns `iso` unchanged if rule is "none" or parse fails.
pub fn calculate_next_recurrence(iso: &str, rule: &str) -> String {
    if rule == "none" || rule.is_empty() {
        return iso.to_string();
    }

    let has_time = iso.contains('T');
    let parsed = if has_time {
        NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M")
            .map(|dt| dt)
            .or_else(|_| NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").map(|dt| dt))
    } else {
        NaiveDate::parse_from_str(iso, "%Y-%m-%d")
            .map(|d| d.and_time(NaiveTime::from_hms_opt(0, 0, 0).unwrap()))
    };

    let dt = match parsed {
        Ok(dt) => dt,
        Err(_) => return iso.to_string(),
    };

    let next = match rule {
        "daily" => dt + chrono::Duration::days(1),
        "weekly" => dt + chrono::Duration::weeks(1),
        "monthly" => {
            advance_month(dt.date())
        },
        "yearly" => {
            advance_year(dt.date())
        },
        _ => return iso.to_string(),
    };

    if has_time {
        format!("{}T{:02}:{:02}", next.date().format("%Y-%m-%d"), next.time().hour(), next.time().minute())
    } else {
        next.date().format("%Y-%m-%d").to_string()
    }
}

/// Advance one month preserving the day-of-month as closely as possible.
/// If the target month has fewer days, clamp to its last day.
fn advance_month(date: NaiveDate) -> NaiveDateTime {
    let day = date.day();
    let next_year = date.year();
    let next_month = if date.month() == 12 { 1 } else { date.month() + 1 };
    let next_year = if date.month() == 12 { next_year + 1 } else { next_year };

    // Last day of target month
    let last_day = last_day_of_month(next_year, next_month);
    let final_day = std::cmp::min(day, last_day);

    NaiveDate::from_ymd_opt(next_year, next_month, final_day)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
}

/// Advance one year preserving month/day.
/// Handles leap-year Feb 29 → Feb 28.
fn advance_year(date: NaiveDate) -> NaiveDateTime {
    let day = date.day();
    let year = date.year() + 1;
    let month = date.month();
    let last_day = last_day_of_month(year, month);
    let final_day = std::cmp::min(day, last_day);

    NaiveDate::from_ymd_opt(year, month, final_day)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    // NaiveDate::from_ymd_opt with day=0 gives last day of previous month,
    // so month+1 with day=0 gives last day of `month`.
    NaiveDate::from_ymd_opt(
        if month == 12 { year + 1 } else { year },
        if month == 12 { 1 } else { month + 1 },
        1,
    )
    .and_then(|d| d.pred_opt())
    .map(|d| d.day())
    .unwrap_or(28)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_returns_unchanged() {
        assert_eq!(calculate_next_recurrence("2026-07-15", "none"), "2026-07-15");
        assert_eq!(calculate_next_recurrence("2026-07-15T14:00", ""), "2026-07-15T14:00");
    }

    #[test]
    fn daily_advances_one_day() {
        assert_eq!(calculate_next_recurrence("2026-07-15", "daily"), "2026-07-16");
        assert_eq!(calculate_next_recurrence("2026-07-15T14:00", "daily"), "2026-07-16T14:00");
    }

    #[test]
    fn weekly_advances_seven_days() {
        assert_eq!(calculate_next_recurrence("2026-07-15", "weekly"), "2026-07-22");
        assert_eq!(calculate_next_recurrence("2026-07-15T14:00", "weekly"), "2026-07-22T14:00");
    }

    #[test]
    fn monthly_same_day() {
        assert_eq!(calculate_next_recurrence("2026-07-15", "monthly"), "2026-08-15");
    }

    #[test]
    fn monthly_clamp_end_of_month() {
        // Jan 31 → Feb 28 (non-leap)
        assert_eq!(calculate_next_recurrence("2026-01-31", "monthly"), "2026-02-28");
    }

    #[test]
    fn monthly_december_wrap() {
        assert_eq!(calculate_next_recurrence("2026-12-15", "monthly"), "2027-01-15");
    }

    #[test]
    fn yearly_preserves_month_day() {
        assert_eq!(calculate_next_recurrence("2026-07-15", "yearly"), "2027-07-15");
    }

    #[test]
    fn yearly_leap_day_to_non_leap() {
        assert_eq!(calculate_next_recurrence("2024-02-29", "yearly"), "2025-02-28");
    }

    #[test]
    fn invalid_rule_returns_unchanged() {
        assert_eq!(calculate_next_recurrence("2026-07-15", "foo"), "2026-07-15");
    }

    #[test]
    fn invalid_iso_returns_unchanged() {
        assert_eq!(calculate_next_recurrence("not-a-date", "daily"), "not-a-date");
    }
}
