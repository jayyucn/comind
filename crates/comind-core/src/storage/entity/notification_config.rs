#[cfg(not(target_arch = "wasm32"))]
use crate::types::NotificationConfig;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// NotificationConfig 的规范列（单行表 `notification_config`，id=1）—— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取；wasm 路径为 no-op 桩（由 TS 经 localStorage 持久化），
/// 故本模块只收敛原生路径。布尔字段以 i64(0/1) 存储（Q4b：列序 drift 不适用）。
pub const NOTIFICATION_CONFIG_COLS: &[&str] = &[
    "id", "enabled", "schedule_enabled", "deadline_enabled", "overdue_enabled",
    "quiet_hours_start", "quiet_hours_end", "web_browser_notifications_enabled",
];

pub fn notification_config_select_cols() -> String {
    NOTIFICATION_CONFIG_COLS.join(", ")
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_notification_config_native(row: &rusqlite::Row) -> Result<NotificationConfig, rusqlite::Error> {
    Ok(NotificationConfig {
        id: row.get(0)?,
        enabled: row.get::<_, i64>(1)? != 0,
        schedule_enabled: row.get::<_, i64>(2)? != 0,
        deadline_enabled: row.get::<_, i64>(3)? != 0,
        overdue_enabled: row.get::<_, i64>(4)? != 0,
        quiet_hours_start: row.get(5)?,
        quiet_hours_end: row.get(6)?,
        web_browser_notifications_enabled: row.get::<_, i64>(7)? != 0,
    })
}

// ── 原生 / 事务共享：自由函数（收 &E where E: Executor） ────────────────

#[cfg(not(target_arch = "wasm32"))]
fn bx(e: rusqlite::Error) -> Box<dyn Error> {
    Box::new(e)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_config_get<E: Executor>(exec: &E) -> Result<NotificationConfig, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM notification_config WHERE id = 1",
        notification_config_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![];
    let rows = exec.query_map(&sql, &params, |row| row_to_notification_config_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "NotificationConfig not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_config_save<E: Executor>(exec: &E, config: &NotificationConfig) -> Result<(), Box<dyn Error>> {
    let sql = "INSERT INTO notification_config (id, enabled, schedule_enabled, deadline_enabled, overdue_enabled, quiet_hours_start, quiet_hours_end, web_browser_notifications_enabled) \
               VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7) \
               ON CONFLICT(id) DO UPDATE SET \
                  enabled=excluded.enabled, schedule_enabled=excluded.schedule_enabled, deadline_enabled=excluded.deadline_enabled, \
                  overdue_enabled=excluded.overdue_enabled, quiet_hours_start=excluded.quiet_hours_start, quiet_hours_end=excluded.quiet_hours_end, \
                  web_browser_notifications_enabled=excluded.web_browser_notifications_enabled";
    let enabled_i64: i64 = config.enabled as i64;
    let schedule_i64: i64 = config.schedule_enabled as i64;
    let deadline_i64: i64 = config.deadline_enabled as i64;
    let overdue_i64: i64 = config.overdue_enabled as i64;
    let web_i64: i64 = config.web_browser_notifications_enabled as i64;
    let params: Vec<&dyn ToSql> = vec![
        &enabled_i64,
        &schedule_i64,
        &deadline_i64,
        &overdue_i64,
        &config.quiet_hours_start,
        &config.quiet_hours_end,
        &web_i64,
    ];
    exec.execute(sql, &params)?;
    Ok(())
}
