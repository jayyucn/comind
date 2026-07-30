use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::task;
use serde_json::json;
use rusqlite::params;
use rusqlite::types::{ToSql, ValueRef};
use super::message::{SyncMessage, RowPayload, SyncTable, SyncError, SyncResult};

pub struct SyncEngine {
    client_id: String,
    db: Arc<Mutex<super::super::storage::sqlite::SQLiteAdapter>>,
    debounce_buffer: Arc<Mutex<DebounceBuffer>>,
    full_sync_buffer: Arc<Mutex<FullSyncBuffer>>,
}

struct DebounceBuffer {
    buffers: HashMap<SyncTable, HashMap<String, RowPayload>>,
}

struct FullSyncBuffer {
    data: HashMap<SyncTable, Vec<RowPayload>>,
    expected_batches: HashMap<SyncTable, usize>,
    received_batches: HashMap<SyncTable, usize>,
}

impl SyncEngine {
    pub fn new(client_id: String, db_path: &Path) -> SyncResult<Self> {
        let adapter = super::super::storage::sqlite::SQLiteAdapter::open(db_path)
            .map_err(|e| SyncError::Other(e.to_string()))?;
        Ok(Self {
            client_id,
            db: Arc::new(Mutex::new(adapter)),
            debounce_buffer: Arc::new(Mutex::new(DebounceBuffer {
                buffers: HashMap::new(),
            })),
            full_sync_buffer: Arc::new(Mutex::new(FullSyncBuffer {
                data: HashMap::new(),
                expected_batches: HashMap::new(),
                received_batches: HashMap::new(),
            })),
        })
    }

    pub async fn handle_message(&self, msg: SyncMessage) -> SyncResult<Vec<SyncMessage>> {
        let db = self.db.clone();
        let client_id = self.client_id.clone();
        let full_sync_buffer = self.full_sync_buffer.clone();

        task::spawn_blocking(move || {
            let mut adapter = db.blocking_lock();
            handle_message_sync(&mut adapter, &client_id, msg, &mut *full_sync_buffer.blocking_lock())
        }).await.unwrap_or_else(|e| Err(SyncError::Other(e.to_string())))
    }

    pub async fn on_local_change(&self, table: SyncTable, rows: Vec<RowPayload>) -> SyncResult<Vec<SyncMessage>> {
        let client_id = self.client_id.clone();
        let mut buffer = self.debounce_buffer.lock().await;

        for row in rows {
            buffer.record(table, row);
        }

        Ok(buffer.flush(&client_id))
    }

    pub async fn export_full(&self, table: SyncTable, batch_size: usize) -> SyncResult<Vec<SyncMessage>> {
        let db = self.db.clone();
        let client_id = self.client_id.clone();

        task::spawn_blocking(move || {
            let mut adapter = db.blocking_lock();
            export_full_sync(&mut adapter, &client_id, table, batch_size)
        }).await.unwrap_or_else(|e| Err(SyncError::Other(e.to_string())))
    }

    pub async fn import_full(&self, table: SyncTable, rows: Vec<RowPayload>, batch_index: usize, total_batches: usize) -> SyncResult<bool> {
        let mut buffer = self.full_sync_buffer.lock().await;
        buffer.add_batch(table, rows, batch_index, total_batches)
    }

    pub async fn commit_full_sync(&self) -> SyncResult<()> {
        let db = self.db.clone();
        let full_sync_buffer = self.full_sync_buffer.clone();

        task::spawn_blocking(move || {
            let mut adapter = db.blocking_lock();
            let mut buffer = full_sync_buffer.blocking_lock();
            commit_full_sync_sync(&mut adapter, &mut buffer)
        }).await.unwrap_or_else(|e| Err(SyncError::Other(e.to_string())))
    }

    pub async fn fetch_row_payloads(&self, table: SyncTable, ids: Vec<String>) -> SyncResult<Vec<RowPayload>> {
        let db = self.db.clone();

        task::spawn_blocking(move || {
            let mut adapter = db.blocking_lock();
            fetch_row_payloads_sync(&mut adapter, table, ids)
        }).await.unwrap_or_else(|e| Err(SyncError::Other(e.to_string())))
    }
}

