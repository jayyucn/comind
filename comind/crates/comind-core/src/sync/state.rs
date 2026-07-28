use rusqlite::{Connection, params};
use std::error::Error;

pub struct SyncState {
    pub client_id: String,
    pub peer_device_name: String,
    pub last_sync_at: i64,
    pub last_sync_type: Option<String>,
    pub paired_at: Option<i64>,
    pub is_paired: bool,
    pub last_seen_at: Option<i64>,
    /// 对端 WebSocket 地址（用于 Android 端重启后自动重连）
    pub ws_url: Option<String>,
}

pub struct SyncStateRepository;

impl SyncStateRepository {
    pub fn create_table(conn: &Connection) -> Result<(), Box<dyn Error>> {
        conn.execute(
            r#"CREATE TABLE IF NOT EXISTS SyncState (
                client_id        TEXT PRIMARY KEY,
                peer_device_name TEXT,
                last_sync_at     INTEGER NOT NULL DEFAULT 0,
                last_sync_type   TEXT,
                paired_at        INTEGER,
                is_paired         INTEGER NOT NULL DEFAULT 0,
                last_seen_at     INTEGER,
                ws_url           TEXT
            )"#,
            [],
        )?;
        Ok(())
    }

    pub fn insert_or_update(
        conn: &Connection,
        state: &SyncState,
    ) -> Result<(), Box<dyn Error>> {
        conn.execute(
            r#"INSERT OR REPLACE INTO SyncState (
                client_id,
                peer_device_name,
                last_sync_at,
                last_sync_type,
                paired_at,
                is_paired,
                last_seen_at,
                ws_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
            params![
                state.client_id,
                state.peer_device_name,
                state.last_sync_at,
                state.last_sync_type.as_deref(),
                state.paired_at,
                state.is_paired as i32,
                state.last_seen_at,
                state.ws_url.as_deref()
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, client_id: &str) -> Result<Option<SyncState>, Box<dyn Error>> {
        let mut stmt = conn.prepare(
            r#"SELECT client_id, peer_device_name, last_sync_at, last_sync_type, paired_at, is_paired, last_seen_at, ws_url
               FROM SyncState WHERE client_id = ?"#,
        )?;
        let mut rows = stmt.query(params![client_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(SyncState {
                client_id: row.get(0)?,
                peer_device_name: row.get(1)?,
                last_sync_at: row.get(2)?,
                last_sync_type: row.get(3)?,
                paired_at: row.get(4)?,
                is_paired: row.get::<_, i32>(5)? != 0,
                last_seen_at: row.get(6)?,
                ws_url: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_all(conn: &Connection) -> Result<Vec<SyncState>, Box<dyn Error>> {
        let mut stmt = conn.prepare(
            r#"SELECT client_id, peer_device_name, last_sync_at, last_sync_type, paired_at, is_paired, last_seen_at, ws_url
               FROM SyncState"#,
        )?;
        let mut rows = stmt.query([])?;
        let mut results = Vec::new();
        while let Some(row) = rows.next()? {
            results.push(SyncState {
                client_id: row.get(0)?,
                peer_device_name: row.get(1)?,
                last_sync_at: row.get(2)?,
                last_sync_type: row.get(3)?,
                paired_at: row.get(4)?,
                is_paired: row.get::<_, i32>(5)? != 0,
                last_seen_at: row.get(6)?,
                ws_url: row.get(7)?,
            });
        }
        Ok(results)
    }

    pub fn delete(conn: &Connection, client_id: &str) -> Result<(), Box<dyn Error>> {
        conn.execute("DELETE FROM SyncState WHERE client_id = ?", params![client_id])?;
        Ok(())
    }

    pub fn set_paired(
        conn: &Connection,
        client_id: &str,
        paired: bool,
        paired_at: Option<i64>,
    ) -> Result<(), Box<dyn Error>> {
        conn.execute(
            "UPDATE SyncState SET is_paired = ?, paired_at = ? WHERE client_id = ?",
            params![paired as i32, paired_at, client_id],
        )?;
        Ok(())
    }

    pub fn update_last_sync(
        conn: &Connection,
        client_id: &str,
        last_sync_at: i64,
        sync_type: &str,
    ) -> Result<(), Box<dyn Error>> {
        conn.execute(
            "UPDATE SyncState SET last_sync_at = ?, last_sync_type = ? WHERE client_id = ?",
            params![last_sync_at, sync_type, client_id],
        )?;
        Ok(())
    }

    pub fn update_last_seen(conn: &Connection, client_id: &str, last_seen_at: i64) -> Result<(), Box<dyn Error>> {
        conn.execute(
            "UPDATE SyncState SET last_seen_at = ? WHERE client_id = ?",
            params![last_seen_at, client_id],
        )?;
        Ok(())
    }

    /// 幂等迁移：为旧库 SyncState 表添加 ws_url 列
    pub fn migrate_add_ws_url(conn: &Connection) -> Result<(), Box<dyn Error>> {
        let has_column: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('SyncState') WHERE name = 'ws_url'",
            [],
            |row| row.get::<_, i64>(0),
        ).map(|c| c > 0).unwrap_or(false);
        if !has_column {
            conn.execute("ALTER TABLE SyncState ADD COLUMN ws_url TEXT", [])?;
        }
        Ok(())
    }
}
