use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
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
            .map_err(|e| SyncError::Database(rusqlite::Error::SqliteFailure(rusqlite::ffi::Error {
                code: rusqlite::ffi::ErrorCode::CannotOpen,
                extended_code: 0,
            }, Some(e.to_string()))))?;
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
            Ok(vec![SyncMessage::PairingAck {
                server_client_id: client_id.to_string(),
                paired: true,
            }])
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
    
    let params: Vec<Box<dyn ToSql>> = ids.iter().map(|id| Box::new(id.clone()) as Box<dyn ToSql>).collect();
    let mut rows = stmt.query(rusqlite::params_from_iter(params))?;
    
    let mut result = Vec::new();
    
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        
        let version: i64 = row.get(n_cols - 3)?;
        let deleted_at: Option<i64> = row.get(n_cols - 2)?;
        let sync_updated_at: i64 = row.get(n_cols - 1)?;
        
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
    adapter.conn.execute("PRAGMA defer_foreign_keys = ON", [])?;
    let tx = adapter.conn.transaction()?;
    
    for (table, rows) in buffer.data.drain() {
        for row in rows {
            apply_lww_sync_raw(&tx, table, &row)?;
        }
    }
    
    tx.commit()?;
    buffer.received_batches.clear();
    buffer.expected_batches.clear();
    
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
    let query = format!(
        "SELECT version, updated_at, deleted_at FROM {} WHERE id = ?",
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
        let existing_deleted_at: Option<i64> = existing.get(2)?;
        
        let existing_key = (existing_version, existing_updated_at);
        let row_key = (row.version, row.updated_at);
        
        if row_key > existing_key {
            update_row_raw(conn, table_name, row)?;
        } else if row_key == existing_key {
            if row.deleted_at.is_some() || existing_deleted_at.is_some() {
                update_row_raw(conn, table_name, row)?;
            } else {
                update_row_raw(conn, table_name, row)?;
            }
        }
    } else {
        insert_row_raw(conn, table_name, row)?;
    }
    
    Ok(())
}

fn insert_row_raw(
    conn: &rusqlite::Connection,
    table_name: &str,
    row: &RowPayload,
) -> SyncResult<()> {
    let obj = row.data.as_object().ok_or(SyncError::InvalidData("RowPayload data is not an object".to_string()))?;
    let keys: Vec<String> = obj.keys().cloned().collect();
    let placeholders: Vec<String> = keys.iter().map(|_| "?".to_string()).collect();
    
    let query = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        table_name,
        keys.join(", "),
        placeholders.join(", ")
    );
    
    let params: Vec<Box<dyn ToSql>> = keys.iter()
        .map(|k| match &obj[k] {
            serde_json::Value::Null => Box::new("") as Box<dyn ToSql>,
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
        .filter(|(k, _)| **k != "id")
        .map(|(k, _)| format!("{} = ?", k))
        .collect();
    
    let query = format!(
        "UPDATE {} SET {} WHERE id = ?",
        table_name,
        set_clause.join(", ")
    );
    
    let keys: Vec<String> = obj.iter()
        .filter(|(k, _)| **k != "id")
        .map(|(k, _)| k.clone())
        .collect();
    
    let mut params: Vec<Box<dyn ToSql>> = keys.iter()
        .map(|k| match &obj[k] {
            serde_json::Value::Null => Box::new("") as Box<dyn ToSql>,
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
    fn add_batch(&mut self, table: SyncTable, rows: Vec<RowPayload>, batch_index: usize, total_batches: usize) -> SyncResult<bool> {
        *self.expected_batches.entry(table).or_insert(0) = total_batches;
        *self.received_batches.entry(table).or_insert(0) += 1;
        
        let entry = self.data.entry(table).or_insert_with(Vec::new);
        entry.extend(rows);
        
        Ok(self.is_complete())
    }

    fn add_batch_sync(&mut self, table: SyncTable, rows: Vec<RowPayload>, batch_index: usize, total_batches: usize) {
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
}