fn handle_message_sync(
    adapter: &mut super::super::storage::sqlite::SQLiteAdapter,
    client_id: &str,
    msg: SyncMessage,
    full_sync_buffer: &mut FullSyncBuffer,
) -> SyncResult<Vec<SyncMessage>> {
    match msg {
        SyncMessage::RowChange { table, rows, client_id: sender_id } => {
            if sender_id == client_id {
                return Ok(vec![]);
            }
            for row in rows {
                apply_lww_sync(adapter, table, &row)?;
            }
            Ok(vec![])
        }
        SyncMessage::FullSyncRequest { client_id: _, last_sync_at: _ } => {
            let mut responses = Vec::new();
            for table in SyncTable::all() {
                let messages = export_full_sync(adapter, client_id, *table, 100)?;
                responses.extend(messages);
            }
            Ok(responses)
        }
        SyncMessage::FullSyncResponse { table, rows, batch_index, total_batches, client_id: _ } => {
            full_sync_buffer.add_batch_sync(table, rows, batch_index, total_batches);
            if full_sync_buffer.is_complete() {
                commit_full_sync_sync(adapter, full_sync_buffer)?;
            }
            Ok(vec![])
        }
        SyncMessage::Pairing { token: _, client_id: _, device_name: _ } => {
            // Pairing is handled by the Server layer (sync_server.rs) which has
            // access to token validation. Engine layer returns empty.
            Ok(vec![])
        }
        _ => Ok(vec![]),
    }
}

fn export_full_sync(
    adapter: &mut super::super::storage::sqlite::SQLiteAdapter,
    client_id: &str,
    table: SyncTable,
    batch_size: usize,
) -> SyncResult<Vec<SyncMessage>> {
    let table_name = table.as_str();
    let query = format!(
        "SELECT *, COALESCE(updated_at, created_at) as sync_updated_at FROM {} WHERE deleted_at IS NULL",
        table_name
    );

    let mut stmt = adapter.conn.prepare(&query)?;
    let n_cols = stmt.column_count();
    let col_names: Vec<String> = (0..n_cols)
        .map(|i| stmt.column_name(i).unwrap_or("unknown").to_string())
        .collect();

    let id_col = col_names.iter().position(|n| n == "id").ok_or(SyncError::InvalidData("id column not found".to_string()))?;
    let version_col = col_names.iter().position(|n| n == "version").ok_or(SyncError::InvalidData("version column not found".to_string()))?;
    let deleted_at_col = col_names.iter().position(|n| n == "deleted_at").ok_or(SyncError::InvalidData("deleted_at column not found".to_string()))?;
    let sync_updated_at_col = col_names.iter().position(|n| n == "sync_updated_at").ok_or(SyncError::InvalidData("sync_updated_at column not found".to_string()))?;

    let mut rows = stmt.query([])?;
    let mut all_rows = Vec::new();

    while let Some(row) = rows.next()? {
        let id: String = row.get(id_col)?;
        let version: i64 = row.get(version_col)?;
        let deleted_at: Option<i64> = row.get(deleted_at_col)?;
        let sync_updated_at: i64 = row.get(sync_updated_at_col)?;

        let mut data = json!({});
        for i in 0..n_cols {
            let name = &col_names[i];
            let value = match row.get_ref(i)? {
                ValueRef::Null => json!(null),
                ValueRef::Integer(v) => json!(v),
                ValueRef::Real(v) => json!(v),
                ValueRef::Text(v) => json!(String::from_utf8_lossy(v).to_string()),
                ValueRef::Blob(_) => json!(null),
            };
            data[name] = value;
        }

        all_rows.push(RowPayload {
            id,
            data,
            version,
            updated_at: sync_updated_at,
            deleted_at,
        });
    }

    let total_batches = (all_rows.len() + batch_size - 1) / batch_size;
    let mut messages = Vec::new();

    for (i, chunk) in all_rows.chunks(batch_size).enumerate() {
        messages.push(SyncMessage::FullSyncResponse {
            table,
            rows: chunk.to_vec(),
            batch_index: i,
            total_batches,
            client_id: client_id.to_string(),
        });
    }

    Ok(messages)
}

fn fetch_row_payloads_sync(
    adapter: &mut super::super::storage::sqlite::SQLiteAdapter,
    table: SyncTable,
    ids: Vec<String>,
) -> SyncResult<Vec<RowPayload>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let table_name = table.as_str();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let query = format!(
        "SELECT id, *, COALESCE(updated_at, created_at) as sync_updated_at FROM {} WHERE id IN ({})",
        table_name, placeholders
    );

    let mut stmt = adapter.conn.prepare(&query)?;
    let n_cols = stmt.column_count();
    let col_names: Vec<String> = (0..n_cols)
        .map(|i| stmt.column_name(i).unwrap_or("unknown").to_string())
        .collect();

    // Find columns by name (robust against column ordering shifts from `SELECT id, *`)
    let id_col = col_names.iter().position(|n| n == "id").ok_or(SyncError::InvalidData("id column not found".to_string()))?;
    let version_col = col_names.iter().position(|n| n == "version").ok_or(SyncError::InvalidData("version column not found".to_string()))?;
    let deleted_at_col = col_names.iter().position(|n| n == "deleted_at").ok_or(SyncError::InvalidData("deleted_at column not found".to_string()))?;
    let sync_updated_at_col = col_names.iter().position(|n| n == "sync_updated_at").ok_or(SyncError::InvalidData("sync_updated_at column not found".to_string()))?;

    let params: Vec<Box<dyn ToSql>> = ids.iter().map(|id| Box::new(id.clone()) as Box<dyn ToSql>).collect();
    let mut rows = stmt.query(rusqlite::params_from_iter(params))?;

    let mut result = Vec::new();

    while let Some(row) = rows.next()? {
        let id: String = row.get(id_col)?;
        let version: i64 = row.get(version_col)?;
        let deleted_at: Option<i64> = row.get(deleted_at_col)?;
        let sync_updated_at: i64 = row.get(sync_updated_at_col)?;

        let mut data = json!({});
        for i in 0..n_cols {
            let name = &col_names[i];
            let value = match row.get_ref(i)? {
                ValueRef::Null => json!(null),
                ValueRef::Integer(v) => json!(v),
                ValueRef::Real(v) => json!(v),
                ValueRef::Text(v) => json!(String::from_utf8_lossy(v).to_string()),
                ValueRef::Blob(_) => json!(null),
            };
            data[name] = value;
        }

        result.push(RowPayload {
            id,
            data,
            version,
            updated_at: sync_updated_at,
            deleted_at,
        });
    }

    Ok(result)
}

fn commit_full_sync_sync(
    adapter: &mut super::super::storage::sqlite::SQLiteAdapter,
    buffer: &mut FullSyncBuffer,
) -> SyncResult<()> {
    // Debug: dump buffer state
    eprintln!("[sync] commit_full_sync_sync: tables in buffer = {:?}", buffer.data.keys().collect::<Vec<_>>());
    for (t, rows) in &buffer.data {
        eprintln!("[sync]   {:?}: {} rows", t, rows.len());
        for r in rows {
            eprintln!("[sync]     id={}, version={}, updated_at={}", r.id, r.version, r.updated_at);
        }
    }

    // First attempt: with deferred FK checks (preserves referential integrity)
    adapter.conn.execute_batch("PRAGMA defer_foreign_keys = ON")?;
    let tx = adapter.conn.transaction()?;

    for table in SyncTable::all() {
        if let Some(rows) = buffer.data.get(table) {
            for row in rows {
                let _ = apply_lww_sync_raw(&tx, *table, row);
            }
        }
    }

    match tx.commit() {
        Ok(()) => {
            eprintln!("[sync] first commit OK");
            buffer.received_batches.clear();
            buffer.expected_batches.clear();
            buffer.data.clear();
            return Ok(());
        }
        Err(e) => {
            eprintln!("[sync] first commit FAILED: {}", e);
            // FK constraints failed at commit (cross-device id conflicts).
            // Fall through to per-table approach with FK disabled.
        }
    }

    // Second attempt: disable FK enforcement, apply per-table in separate transactions.
    // This allows partial sync — tables without FK issues succeed.
    adapter.conn.execute_batch("PRAGMA foreign_keys = OFF")?;

    for table in SyncTable::all() {
        if let Some(rows) = buffer.data.remove(table) {
            eprintln!("[sync] second attempt: table={:?}, {} rows", table, rows.len());
            let tx = adapter.conn.transaction()?;
            for row in &rows {
                let _ = apply_lww_sync_raw(&tx, *table, row);
            }
            // Best-effort commit per table
            match tx.commit() {
                Ok(()) => eprintln!("[sync]   table {:?} commit OK", table),
                Err(e) => eprintln!("[sync]   table {:?} commit FAILED: {}", table, e),
            }
        }
    }

    adapter.conn.execute_batch("PRAGMA foreign_keys = ON")?;
    buffer.received_batches.clear();
    buffer.expected_batches.clear();
    buffer.data.clear();

    Ok(())
}

fn apply_lww_sync(
    adapter: &mut super::super::storage::sqlite::SQLiteAdapter,
    table: SyncTable,
    row: &RowPayload,
) -> SyncResult<()> {
    apply_lww_sync_raw(&adapter.conn, table, row)
}

fn apply_lww_sync_raw(
    conn: &rusqlite::Connection,
    table: SyncTable,
    row: &RowPayload,
) -> SyncResult<()> {
    let table_name = table.as_str();
    eprintln!("[sync] apply_lww: table={}, id={}, version={}, updated_at={}", table_name, row.id, row.version, row.updated_at);
    let query = format!(
        "SELECT version, updated_at, deleted_at FROM \"{}\" WHERE id = ?",
        table_name
    );

    let mut stmt = conn.prepare(&query)?;
    let mut rows = stmt.query(params![row.id])?;

    if let Some(existing) = rows.next()? {
        let existing_version: i64 = existing.get(0)?;
        let existing_updated_at: i64 = match existing.get(1) {
            Ok(val) => val,
            Err(_) => 0,
        };
        let _existing_deleted_at: Option<i64> = existing.get(2)?;

        let existing_key = (existing_version, existing_updated_at);
        let row_key = (row.version, row.updated_at);
        eprintln!("[sync]   existing: version={}, updated_at={}, incoming: version={}, updated_at={}", existing_version, existing_updated_at, row.version, row.updated_at);

        if row_key > existing_key {
            // Incoming row is newer - apply update
            eprintln!("[sync]   UPDATE (incoming newer)");
            if let Err(e) = update_row_raw(conn, table_name, row) {
                eprintln!("[sync]   UPDATE failed: {}", e);
                let _ = e;
            }
        } else {
            eprintln!("[sync]   SKIP (incoming stale or equal)");
        }
    } else {
        // Disable FK checks during insert to avoid ordering issues
        conn.execute_batch("PRAGMA defer_foreign_keys = ON")?;
        eprintln!("[sync]   INSERT (new row)");
        match insert_row_raw(conn, table_name, row) {
            Ok(()) => { eprintln!("[sync]   INSERT OK"); }
            Err(e) => {
                eprintln!("[sync]   INSERT failed: {}, trying INSERT OR REPLACE", e);
                // INSERT failed (likely UNIQUE constraint on non-id column).
                // Try INSERT OR REPLACE to handle cross-device id conflicts
                // (e.g., journal pages with same title but different ids).
                if let Err(e2) = insert_or_replace_row_raw(conn, table_name, row) {
                    eprintln!("[sync]   INSERT OR REPLACE also failed: {}", e2);
                } else {
                    eprintln!("[sync]   INSERT OR REPLACE OK");
                }
            }
        }
    }

    Ok(())
}

fn insert_or_replace_row_raw(
    conn: &rusqlite::Connection,
    table_name: &str,
    row: &RowPayload,
) -> SyncResult<()> {
    let obj = row.data.as_object().ok_or(SyncError::InvalidData("RowPayload data is not an object".to_string()))?;
    let keys: Vec<String> = obj.keys().filter(|k| *k != "sync_updated_at").cloned().collect();
    let quoted_keys: Vec<String> = keys.iter().map(|k| format!("\"{}\"", k)).collect();
    let placeholders: Vec<String> = keys.iter().map(|_| "?".to_string()).collect();

    let query = format!(
        "INSERT OR REPLACE INTO \"{}\" ({}) VALUES ({})",
        table_name,
        quoted_keys.join(", "),
        placeholders.join(", ")
    );

    let params: Vec<Box<dyn ToSql>> = keys.iter()
        .map(|k| match &obj[k] {
            serde_json::Value::Null => Box::new(Option::<String>::None) as Box<dyn ToSql>,
            serde_json::Value::Bool(v) => Box::new(*v) as Box<dyn ToSql>,
            serde_json::Value::Number(v) => {
                if let Some(v) = v.as_i64() {
                    Box::new(v) as Box<dyn ToSql>
                } else if let Some(v) = v.as_f64() {
                    Box::new(v) as Box<dyn ToSql>
                } else {
                    Box::new(0i64) as Box<dyn ToSql>
                }
            }
            serde_json::Value::String(v) => Box::new(v.clone()) as Box<dyn ToSql>,
            serde_json::Value::Array(_) => Box::new("") as Box<dyn ToSql>,
            serde_json::Value::Object(_) => Box::new("") as Box<dyn ToSql>,
        })
        .collect();

    conn.execute(&query, rusqlite::params_from_iter(params))?;
    Ok(())
}

fn insert_row_raw(
    conn: &rusqlite::Connection,
    table_name: &str,
    row: &RowPayload,
) -> SyncResult<()> {
    let obj = row.data.as_object().ok_or(SyncError::InvalidData("RowPayload data is not an object".to_string()))?;
    let keys: Vec<String> = obj.keys().filter(|k| *k != "sync_updated_at").cloned().collect();
    let quoted_keys: Vec<String> = keys.iter().map(|k| format!("\"{}\"", k)).collect();
    let placeholders: Vec<String> = keys.iter().map(|_| "?".to_string()).collect();

    let query = format!(
        "INSERT INTO \"{}\" ({}) VALUES ({})",
        table_name,
        quoted_keys.join(", "),
        placeholders.join(", ")
    );

    let params: Vec<Box<dyn ToSql>> = keys.iter()
        .map(|k| match &obj[k] {
            serde_json::Value::Null => Box::new(Option::<String>::None) as Box<dyn ToSql>,
            serde_json::Value::Bool(v) => Box::new(*v) as Box<dyn ToSql>,
            serde_json::Value::Number(v) => {
                if let Some(v) = v.as_i64() {
                    Box::new(v) as Box<dyn ToSql>
                } else if let Some(v) = v.as_f64() {
                    Box::new(v) as Box<dyn ToSql>
                } else {
                    Box::new(0i64) as Box<dyn ToSql>
                }
            }
            serde_json::Value::String(v) => Box::new(v.clone()) as Box<dyn ToSql>,
            serde_json::Value::Array(_) => Box::new("") as Box<dyn ToSql>,
            serde_json::Value::Object(_) => Box::new("") as Box<dyn ToSql>,
        })
        .collect();

    conn.execute(&query, rusqlite::params_from_iter(params))?;
    Ok(())
}

fn update_row_raw(
    conn: &rusqlite::Connection,
    table_name: &str,
    row: &RowPayload,
) -> SyncResult<()> {
    let obj = row.data.as_object().ok_or(SyncError::InvalidData("RowPayload data is not an object".to_string()))?;
    let set_clause: Vec<String> = obj.iter()
        .filter(|(k, _)| **k != "id" && **k != "sync_updated_at")
        .map(|(k, _)| format!("\"{}\" = ?", k))
        .collect();

    let query = format!(
        "UPDATE \"{}\" SET {} WHERE id = ?",
        table_name,
        set_clause.join(", ")
    );

    let keys: Vec<String> = obj.iter()
        .filter(|(k, _)| **k != "id" && **k != "sync_updated_at")
        .map(|(k, _)| k.clone())
        .collect();

    let mut params: Vec<Box<dyn ToSql>> = keys.iter()
        .map(|k| match &obj[k] {
            serde_json::Value::Null => Box::new(Option::<String>::None) as Box<dyn ToSql>,
            serde_json::Value::Bool(v) => Box::new(*v) as Box<dyn ToSql>,
            serde_json::Value::Number(v) => {
                if let Some(v) = v.as_i64() {
                    Box::new(v) as Box<dyn ToSql>
                } else if let Some(v) = v.as_f64() {
                    Box::new(v) as Box<dyn ToSql>
                } else {
                    Box::new(0i64) as Box<dyn ToSql>
                }
            }
            serde_json::Value::String(v) => Box::new(v.clone()) as Box<dyn ToSql>,
            serde_json::Value::Array(_) => Box::new("") as Box<dyn ToSql>,
            serde_json::Value::Object(_) => Box::new("") as Box<dyn ToSql>,
        })
        .collect();

    params.push(Box::new(row.id.clone()) as Box<dyn ToSql>);

    conn.execute(&query, rusqlite::params_from_iter(params))?;
    Ok(())
}

impl DebounceBuffer {
    fn record(&mut self, table: SyncTable, row: RowPayload) {
        let entry = self.buffers.entry(table).or_insert_with(HashMap::new);
        entry.insert(row.id.clone(), row);
    }

    fn flush(&mut self, client_id: &str) -> Vec<SyncMessage> {
        if self.buffers.is_empty() {
            return Vec::new();
        }

        let mut messages = Vec::new();
        for (table, rows) in self.buffers.drain() {
            messages.push(SyncMessage::RowChange {
                table,
                rows: rows.into_values().collect(),
                client_id: client_id.to_string(),
            });
        }

        messages
    }
}

impl FullSyncBuffer {
    fn add_batch(&mut self, table: SyncTable, rows: Vec<RowPayload>, _batch_index: usize, total_batches: usize) -> SyncResult<bool> {
        *self.expected_batches.entry(table).or_insert(0) = total_batches;
        *self.received_batches.entry(table).or_insert(0) += 1;

        let entry = self.data.entry(table).or_insert_with(Vec::new);
        entry.extend(rows);

        Ok(self.is_complete())
    }

    fn add_batch_sync(&mut self, table: SyncTable, rows: Vec<RowPayload>, _batch_index: usize, total_batches: usize) {
        *self.expected_batches.entry(table).or_insert(0) = total_batches;
        *self.received_batches.entry(table).or_insert(0) += 1;

        let entry = self.data.entry(table).or_insert_with(Vec::new);
        entry.extend(rows);
    }

    fn is_complete(&self) -> bool {
        self.expected_batches.iter().all(|(table, expected)| {
            self.received_batches.get(table) == Some(expected)
        }) && !self.expected_batches.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_engine() -> SyncEngine {
        SyncEngine::new("test-client".to_string(), std::path::Path::new(":memory:")).unwrap()
    }

    #[tokio::test]
    async fn test_message_serialization() {
        let message = SyncMessage::RowChange {
            table: SyncTable::Block,
            rows: vec![RowPayload {
                id: "test-id".to_string(),
                data: serde_json::json!({"content": "test"}),
                version: 1,
                updated_at: 1000,
                deleted_at: None,
            }],
            client_id: "client-1".to_string(),
        };

        let json = serde_json::to_string(&message).unwrap();
        let deserialized: SyncMessage = serde_json::from_str(&json).unwrap();

        match deserialized {
            SyncMessage::RowChange { table, rows, client_id } => {
                assert_eq!(table, SyncTable::Block);
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].id, "test-id");
                assert_eq!(client_id, "client-1");
            }
            _ => panic!("Expected RowChange"),
        }
    }

    #[tokio::test]
    async fn test_full_sync_export_empty() {
        let engine = create_test_engine();

        for &table in SyncTable::all() {
            let result = engine.export_full(table, 100).await;
            assert!(result.is_ok());
        }
    }

    #[tokio::test]
    async fn test_lww_incoming_newer_updates_existing() {
        let engine = create_test_engine();

        // 先插入 Page（Block 有外键约束）
        let page_row = RowPayload {
            id: "page-1".to_string(),
            data: serde_json::json!({
                "id": "page-1",
                "title": "Test Page",
                "version": 1,
                "created_at": 1000i64,
                "updated_at": 1000i64,
                "deleted_at": serde_json::Value::Null,
            }),
            version: 1,
            updated_at: 1000,
            deleted_at: None,
        };

        let page_msg = SyncMessage::RowChange {
            table: SyncTable::Page,
            rows: vec![page_row],
            client_id: "remote-client".to_string(),
        };

        engine.handle_message(page_msg).await.unwrap();

        // 插入初始 block
        let initial_row = RowPayload {
            id: "block-1".to_string(),
            data: serde_json::json!({
                "id": "block-1",
                "page_id": "page-1",
                "content": "initial content",
                "type": "text",
                "version": 1,
                "created_at": 1000i64,
                "updated_at": 1000i64,
                "deleted_at": serde_json::Value::Null,
            }),
            version: 1,
            updated_at: 1000,
            deleted_at: None,
        };

        let msg = SyncMessage::RowChange {
            table: SyncTable::Block,
            rows: vec![initial_row.clone()],
            client_id: "remote-client".to_string(),
        };

        engine.handle_message(msg.clone()).await.unwrap();

        // 发送更新（version 更高，updated_at 更新）
        let updated_row = RowPayload {
            id: "block-1".to_string(),
            data: serde_json::json!({
                "id": "block-1",
                "page_id": "page-1",
                "content": "updated content",
                "type": "text",
                "version": 2,
                "created_at": 1000i64,
                "updated_at": 2000i64,
                "deleted_at": serde_json::Value::Null,
            }),
            version: 2,
            updated_at: 2000,
            deleted_at: None,
        };

        let update_msg = SyncMessage::RowChange {
            table: SyncTable::Block,
            rows: vec![updated_row],
            client_id: "remote-client".to_string(),
        };

        engine.handle_message(update_msg).await.unwrap();

        // 验证更新被应用
        let fetched = engine.fetch_row_payloads(SyncTable::Block, vec!["block-1".to_string()]).await.unwrap();
        assert_eq!(fetched.len(), 1);
        assert_eq!(fetched[0].version, 2);
        assert_eq!(fetched[0].updated_at, 2000);
    }

    #[tokio::test]
    async fn test_lww_incoming_older_is_ignored() {
        let engine = create_test_engine();

        // 先插入 Page
        let page_row = RowPayload {
            id: "page-1".to_string(),
            data: serde_json::json!({
                "id": "page-1",
                "title": "Test Page",
                "version": 1,
                "created_at": 1000i64,
                "updated_at": 1000i64,
                "deleted_at": serde_json::Value::Null,
            }),
            version: 1,
            updated_at: 1000,
            deleted_at: None,
        };

        let page_msg = SyncMessage::RowChange {
            table: SyncTable::Page,
            rows: vec![page_row],
            client_id: "remote-client".to_string(),
        };

        engine.handle_message(page_msg).await.unwrap();

        // 先插入较新的数据
        let newer_row = RowPayload {
            id: "block-2".to_string(),
            data: serde_json::json!({
                "id": "block-2",
                "page_id": "page-1",
                "content": "newer content",
                "type": "text",
                "version": 3,
                "created_at": 1000i64,
                "updated_at": 3000i64,
                "deleted_at": serde_json::Value::Null,
            }),
            version: 3,
            updated_at: 3000,
            deleted_at: None,
        };

        let msg = SyncMessage::RowChange {
            table: SyncTable::Block,
            rows: vec![newer_row],
            client_id: "remote-client".to_string(),
        };

        engine.handle_message(msg).await.unwrap();

        // 尝试发送较旧的数据
        let older_row = RowPayload {
            id: "block-2".to_string(),
            data: serde_json::json!({
                "id": "block-2",
                "page_id": "page-1",
                "content": "older content - should be ignored",
                "type": "text",
                "version": 1,
                "created_at": 500i64,
                "updated_at": 500i64,
                "deleted_at": serde_json::Value::Null,
            }),
            version: 1,
            updated_at: 500,
            deleted_at: None,
        };

        let old_msg = SyncMessage::RowChange {
            table: SyncTable::Block,
            rows: vec![older_row],
            client_id: "remote-client".to_string(),
        };

        engine.handle_message(old_msg).await.unwrap();

        // 验证旧数据未覆盖新数据
        let fetched = engine.fetch_row_payloads(SyncTable::Block, vec!["block-2".to_string()]).await.unwrap();
        assert_eq!(fetched.len(), 1);
        assert_eq!(fetched[0].version, 3);
        assert_eq!(fetched[0].updated_at, 3000);
    }

    #[tokio::test]
    async fn test_lww_version_equal_timestamp_wins() {
        let engine = create_test_engine();

        // 先插入 Page
        let page_row = RowPayload {
            id: "page-1".to_string(),
            data: serde_json::json!({
                "id": "page-1",
                "title": "Test Page",
                "version": 1,
                "created_at": 1000i64,
                "updated_at": 1000i64,
                "deleted_at": serde_json::Value::Null,
            }),
            version: 1,
            updated_at: 1000,
            deleted_at: None,
        };

        let page_msg = SyncMessage::RowChange {
            table: SyncTable::Page,
            rows: vec![page_row],
            client_id: "remote-client".to_string(),
        };

        engine.handle_message(page_msg).await.unwrap();

        // 插入初始数据
        let row1 = RowPayload {
            id: "block-3".to_string(),
            data: serde_json::json!({
                "id": "block-3",
                "page_id": "page-1",
                "content": "version 1",
                "type": "text",
                "version": 2,
                "created_at": 1000i64,
                "updated_at": 1000i64,
                "deleted_at": serde_json::Value::Null,
            }),
            version: 2,
            updated_at: 1000,
            deleted_at: None,
        };

        let msg = SyncMessage::RowChange {
            table: SyncTable::Block,
            rows: vec![row1],
            client_id: "remote-client".to_string(),
        };

        engine.handle_message(msg).await.unwrap();

        // 发送相同 version 但更高 updated_at 的数据
        let row2 = RowPayload {
            id: "block-3".to_string(),
            data: serde_json::json!({
                "id": "block-3",
                "page_id": "page-1",
                "content": "version 2 with later timestamp",
                "type": "text",
                "version": 2,
                "created_at": 1000i64,
                "updated_at": 2000i64,
                "deleted_at": serde_json::Value::Null,
            }),
            version: 2,
            updated_at: 2000,
            deleted_at: None,
        };

        let msg2 = SyncMessage::RowChange {
            table: SyncTable::Block,
            rows: vec![row2],
            client_id: "remote-client".to_string(),
        };

        engine.handle_message(msg2).await.unwrap();

        // 验证时间戳更高的数据被应用
        let fetched = engine.fetch_row_payloads(SyncTable::Block, vec!["block-3".to_string()]).await.unwrap();
        assert_eq!(fetched.len(), 1);
        assert_eq!(fetched[0].updated_at, 2000);
    }

    #[tokio::test]
    async fn test_debounce_buffer_aggregates_changes() {
        let engine = create_test_engine();

        // 记录本地变更
        let row1 = RowPayload {
            id: "block-4".to_string(),
            data: serde_json::json!({"content": "change1"}),
            version: 1,
            updated_at: 1000,
            deleted_at: None,
        };

        let row2 = RowPayload {
            id: "block-5".to_string(),
            data: serde_json::json!({"content": "change2"}),
            version: 1,
            updated_at: 1000,
            deleted_at: None,
        };

        let messages = engine.on_local_change(SyncTable::Block, vec![row1, row2]).await.unwrap();

        // 应该产生一条聚合消息
        assert_eq!(messages.len(), 1);
        match &messages[0] {
            SyncMessage::RowChange { table, rows, client_id } => {
                assert_eq!(*table, SyncTable::Block);
                assert_eq!(rows.len(), 2);
                assert_eq!(client_id, "test-client");
            }
            _ => panic!("Expected RowChange message"),
        }
    }

    #[tokio::test]
    async fn test_full_sync_buffer_completes_on_all_batches() {
        let mut buffer = FullSyncBuffer {
            data: HashMap::new(),
            expected_batches: HashMap::new(),
            received_batches: HashMap::new(),
        };

        // 模拟接收全量同步的批次
        let row = RowPayload {
            id: "block-6".to_string(),
            data: serde_json::json!({"content": "sync"}),
            version: 1,
            updated_at: 1000,
            deleted_at: None,
        };

        // 总共 3 批，已接收 3 批
        buffer.add_batch(SyncTable::Block, vec![row.clone()], 0, 3).unwrap();
        assert!(!buffer.is_complete());

        buffer.add_batch(SyncTable::Block, vec![row.clone()], 1, 3).unwrap();
        assert!(!buffer.is_complete());

        buffer.add_batch(SyncTable::Block, vec![row], 2, 3).unwrap();
        assert!(buffer.is_complete());
    }

    #[tokio::test]
    async fn test_ignores_own_messages() {
        let engine = create_test_engine();

        // 先插入 Page
        let page_row = RowPayload {
            id: "page-1".to_string(),
            data: serde_json::json!({
                "id": "page-1",
                "title": "Test Page",
                "version": 1,
                "created_at": 1000i64,
                "updated_at": 1000i64,
                "deleted_at": serde_json::Value::Null,
            }),
            version: 1,
            updated_at: 1000,
            deleted_at: None,
        };

        let page_msg = SyncMessage::RowChange {
            table: SyncTable::Page,
            rows: vec![page_row],
            client_id: "remote-client".to_string(),
        };

        engine.handle_message(page_msg).await.unwrap();

        let row = RowPayload {
            id: "block-7".to_string(),
            data: serde_json::json!({
                "id": "block-7",
                "page_id": "page-1",
                "content": "should be ignored",
                "type": "text",
                "version": 1,
                "created_at": 1000i64,
                "updated_at": 1000i64,
                "deleted_at": serde_json::Value::Null,
            }),
            version: 1,
            updated_at: 1000,
            deleted_at: None,
        };

        // 发送来自自己的消息（client_id 匹配 engine 的 client_id）
        let msg = SyncMessage::RowChange {
            table: SyncTable::Block,
            rows: vec![row],
            client_id: "test-client".to_string(), // 匹配 engine 的 client_id
        };

        engine.handle_message(msg).await.unwrap();

        // 验证数据未被应用（因为来自自己）
        let fetched = engine.fetch_row_payloads(SyncTable::Block, vec!["block-7".to_string()]).await.unwrap();
        assert_eq!(fetched.len(), 0);
    }
}
