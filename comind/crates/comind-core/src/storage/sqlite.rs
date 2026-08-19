use std::error::Error;
use std::path::Path;
use rusqlite::{Connection, params};
use super::super::types::*;
use super::repository::*;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::entity::date_ref::{date_ref_create, date_ref_create_many, date_ref_delete, date_ref_delete_by_block_id, date_ref_get_all, date_ref_get_by_block_id, date_ref_get_by_id, date_ref_query_all_recurring, date_ref_query_by_date_range, date_ref_query_due_non_recurring, date_ref_query_overdue};
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::entity::block::{block_get_all, block_get_by_id, block_get_by_page_id, block_get_children, block_get_by_ids, block_insert, block_update, block_soft_delete_by_id, block_ids_by_page_id, block_soft_delete_by_page_id};
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::entity::page::{page_get_by_id, page_get_by_title_including_deleted, page_get_by_title, page_get_all, page_get_trash, page_get_by_ids, page_get_ideas_by_month, page_get_ideas_months, page_create, page_update, page_delete};
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::entity::link::{link_get_by_id, link_get_by_source_block_id, link_get_by_source_block_ids, link_get_by_target_page_id, link_insert, link_create_many, link_delete, link_delete_by_source_block_id, link_delete_by_target_page_id};
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::entity::property::{property_create, property_delete, property_delete_by_block_id, property_get_all, property_get_by_block_id, property_get_by_block_id_and_key, property_get_by_block_ids, property_get_by_id, property_query_block_ids_by_key_value, property_update, property_upsert};
use crate::storage::entity::relationship_type::{relationship_type_create, relationship_type_delete, relationship_type_get_all, relationship_type_get_by_id, relationship_type_get_by_type, relationship_type_update};
use crate::storage::entity::template::{template_create, template_delete, template_get_all, template_get_by_id, template_get_by_name, template_update};
use crate::storage::entity::search::{search_index_delete, search_index_search, search_index_upsert};
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::entity::block_version::{block_version_create, block_version_delete, block_version_delete_by_block_id, block_version_delete_older_than, block_version_get_by_block_id, block_version_get_by_id, block_version_get_latest_version};
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::entity::notification::{notification_batch_create, notification_create, notification_delete, notification_delete_by_block_and_kind, notification_delete_by_block_id, notification_delete_older_than, notification_find_by_event, notification_get_by_block_id, notification_get_by_block_ids, notification_get_by_id, notification_mark_all_read, notification_query_pending_due, notification_query_recent, notification_query_unread, notification_reschedule, notification_set_snooze, notification_update_payload, notification_update_status};
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::entity::saved_filter::{saved_filter_create, saved_filter_delete, saved_filter_get_all, saved_filter_get_by_id, saved_filter_update};
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::entity::screen_view::{screen_view_create, screen_view_delete, screen_view_get_all_by_entity, screen_view_get_by_id, screen_view_update};
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::entity::notification_config::{notification_config_get, notification_config_save};

pub struct SQLiteAdapter {
    pub conn: Connection,
}

impl SQLiteAdapter {
    pub fn open(path: &Path) -> Result<Self, Box<dyn Error>> {
        let conn = Connection::open(path)?;
        
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;"
        )?;
        
        Self::init_schema(&conn)?;
        
        Ok(Self { conn })
    }

    /// 只读连接：跳过 `init_schema`（CREATE TABLE 是 DDL，需要写锁；
    /// 在并发写入者存在时会触发 busy_timeout 干等）。用于「读已存在表」的旁路查询，
    /// 配合 WAL 可与写入者并发，不被写锁饿死。
    pub fn open_readonly(path: &Path) -> Result<Self, Box<dyn Error>> {
        let conn = Connection::open(path)?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;"
        )?;

        Ok(Self { conn })
    }

    pub fn open_in_memory() -> Result<Self, Box<dyn Error>> {
        let conn = Connection::open_in_memory()?;
        
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;"
        )?;
        
        Self::init_schema(&conn)?;
        
        Ok(Self { conn })
    }
    
    fn init_schema(conn: &Connection) -> Result<(), Box<dyn Error>> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS Page (
                id              TEXT PRIMARY KEY,
                block_id        TEXT,
                title           TEXT NOT NULL UNIQUE,
                type            TEXT NOT NULL DEFAULT 'normal',
                icon            TEXT,
                cover           TEXT,
                aliases         TEXT NOT NULL DEFAULT '[]',
                file_path       TEXT,
                children_count  INTEGER NOT NULL DEFAULT 0,
                word_count      INTEGER NOT NULL DEFAULT 0,
                deleted         INTEGER NOT NULL DEFAULT 0,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL,
                version         INTEGER NOT NULL DEFAULT 0,
                deleted_at      INTEGER,
                FOREIGN KEY (block_id) REFERENCES Block(id)
            );
            
            CREATE TABLE IF NOT EXISTS Block (
                id              TEXT PRIMARY KEY,
                page_id         TEXT NOT NULL,
                parent_id       TEXT,
                pos             INTEGER NOT NULL DEFAULT 1000,
                content         TEXT NOT NULL DEFAULT '',
                format          TEXT NOT NULL DEFAULT '{}',
                type            TEXT NOT NULL DEFAULT 'bullet',
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL,
                version         INTEGER NOT NULL DEFAULT 0,
                deleted_at      INTEGER,
                FOREIGN KEY (page_id) REFERENCES Page(id)
            );
            
            CREATE TABLE IF NOT EXISTS Link (
                id              TEXT PRIMARY KEY,
                source_block_id TEXT NOT NULL,
                target_page_id  TEXT NOT NULL,
                display_text    TEXT NOT NULL,
                relationship_type TEXT,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL,
                version         INTEGER NOT NULL DEFAULT 0,
                deleted_at      INTEGER,
                FOREIGN KEY (source_block_id) REFERENCES Block(id),
                FOREIGN KEY (target_page_id) REFERENCES Page(id)
            );
            
            CREATE TABLE IF NOT EXISTS Property (
                id              TEXT PRIMARY KEY,
                block_id        TEXT NOT NULL,
                key             TEXT NOT NULL,
                value           TEXT NOT NULL,
                type            TEXT NOT NULL,
                sort_order      INTEGER NOT NULL DEFAULT 0,
                is_hidden       INTEGER NOT NULL DEFAULT 0,
                is_deleted      INTEGER NOT NULL DEFAULT 0,
                schema_version  INTEGER NOT NULL DEFAULT 1,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL,
                version         INTEGER NOT NULL DEFAULT 0,
                deleted_at      INTEGER,
                UNIQUE(block_id, key),
                FOREIGN KEY (block_id) REFERENCES Block(id)
            );
            
            CREATE TABLE IF NOT EXISTS RelationshipType (
                id              TEXT PRIMARY KEY,
                type            TEXT NOT NULL,
                inverse         TEXT,
                label           TEXT NOT NULL,
                inverse_label   TEXT NOT NULL,
                color           TEXT NOT NULL,
                `order`           INTEGER NOT NULL DEFAULT 0,
                strength        TEXT NOT NULL DEFAULT 'medium',
                deleted         INTEGER NOT NULL DEFAULT 0,
                builtin         INTEGER NOT NULL DEFAULT 1,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL,
                version         INTEGER NOT NULL DEFAULT 0,
                deleted_at      INTEGER
            );
            
            CREATE TABLE IF NOT EXISTS UserTemplate (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                category        TEXT NOT NULL,
                content         TEXT NOT NULL,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL
            );
            
            CREATE VIRTUAL TABLE IF NOT EXISTS SearchIndex USING fts5(
                block_id,
                content,
                title,
                tokenize = 'unicode61'
            );
            
            CREATE TABLE IF NOT EXISTS BlockVersion (
                id                      TEXT PRIMARY KEY,
                block_id                TEXT NOT NULL,
                version                 INTEGER NOT NULL,
                snapshot                TEXT NOT NULL,
                hash                    TEXT NOT NULL,
                message                 TEXT,
                source                  TEXT NOT NULL,
                restored_from_version_id TEXT,
                created_at              INTEGER NOT NULL,
                FOREIGN KEY (block_id) REFERENCES Block(id)
            );
            
            CREATE TABLE IF NOT EXISTS Notification (
                id              TEXT PRIMARY KEY,
                block_id        TEXT NOT NULL,
                page_id         TEXT NOT NULL,
                kind            TEXT NOT NULL,
                event_iso       TEXT NOT NULL,
                fired_at        INTEGER NOT NULL,
                status          TEXT NOT NULL DEFAULT 'unread',
                snooze_until    INTEGER,
                payload         TEXT NOT NULL,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL,
                FOREIGN KEY (block_id) REFERENCES Block(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_notifications_status ON Notification(status);
            CREATE INDEX IF NOT EXISTS idx_notifications_fired_at ON Notification(fired_at);
            CREATE INDEX IF NOT EXISTS idx_notifications_block_id ON Notification(block_id);

            CREATE TABLE IF NOT EXISTS DateRef (
                id              TEXT PRIMARY KEY,
                block_id        TEXT NOT NULL,
                kind            TEXT NOT NULL,
                iso             TEXT NOT NULL,
                date_day        TEXT NOT NULL,
                recurrence      TEXT NOT NULL DEFAULT 'none',
                lead_minutes    INTEGER NOT NULL DEFAULT 0,
                event_ts        INTEGER NOT NULL DEFAULT 0,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER,
                version         INTEGER NOT NULL DEFAULT 0,
                deleted_at      INTEGER,
                FOREIGN KEY (block_id) REFERENCES Block(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_dateref_kind_date ON DateRef(kind, date_day);
            CREATE INDEX IF NOT EXISTS idx_dateref_block_id ON DateRef(block_id);
            CREATE INDEX IF NOT EXISTS idx_dateref_event_ts ON DateRef(event_ts);

            CREATE TABLE IF NOT EXISTS SavedFilter (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                query_json  TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS screen_view (
                id          TEXT PRIMARY KEY,
                entity      TEXT NOT NULL DEFAULT 'block',
                parent_id   TEXT,
                name        TEXT NOT NULL,
                query_json  TEXT NOT NULL,
                view_type   TEXT NOT NULL DEFAULT 'table',
                group_by    TEXT NOT NULL DEFAULT '',
                is_default  INTEGER NOT NULL DEFAULT 0,
                sort_order  INTEGER NOT NULL DEFAULT 0,
                config      TEXT,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notification_config (
                id                          INTEGER PRIMARY KEY DEFAULT 1,
                enabled                     INTEGER NOT NULL DEFAULT 1,
                schedule_enabled            INTEGER NOT NULL DEFAULT 1,
                deadline_enabled            INTEGER NOT NULL DEFAULT 1,
                overdue_enabled             INTEGER NOT NULL DEFAULT 1,
                quiet_hours_start           TEXT,
                quiet_hours_end             TEXT,
                web_browser_notifications_enabled INTEGER NOT NULL DEFAULT 0
            );
            
            CREATE INDEX IF NOT EXISTS idx_page_blockId        ON Page(block_id);
            CREATE INDEX IF NOT EXISTS idx_page_type           ON Page(type);
            CREATE INDEX IF NOT EXISTS idx_page_updatedAt      ON Page(updated_at);
            CREATE INDEX IF NOT EXISTS idx_block_pageId        ON Block(page_id);
            CREATE INDEX IF NOT EXISTS idx_block_parentId      ON Block(parent_id);
            CREATE INDEX IF NOT EXISTS idx_block_pos           ON Block(pos);
            CREATE INDEX IF NOT EXISTS idx_link_target         ON Link(target_page_id);
            CREATE INDEX IF NOT EXISTS idx_link_source         ON Link(source_block_id);
            CREATE INDEX IF NOT EXISTS idx_property_blockId    ON Property(block_id);
            CREATE INDEX IF NOT EXISTS idx_property_key        ON Property(key);
            CREATE INDEX IF NOT EXISTS idx_block_version_blockId ON BlockVersion(block_id);
            CREATE INDEX IF NOT EXISTS idx_block_version_hash ON BlockVersion(hash);"
        )?;
        
        // SyncState table for WebSocket sync pairing state
        crate::sync::state::SyncStateRepository::create_table(conn)?;
        crate::sync::state::SyncStateRepository::migrate_add_ws_url(conn)?;
        
        Self::migrate_add_page_title_unique(conn)?;
        Self::migrate_date_ref_event_ts(conn)?;
        Self::migrate_add_version_and_deleted_at(conn)?;
        Self::seed_notification_config(conn)?;
        Self::migrate_rename_task_view_to_screen_view(conn)?;
        Self::migrate_add_screen_view_config(conn)?;
        Self::migrate_add_screen_view_entity(conn)?;
        Self::migrate_add_screen_view_parent_id(conn)?;

        Ok(())
    }

    fn migrate_rename_task_view_to_screen_view(conn: &rusqlite::Connection) -> Result<(), Box<dyn Error>> {
        // 实体改名：旧表 TaskView → screen_view（去除 task 模块耦合，见 ADR-0005）。
        // 幂等：仅当旧表存在且新表不存在时 ALTER RENAME，保留现有测试视图行。
        let has_old: bool = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='TaskView'",
            [],
            |row| row.get::<_, i64>(0),
        ).map(|c| c > 0).unwrap_or(false);
        let has_new: bool = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='screen_view'",
            [],
            |row| row.get::<_, i64>(0),
        ).map(|c| c > 0).unwrap_or(false);
        if has_old && !has_new {
            conn.execute("ALTER TABLE TaskView RENAME TO screen_view", [])?;
        }
        Ok(())
    }

    fn migrate_add_screen_view_config(conn: &rusqlite::Connection) -> Result<(), Box<dyn Error>> {
        // 加 config 列（JSON blob，可空）。幂等：列不存在才 ALTER ADD。
        let has_column: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('screen_view') WHERE name = 'config'",
            [],
            |row| row.get::<_, i64>(0),
        ).map(|c| c > 0).unwrap_or(false);
        if !has_column {
            conn.execute("ALTER TABLE screen_view ADD COLUMN config TEXT", [])?;
        }
        Ok(())
    }

    fn migrate_add_screen_view_entity(conn: &rusqlite::Connection) -> Result<(), Box<dyn Error>> {
        // 加 entity 列（所属实体键，用于按实体隔离命名视图）。幂等：列不存在才 ALTER ADD，默认 'block' 兼容存量视图。
        let has_column: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('screen_view') WHERE name = 'entity'",
            [],
            |row| row.get::<_, i64>(0),
        ).map(|c| c > 0).unwrap_or(false);
        if !has_column {
            conn.execute("ALTER TABLE screen_view ADD COLUMN entity TEXT NOT NULL DEFAULT 'block'", [])?;
        }
        Ok(())
    }

    fn migrate_add_screen_view_parent_id(conn: &rusqlite::Connection) -> Result<(), Box<dyn Error>> {
        // 加 parent_id 列（两级层级：空串 = Screen，非空 = Tab 所属 Screen id）。
        // 幂等：列不存在才 ALTER ADD；存量单级视图（parent_id 为 NULL）读取时回退空串，视作 Screen。
        let has_column: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('screen_view') WHERE name = 'parent_id'",
            [],
            |row| row.get::<_, i64>(0),
        ).map(|c| c > 0).unwrap_or(false);
        if !has_column {
            conn.execute("ALTER TABLE screen_view ADD COLUMN parent_id TEXT", [])?;
        }
        Ok(())
    }

    fn migrate_date_ref_event_ts(conn: &rusqlite::Connection) -> Result<(), Box<dyn Error>> {
        // 旧库 DateRef 表可能无 event_ts 列（CREATE TABLE IF NOT EXISTS 对已存在表是 no-op）。
        // 幂等迁移：列不存在才 ALTER ADD，避免老库升级时报 "no such column"。
        let has_column: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('DateRef') WHERE name = 'event_ts'",
            [],
            |row| row.get::<_, i64>(0),
        ).map(|c| c > 0).unwrap_or(false);
        if !has_column {
            conn.execute(
                "ALTER TABLE DateRef ADD COLUMN event_ts INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_dateref_event_ts ON DateRef(event_ts);",
                [],
            )?;
        }
        Ok(())
    }

    fn migrate_add_page_title_unique(conn: &rusqlite::Connection) -> Result<(), Box<dyn Error>> {
        let result = conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_page_title ON Page(title);", []);
        if let Err(e) = result {
            if e.to_string().contains("UNIQUE constraint failed") || e.to_string().contains("duplicate") {
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM (SELECT title FROM Page WHERE deleted = 0 GROUP BY title HAVING COUNT(*) > 1)",
                    [],
                    |row| row.get(0)
                ).unwrap_or(0);
                
                if count > 0 {
                    conn.execute(
                        "DELETE FROM Page WHERE id NOT IN (SELECT MIN(id) FROM Page WHERE deleted = 0 GROUP BY title)",
                        []
                    )?;
                    conn.execute("CREATE UNIQUE INDEX idx_page_title ON Page(title);", [])?;
                }
            }
        }
        Ok(())
    }

    fn migrate_add_version_and_deleted_at(conn: &rusqlite::Connection) -> Result<(), Box<dyn Error>> {
        // 幂等迁移：检查列是否存在，不存在才 ALTER ADD
        let has = |table: &str, col: &str| -> bool {
            conn.query_row(
                &format!("SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = '{}'", table, col),
                [],
                |row| row.get::<_, i64>(0),
            ).map(|c| c > 0).unwrap_or(false)
        };

        if !has("Block", "version") {
            conn.execute("ALTER TABLE Block ADD COLUMN version INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !has("Block", "deleted_at") {
            conn.execute("ALTER TABLE Block ADD COLUMN deleted_at INTEGER", [])?;
        }
        if !has("Page", "version") {
            conn.execute("ALTER TABLE Page ADD COLUMN version INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !has("Page", "deleted_at") {
            conn.execute("ALTER TABLE Page ADD COLUMN deleted_at INTEGER", [])?;
            conn.execute("UPDATE Page SET deleted_at = updated_at WHERE deleted = 1 AND deleted_at IS NULL", [])?;
        }
        if !has("Link", "updated_at") {
            conn.execute("ALTER TABLE Link ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !has("Link", "version") {
            conn.execute("ALTER TABLE Link ADD COLUMN version INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !has("Link", "deleted_at") {
            conn.execute("ALTER TABLE Link ADD COLUMN deleted_at INTEGER", [])?;
        }
        if !has("Property", "version") {
            conn.execute("ALTER TABLE Property ADD COLUMN version INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !has("Property", "deleted_at") {
            conn.execute("ALTER TABLE Property ADD COLUMN deleted_at INTEGER", [])?;
            conn.execute("UPDATE Property SET deleted_at = updated_at WHERE is_deleted = 1 AND deleted_at IS NULL", [])?;
        }
        if !has("RelationshipType", "version") {
            conn.execute("ALTER TABLE RelationshipType ADD COLUMN version INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !has("RelationshipType", "deleted_at") {
            conn.execute("ALTER TABLE RelationshipType ADD COLUMN deleted_at INTEGER", [])?;
        }
        if !has("DateRef", "updated_at") {
            conn.execute("ALTER TABLE DateRef ADD COLUMN updated_at INTEGER", [])?;
        }
        if !has("DateRef", "version") {
            conn.execute("ALTER TABLE DateRef ADD COLUMN version INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !has("DateRef", "deleted_at") {
            conn.execute("ALTER TABLE DateRef ADD COLUMN deleted_at INTEGER", [])?;
        }
        if !has("UserTemplate", "version") {
            conn.execute("ALTER TABLE UserTemplate ADD COLUMN version INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !has("UserTemplate", "deleted_at") {
            conn.execute("ALTER TABLE UserTemplate ADD COLUMN deleted_at INTEGER", [])?;
        }
        Ok(())
    }

pub fn seed_notification_config(conn: &rusqlite::Connection) -> Result<(), Box<dyn Error>> {
        conn.execute(
            "INSERT INTO notification_config (id, enabled, schedule_enabled, deadline_enabled, overdue_enabled, quiet_hours_start, quiet_hours_end, web_browser_notifications_enabled)
             SELECT 1, 1, 1, 1, 1, '22:00', '08:00', 0
             WHERE NOT EXISTS (SELECT 1 FROM notification_config)",
            [],
        )?;
        Ok(())
    }
}

impl BlockRepository for SQLiteAdapter {
    fn get_all(&self) -> Result<Vec<Block>, Box<dyn Error>> {
        block_get_all(&self.conn)
    }

    fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn Error>> {
        block_get_by_id(&self.conn, id)
    }

    fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        block_get_by_page_id(&self.conn, page_id)
    }

    fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        block_get_children(&self.conn, parent_id)
    }

    fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Block>, Box<dyn Error>> {
        block_get_by_ids(&self.conn, ids)
    }

    fn create(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        block_insert(&self.conn, block)?;
        self.update_search_index(block)?;
        Ok(block.clone())
    }

    fn update(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        block_update(&self.conn, block)?;
        self.update_search_index(block)?;
        Ok(block.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        block_soft_delete_by_id(&self.conn, id)?;
        self.conn.execute("DELETE FROM SearchIndex WHERE block_id = ?1", params![id])?;
        Ok(())
    }

    fn delete_by_page_id(&mut self, page_id: &str) -> Result<(), Box<dyn Error>> {
        let block_ids = block_ids_by_page_id(&self.conn, page_id)?;
        block_soft_delete_by_page_id(&self.conn, page_id)?;
        for block_id in block_ids {
            self.conn.execute("DELETE FROM SearchIndex WHERE block_id = ?1", params![block_id])?;
        }
        Ok(())
    }
}


impl PageRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<Page, Box<dyn Error>> {
        page_get_by_id(&self.conn, id)
    }
    
    fn get_by_title_including_deleted(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
        page_get_by_title_including_deleted(&self.conn, title)
    }

    fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
        page_get_by_title(&self.conn, title)
    }
    
    fn get_all(&self) -> Result<Vec<Page>, Box<dyn Error>> {
        page_get_all(&self.conn)
    }

    fn get_trash(&self) -> Result<Vec<Page>, Box<dyn Error>> {
        page_get_trash(&self.conn)
    }


    fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Page>, Box<dyn Error>> {
        page_get_by_ids(&self.conn, ids)
    }

    fn get_ideas_by_month(&self, year: i32, month: u32) -> Result<Vec<Page>, Box<dyn Error>> {
        page_get_ideas_by_month(&self.conn, year, month)
    }

    fn get_ideas_months(&self) -> Result<Vec<String>, Box<dyn Error>> {
        page_get_ideas_months(&self.conn)
    }

    fn create(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        page_create(&self.conn, page)
    }
    
    fn update(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        page_update(&self.conn, page)
    }
    
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        page_delete(&self.conn, id)
    }
}

impl LinkRepository for SQLiteAdapter   {
    fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn Error>> {
        link_get_by_id(&self.conn, id)
    }

    fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        link_get_by_source_block_id(&self.conn, source_block_id)
    }

    fn get_by_source_block_ids(&self, source_block_ids: &[String]) -> Result<Vec<Link>, Box<dyn Error>> {
        link_get_by_source_block_ids(&self.conn, source_block_ids)
    }

    fn get_by_target_page_id(&self, target_page_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        link_get_by_target_page_id(&self.conn, target_page_id)
    }

    fn create(&mut self, link: &Link) -> Result<Link, Box<dyn Error>> {
        link_insert(&self.conn, link)?;
        Ok(link.clone())
    }

    fn create_many(&mut self, links: &[Link]) -> Result<Vec<Link>, Box<dyn Error>> {
        link_create_many(&self.conn, links)?;
        Ok(links.to_vec())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        link_delete(&self.conn, id)
    }

    fn delete_by_source_block_id(&mut self, source_block_id: &str) -> Result<(), Box<dyn Error>> {
        link_delete_by_source_block_id(&self.conn, source_block_id)
    }

    fn delete_by_target_page_id(&mut self, target_page_id: &str) -> Result<(), Box<dyn Error>> {
        link_delete_by_target_page_id(&self.conn, target_page_id)
    }
}

impl PropertyRepository for SQLiteAdapter {
    fn get_all(&self) -> Result<Vec<Property>, Box<dyn Error>> {
        property_get_all(&self.conn)
    }

    fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn Error>> {
        property_get_by_id(&self.conn, id)
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn Error>> {
        property_get_by_block_id(&self.conn, block_id)
    }

    fn get_by_block_ids(&self, block_ids: &[String]) -> Result<Vec<Property>, Box<dyn Error>> {
        property_get_by_block_ids(&self.conn, block_ids)
    }

    fn get_by_block_id_and_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn Error>> {
        property_get_by_block_id_and_key(&self.conn, block_id, key)
    }

    fn query_block_ids_by_key_value(&self, key: &str, values: &[String]) -> Result<Vec<String>, Box<dyn Error>> {
        property_query_block_ids_by_key_value(&self.conn, key, values)
    }

    fn create(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        property_create(&self.conn, property)?;
        Ok(property.clone())
    }

    fn upsert(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        property_upsert(&self.conn, property)?;
        Ok(property.clone())
    }

    fn update(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        property_update(&self.conn, property)?;
        Ok(property.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        property_delete(&self.conn, id)
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        property_delete_by_block_id(&self.conn, block_id)
    }
}

impl RelationshipTypeRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<RelationshipType, Box<dyn Error>> {
        relationship_type_get_by_id(&self.conn, id)
    }

    fn get_by_type(&self, r#type: &str) -> Result<Option<RelationshipType>, Box<dyn Error>> {
        relationship_type_get_by_type(&self.conn, r#type)
    }

    fn get_all(&self) -> Result<Vec<RelationshipType>, Box<dyn Error>> {
        relationship_type_get_all(&self.conn)
    }

    fn create(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        relationship_type_create(&self.conn, rt)?;
        Ok(rt.clone())
    }

    fn update(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        relationship_type_update(&self.conn, rt)?;
        Ok(rt.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        relationship_type_delete(&self.conn, id)
    }
}

impl TemplateRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<UserTemplate, Box<dyn Error>> {
        template_get_by_id(&self.conn, id)
    }

    fn get_by_name(&self, name: &str) -> Result<Option<UserTemplate>, Box<dyn Error>> {
        template_get_by_name(&self.conn, name)
    }

    fn get_all(&self) -> Result<Vec<UserTemplate>, Box<dyn Error>> {
        template_get_all(&self.conn)
    }

    fn create(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
        template_create(&self.conn, template)?;
        Ok(template.clone())
    }

    fn update(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
        template_update(&self.conn, template)?;
        Ok(template.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        template_delete(&self.conn, id)
    }
}

impl SearchRepository for SQLiteAdapter {
    fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, Box<dyn Error>> {
        search_index_search(&self.conn, query, limit)
    }

    fn update_index(&mut self, block_id: &str, content: &str, title: &str) -> Result<(), Box<dyn Error>> {
        search_index_upsert(&self.conn, block_id, content, title)
    }

    fn delete_from_index(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        search_index_delete(&self.conn, block_id)
    }
}

impl SQLiteAdapter {
    fn update_search_index(&mut self, block: &Block) -> Result<(), Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT title FROM Page WHERE id = ?1 AND deleted = 0"
        )?;
        
        let title: String = match stmt.query_row(params![block.page_id], |row| {
            row.get(0)
        }) {
            Ok(t) => t,
            Err(rusqlite::Error::QueryReturnedNoRows) => "".to_string(),
            Err(e) => return Err(Box::new(e)),
        };
        
        self.conn.execute(
            "DELETE FROM SearchIndex WHERE block_id = ?1",
            params![block.id]
        )?;
        
        self.conn.execute(
            "INSERT INTO SearchIndex (block_id, content, title) VALUES (?1, ?2, ?3)",
            params![block.id, block.content, title]
        )?;
        
        Ok(())
    }
}

impl BlockVersionRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<BlockVersion, Box<dyn Error>> {
        block_version_get_by_id(&self.conn, id)
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<BlockVersion>, Box<dyn Error>> {
        block_version_get_by_block_id(&self.conn, block_id)
    }

    fn get_latest_version(&self, block_id: &str) -> Result<Option<BlockVersion>, Box<dyn Error>> {
        block_version_get_latest_version(&self.conn, block_id)
    }

    fn create(&mut self, version: &BlockVersion) -> Result<BlockVersion, Box<dyn Error>> {
        block_version_create(&self.conn, version)?;
        Ok(version.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        block_version_delete(&self.conn, id)
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        block_version_delete_by_block_id(&self.conn, block_id)
    }

    fn delete_older_than(&mut self, block_id: &str, timestamp: i64) -> Result<(), Box<dyn Error>> {
        block_version_delete_older_than(&self.conn, block_id, timestamp)
    }
}

impl SavedFilterRepository for SQLiteAdapter {
    fn get_all(&self) -> Result<Vec<SavedFilter>, Box<dyn Error>> {
        saved_filter_get_all(&self.conn)
    }

    fn get_by_id(&self, id: &str) -> Result<SavedFilter, Box<dyn Error>> {
        saved_filter_get_by_id(&self.conn, id)
    }

    fn create(&mut self, filter: &SavedFilter) -> Result<SavedFilter, Box<dyn Error>> {
        saved_filter_create(&self.conn, filter)?;
        Ok(filter.clone())
    }

    fn update(&mut self, filter: &SavedFilter) -> Result<SavedFilter, Box<dyn Error>> {
        saved_filter_update(&self.conn, filter)?;
        Ok(filter.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        saved_filter_delete(&self.conn, id)
    }
}

impl ScreenViewRepository for SQLiteAdapter {
    fn get_all_by_entity(&self, entity: &str) -> Result<Vec<ScreenView>, Box<dyn Error>> {
        screen_view_get_all_by_entity(&self.conn, entity)
    }

    fn get_by_id(&self, id: &str) -> Result<ScreenView, Box<dyn Error>> {
        screen_view_get_by_id(&self.conn, id)
    }

    fn create(&mut self, view: &ScreenView) -> Result<ScreenView, Box<dyn Error>> {
        screen_view_create(&self.conn, view)?;
        Ok(view.clone())
    }

    fn update(&mut self, view: &ScreenView) -> Result<ScreenView, Box<dyn Error>> {
        screen_view_update(&self.conn, view)?;
        Ok(view.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        screen_view_delete(&self.conn, id)
    }
}

impl StorageAdapter for SQLiteAdapter {
    fn blocks(&mut self) -> &mut dyn BlockRepository {
        self
    }
    
    fn pages(&mut self) -> &mut dyn PageRepository {
        self
    }
    
    fn links(&mut self) -> &mut dyn LinkRepository {
        self
    }
    
    fn properties(&mut self) -> &mut dyn PropertyRepository {
        self
    }
    
    fn relationship_types(&mut self) -> &mut dyn RelationshipTypeRepository {
        self
    }
    
    fn templates(&mut self) -> &mut dyn TemplateRepository {
        self
    }
    
    fn search(&mut self) -> &mut dyn SearchRepository {
        self
    }
    
    fn block_versions(&mut self) -> &mut dyn BlockVersionRepository {
        self
    }
    
    fn notifications(&mut self) -> &mut dyn NotificationRepository {
        self
    }

    fn date_refs(&mut self) -> &mut dyn DateRefRepository {
        self
    }

    fn saved_filters(&mut self) -> &mut dyn SavedFilterRepository {
        self
    }

    fn screen_views(&mut self) -> &mut dyn ScreenViewRepository {
        self
    }

    fn notification_config(&mut self) -> &mut dyn NotificationConfigRepository {
        self
    }
}

impl NotificationConfigRepository for SQLiteAdapter {
    fn get(&self) -> Result<NotificationConfig, Box<dyn Error>> {
        notification_config_get(&self.conn)
    }

    fn save(&mut self, config: &NotificationConfig) -> Result<(), Box<dyn Error>> {
        notification_config_save(&self.conn, config)
    }
}

impl DateRefRepository for SQLiteAdapter {
    fn get_all(&self) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_get_all(&self.conn)
    }

    fn get_by_id(&self, id: &str) -> Result<DateRef, Box<dyn Error>> {
        date_ref_get_by_id(&self.conn, id)
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_get_by_block_id(&self.conn, block_id)
    }

    fn query_by_date_range(&self, kind: &str, from: &str, to: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_query_by_date_range(&self.conn, kind, from, to)
    }

    fn query_overdue(&self, today: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_query_overdue(&self.conn, today)
    }

    fn query_due_non_recurring(&self, now_ms: i64) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_query_due_non_recurring(&self.conn, now_ms)
    }

    fn query_all_recurring(&self) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_query_all_recurring(&self.conn)
    }

    fn create(&mut self, date_ref: &DateRef) -> Result<DateRef, Box<dyn Error>> {
        date_ref_create(&self.conn, date_ref)
    }

    fn create_many(&mut self, date_refs: &[DateRef]) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_create_many(&self.conn, date_refs)
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        date_ref_delete(&self.conn, id)
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        date_ref_delete_by_block_id(&self.conn, block_id)
    }
}

impl NotificationRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<Notification, Box<dyn Error>> {
        notification_get_by_id(&self.conn, id)
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Notification>, Box<dyn Error>> {
        notification_get_by_block_id(&self.conn, block_id)
    }

    fn get_by_block_ids(&self, block_ids: &[String]) -> Result<Vec<Notification>, Box<dyn Error>> {
        notification_get_by_block_ids(&self.conn, block_ids)
    }

    fn find_by_event(&self, block_id: &str, kind: &str, event_iso: &str) -> Result<Option<Notification>, Box<dyn Error>> {
        notification_find_by_event(&self.conn, block_id, kind, event_iso)
    }

    fn query_unread(&self) -> Result<Vec<Notification>, Box<dyn Error>> {
        notification_query_unread(&self.conn)
    }

    fn query_pending_due(&self, now_ms: i64) -> Result<Vec<Notification>, Box<dyn Error>> {
        notification_query_pending_due(&self.conn, now_ms)
    }

    fn query_recent(&self, limit: usize) -> Result<Vec<Notification>, Box<dyn Error>> {
        notification_query_recent(&self.conn, limit)
    }

    fn create(&mut self, notification: &Notification) -> Result<Notification, Box<dyn Error>> {
        notification_create(&self.conn, notification)?;
        Ok(notification.clone())
    }

    fn batch_create(&mut self, notifications: &[Notification]) -> Result<Vec<Notification>, Box<dyn Error>> {
        notification_batch_create(&self.conn, notifications)?;
        Ok(notifications.to_vec())
    }

    fn update_status(&mut self, id: &str, status: &str) -> Result<Notification, Box<dyn Error>> {
        notification_update_status(&self.conn, id, status)?;
        notification_get_by_id(&self.conn, id)
    }

    fn set_snooze(&mut self, id: &str, snooze_until: i64, status: &str) -> Result<Notification, Box<dyn Error>> {
        notification_set_snooze(&self.conn, id, snooze_until, status)?;
        notification_get_by_id(&self.conn, id)
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        notification_delete(&self.conn, id)
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        notification_delete_by_block_id(&self.conn, block_id)
    }

    fn delete_by_block_and_kind(&mut self, block_id: &str, kind: &str) -> Result<(), Box<dyn Error>> {
        notification_delete_by_block_and_kind(&self.conn, block_id, kind)
    }

    fn delete_older_than(&mut self, timestamp: i64) -> Result<(), Box<dyn Error>> {
        notification_delete_older_than(&self.conn, timestamp)
    }

    fn mark_all_read(&mut self) -> Result<(), Box<dyn Error>> {
        notification_mark_all_read(&self.conn)
    }

    fn update_payload(&mut self, id: &str, payload: &str) -> Result<Notification, Box<dyn Error>> {
        notification_update_payload(&self.conn, id, payload)?;
        notification_get_by_id(&self.conn, id)
    }

    fn reschedule(&mut self, block_id: &str, kind: &str, new_event_iso: &str) -> Result<(), Box<dyn Error>> {
        notification_reschedule(&self.conn, block_id, kind, new_event_iso)
    }
}

impl TransactionalStorageAdapter for SQLiteAdapter {
    fn transaction<R, F>(&mut self, f: F) -> Result<R, Box<dyn Error>>
    where
        F: FnOnce(&mut dyn StorageAdapter) -> Result<R, Box<dyn Error>>,
    {
        let tx = self.conn.transaction()?;
        let mut tx_adapter = TxContext { conn: tx };
        let result = f(&mut tx_adapter)?;
        tx_adapter.conn.commit()?;
        Ok(result)
    }
}

struct TxContext<'a> {
    conn: rusqlite::Transaction<'a>,
}

impl<'a> BlockRepository for TxContext<'a> {
    fn get_all(&self) -> Result<Vec<Block>, Box<dyn Error>> {
        block_get_all(&self.conn)
    }

    fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn Error>> {
        block_get_by_id(&self.conn, id)
    }

    fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        block_get_by_page_id(&self.conn, page_id)
    }

    fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        block_get_children(&self.conn, parent_id)
    }

    fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Block>, Box<dyn Error>> {
        block_get_by_ids(&self.conn, ids)
    }

    fn create(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        block_insert(&self.conn, block)?;
        self.update_search_index(block)?;
        Ok(block.clone())
    }

    fn update(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        block_update(&self.conn, block)?;
        self.update_search_index(block)?;
        Ok(block.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        block_soft_delete_by_id(&self.conn, id)?;
        self.conn.execute("DELETE FROM SearchIndex WHERE block_id = ?1", params![id])?;
        Ok(())
    }

    fn delete_by_page_id(&mut self, page_id: &str) -> Result<(), Box<dyn Error>> {
        let block_ids = block_ids_by_page_id(&self.conn, page_id)?;
        block_soft_delete_by_page_id(&self.conn, page_id)?;
        for block_id in block_ids {
            self.conn.execute("DELETE FROM SearchIndex WHERE block_id = ?1", params![block_id])?;
        }
        Ok(())
    }
}


impl<'a> TxContext<'a> {
    fn update_search_index(&mut self, block: &Block) -> Result<(), Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT title FROM Page WHERE id = ?1 AND deleted = 0"
        )?;
        
        let title: String = match stmt.query_row(params![block.page_id], |row| {
            row.get(0)
        }) {
            Ok(t) => t,
            Err(rusqlite::Error::QueryReturnedNoRows) => "".to_string(),
            Err(e) => return Err(Box::new(e)),
        };
        
        self.conn.execute(
            "DELETE FROM SearchIndex WHERE block_id = ?1",
            params![block.id]
        )?;
        
        self.conn.execute(
            "INSERT INTO SearchIndex (block_id, content, title) VALUES (?1, ?2, ?3)",
            params![block.id, block.content, title]
        )?;
        
        Ok(())
    }
}

impl<'a> PageRepository for TxContext<'a> {
    fn get_by_id(&self, id: &str) -> Result<Page, Box<dyn Error>> {
        page_get_by_id(&self.conn, id)
    }

    fn get_by_title_including_deleted(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
        page_get_by_title_including_deleted(&self.conn, title)
    }

    fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
        page_get_by_title(&self.conn, title)
    }

    fn get_all(&self) -> Result<Vec<Page>, Box<dyn Error>> {
        page_get_all(&self.conn)
    }

    fn get_trash(&self) -> Result<Vec<Page>, Box<dyn Error>> {
        page_get_trash(&self.conn)
    }


    fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Page>, Box<dyn Error>> {
        page_get_by_ids(&self.conn, ids)
    }

    fn get_ideas_by_month(&self, year: i32, month: u32) -> Result<Vec<Page>, Box<dyn Error>> {
        page_get_ideas_by_month(&self.conn, year, month)
    }

    fn get_ideas_months(&self) -> Result<Vec<String>, Box<dyn Error>> {
        page_get_ideas_months(&self.conn)
    }

    fn create(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        page_create(&self.conn, page)
    }

    fn update(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        page_update(&self.conn, page)
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        page_delete(&self.conn, id)
    }
}

impl<'a> LinkRepository for TxContext<'a>  {
    fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn Error>> {
        link_get_by_id(&self.conn, id)
    }

    fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        link_get_by_source_block_id(&self.conn, source_block_id)
    }

    fn get_by_source_block_ids(&self, source_block_ids: &[String]) -> Result<Vec<Link>, Box<dyn Error>> {
        link_get_by_source_block_ids(&self.conn, source_block_ids)
    }

    fn get_by_target_page_id(&self, target_page_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        link_get_by_target_page_id(&self.conn, target_page_id)
    }

    fn create(&mut self, link: &Link) -> Result<Link, Box<dyn Error>> {
        link_insert(&self.conn, link)?;
        Ok(link.clone())
    }

    fn create_many(&mut self, links: &[Link]) -> Result<Vec<Link>, Box<dyn Error>> {
        link_create_many(&self.conn, links)?;
        Ok(links.to_vec())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        link_delete(&self.conn, id)
    }

    fn delete_by_source_block_id(&mut self, source_block_id: &str) -> Result<(), Box<dyn Error>> {
        link_delete_by_source_block_id(&self.conn, source_block_id)
    }

    fn delete_by_target_page_id(&mut self, target_page_id: &str) -> Result<(), Box<dyn Error>> {
        link_delete_by_target_page_id(&self.conn, target_page_id)
    }
}

impl<'a> PropertyRepository for TxContext<'a> {
    fn get_all(&self) -> Result<Vec<Property>, Box<dyn Error>> {
        property_get_all(&self.conn)
    }

    fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn Error>> {
        property_get_by_id(&self.conn, id)
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn Error>> {
        property_get_by_block_id(&self.conn, block_id)
    }

    fn get_by_block_ids(&self, block_ids: &[String]) -> Result<Vec<Property>, Box<dyn Error>> {
        property_get_by_block_ids(&self.conn, block_ids)
    }

    fn get_by_block_id_and_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn Error>> {
        property_get_by_block_id_and_key(&self.conn, block_id, key)
    }

    fn query_block_ids_by_key_value(&self, key: &str, values: &[String]) -> Result<Vec<String>, Box<dyn Error>> {
        property_query_block_ids_by_key_value(&self.conn, key, values)
    }

    fn create(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        property_create(&self.conn, property)?;
        Ok(property.clone())
    }

    fn upsert(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        property_upsert(&self.conn, property)?;
        Ok(property.clone())
    }

    fn update(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        property_update(&self.conn, property)?;
        Ok(property.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        property_delete(&self.conn, id)
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        property_delete_by_block_id(&self.conn, block_id)
    }
}

impl<'a> RelationshipTypeRepository for TxContext<'a> {
    fn get_by_id(&self, id: &str) -> Result<RelationshipType, Box<dyn Error>> {
        relationship_type_get_by_id(&self.conn, id)
    }

    fn get_by_type(&self, r#type: &str) -> Result<Option<RelationshipType>, Box<dyn Error>> {
        relationship_type_get_by_type(&self.conn, r#type)
    }

    fn get_all(&self) -> Result<Vec<RelationshipType>, Box<dyn Error>> {
        relationship_type_get_all(&self.conn)
    }

    fn create(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        relationship_type_create(&self.conn, rt)?;
        Ok(rt.clone())
    }

    fn update(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        relationship_type_update(&self.conn, rt)?;
        Ok(rt.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        relationship_type_delete(&self.conn, id)
    }
}

impl<'a> TemplateRepository for TxContext<'a> {
    fn get_by_id(&self, id: &str) -> Result<UserTemplate, Box<dyn Error>> {
        template_get_by_id(&self.conn, id)
    }

    fn get_by_name(&self, name: &str) -> Result<Option<UserTemplate>, Box<dyn Error>> {
        template_get_by_name(&self.conn, name)
    }

    fn get_all(&self) -> Result<Vec<UserTemplate>, Box<dyn Error>> {
        template_get_all(&self.conn)
    }

    fn create(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
        template_create(&self.conn, template)?;
        Ok(template.clone())
    }

    fn update(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
        template_update(&self.conn, template)?;
        Ok(template.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        template_delete(&self.conn, id)
    }
}

impl<'a> SearchRepository for TxContext<'a> {
    fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, Box<dyn Error>> {
        search_index_search(&self.conn, query, limit)
    }

    fn update_index(&mut self, block_id: &str, content: &str, title: &str) -> Result<(), Box<dyn Error>> {
        search_index_upsert(&self.conn, block_id, content, title)
    }

    fn delete_from_index(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        search_index_delete(&self.conn, block_id)
    }
}

impl<'a> BlockVersionRepository for TxContext<'a> {
    fn get_by_id(&self, id: &str) -> Result<BlockVersion, Box<dyn Error>> {
        block_version_get_by_id(&self.conn, id)
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<BlockVersion>, Box<dyn Error>> {
        block_version_get_by_block_id(&self.conn, block_id)
    }

    fn get_latest_version(&self, block_id: &str) -> Result<Option<BlockVersion>, Box<dyn Error>> {
        block_version_get_latest_version(&self.conn, block_id)
    }

    fn create(&mut self, version: &BlockVersion) -> Result<BlockVersion, Box<dyn Error>> {
        block_version_create(&self.conn, version)?;
        Ok(version.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        block_version_delete(&self.conn, id)
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        block_version_delete_by_block_id(&self.conn, block_id)
    }

    fn delete_older_than(&mut self, block_id: &str, timestamp: i64) -> Result<(), Box<dyn Error>> {
        block_version_delete_older_than(&self.conn, block_id, timestamp)
    }
}

impl<'a> StorageAdapter for TxContext<'a> {
    fn blocks(&mut self) -> &mut dyn BlockRepository {
        self
    }

    fn pages(&mut self) -> &mut dyn PageRepository {
        self
    }

    fn links(&mut self) -> &mut dyn LinkRepository {
        self
    }

    fn properties(&mut self) -> &mut dyn PropertyRepository {
        self
    }

    fn relationship_types(&mut self) -> &mut dyn RelationshipTypeRepository {
        self
    }

    fn templates(&mut self) -> &mut dyn TemplateRepository {
        self
    }

    fn search(&mut self) -> &mut dyn SearchRepository {
        self
    }
    
    fn block_versions(&mut self) -> &mut dyn BlockVersionRepository {
        self
    }
    
    fn notifications(&mut self) -> &mut dyn NotificationRepository {
        self
    }

    fn date_refs(&mut self) -> &mut dyn DateRefRepository {
        self
    }

    fn saved_filters(&mut self) -> &mut dyn SavedFilterRepository {
        self
    }

    fn screen_views(&mut self) -> &mut dyn ScreenViewRepository {
        self
    }

    fn notification_config(&mut self) -> &mut dyn NotificationConfigRepository {
        self
    }
}

impl<'a> SavedFilterRepository for TxContext<'a> {
    fn get_all(&self) -> Result<Vec<SavedFilter>, Box<dyn Error>> {
        saved_filter_get_all(&self.conn)
    }

    fn get_by_id(&self, id: &str) -> Result<SavedFilter, Box<dyn Error>> {
        saved_filter_get_by_id(&self.conn, id)
    }

    fn create(&mut self, filter: &SavedFilter) -> Result<SavedFilter, Box<dyn Error>> {
        saved_filter_create(&self.conn, filter)?;
        Ok(filter.clone())
    }

    fn update(&mut self, filter: &SavedFilter) -> Result<SavedFilter, Box<dyn Error>> {
        saved_filter_update(&self.conn, filter)?;
        Ok(filter.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        saved_filter_delete(&self.conn, id)
    }
}

impl<'a> ScreenViewRepository for TxContext<'a> {
    fn get_all_by_entity(&self, entity: &str) -> Result<Vec<ScreenView>, Box<dyn Error>> {
        screen_view_get_all_by_entity(&self.conn, entity)
    }

    fn get_by_id(&self, id: &str) -> Result<ScreenView, Box<dyn Error>> {
        screen_view_get_by_id(&self.conn, id)
    }

    fn create(&mut self, view: &ScreenView) -> Result<ScreenView, Box<dyn Error>> {
        screen_view_create(&self.conn, view)?;
        Ok(view.clone())
    }

    fn update(&mut self, view: &ScreenView) -> Result<ScreenView, Box<dyn Error>> {
        screen_view_update(&self.conn, view)?;
        Ok(view.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        screen_view_delete(&self.conn, id)
    }
}

impl<'a> DateRefRepository for TxContext<'a> {
    fn get_all(&self) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_get_all(&self.conn)
    }

    fn get_by_id(&self, id: &str) -> Result<DateRef, Box<dyn Error>> {
        date_ref_get_by_id(&self.conn, id)
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_get_by_block_id(&self.conn, block_id)
    }

    fn query_by_date_range(&self, kind: &str, from: &str, to: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_query_by_date_range(&self.conn, kind, from, to)
    }

    fn query_overdue(&self, today: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_query_overdue(&self.conn, today)
    }

    fn query_due_non_recurring(&self, now_ms: i64) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_query_due_non_recurring(&self.conn, now_ms)
    }

    fn query_all_recurring(&self) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_query_all_recurring(&self.conn)
    }

    fn create(&mut self, date_ref: &DateRef) -> Result<DateRef, Box<dyn Error>> {
        date_ref_create(&self.conn, date_ref)
    }

    fn create_many(&mut self, date_refs: &[DateRef]) -> Result<Vec<DateRef>, Box<dyn Error>> {
        date_ref_create_many(&self.conn, date_refs)
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        date_ref_delete(&self.conn, id)
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        date_ref_delete_by_block_id(&self.conn, block_id)
    }
}

impl<'a> NotificationRepository for TxContext<'a> {
    fn get_by_id(&self, id: &str) -> Result<Notification, Box<dyn Error>> {
        notification_get_by_id(&self.conn, id)
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Notification>, Box<dyn Error>> {
        notification_get_by_block_id(&self.conn, block_id)
    }

    fn get_by_block_ids(&self, block_ids: &[String]) -> Result<Vec<Notification>, Box<dyn Error>> {
        notification_get_by_block_ids(&self.conn, block_ids)
    }

    fn find_by_event(&self, block_id: &str, kind: &str, event_iso: &str) -> Result<Option<Notification>, Box<dyn Error>> {
        notification_find_by_event(&self.conn, block_id, kind, event_iso)
    }

    fn query_unread(&self) -> Result<Vec<Notification>, Box<dyn Error>> {
        notification_query_unread(&self.conn)
    }

    fn query_pending_due(&self, now_ms: i64) -> Result<Vec<Notification>, Box<dyn Error>> {
        notification_query_pending_due(&self.conn, now_ms)
    }

    fn query_recent(&self, limit: usize) -> Result<Vec<Notification>, Box<dyn Error>> {
        notification_query_recent(&self.conn, limit)
    }

    fn create(&mut self, notification: &Notification) -> Result<Notification, Box<dyn Error>> {
        notification_create(&self.conn, notification)?;
        Ok(notification.clone())
    }

    fn batch_create(&mut self, notifications: &[Notification]) -> Result<Vec<Notification>, Box<dyn Error>> {
        notification_batch_create(&self.conn, notifications)?;
        Ok(notifications.to_vec())
    }

    fn update_status(&mut self, id: &str, status: &str) -> Result<Notification, Box<dyn Error>> {
        notification_update_status(&self.conn, id, status)?;
        crate::NotificationRepository::get_by_id(self, id)
    }

    fn set_snooze(&mut self, id: &str, snooze_until: i64, status: &str) -> Result<Notification, Box<dyn Error>> {
        notification_set_snooze(&self.conn, id, snooze_until, status)?;
        crate::NotificationRepository::get_by_id(self, id)
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        notification_delete(&self.conn, id)
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        notification_delete_by_block_id(&self.conn, block_id)
    }

    fn delete_by_block_and_kind(&mut self, block_id: &str, kind: &str) -> Result<(), Box<dyn Error>> {
        notification_delete_by_block_and_kind(&self.conn, block_id, kind)
    }

    fn delete_older_than(&mut self, timestamp: i64) -> Result<(), Box<dyn Error>> {
        notification_delete_older_than(&self.conn, timestamp)
    }

    fn mark_all_read(&mut self) -> Result<(), Box<dyn Error>> {
        notification_mark_all_read(&self.conn)
    }

    fn update_payload(&mut self, id: &str, payload: &str) -> Result<Notification, Box<dyn Error>> {
        notification_update_payload(&self.conn, id, payload)?;
        crate::NotificationRepository::get_by_id(self, id)
    }

    fn reschedule(&mut self, block_id: &str, kind: &str, new_event_iso: &str) -> Result<(), Box<dyn Error>> {
        notification_reschedule(&self.conn, block_id, kind, new_event_iso)
    }
}

impl<'a> NotificationConfigRepository for TxContext<'a> {
    fn get(&self) -> Result<NotificationConfig, Box<dyn Error>> {
        notification_config_get(&self.conn)
    }

    fn save(&mut self, config: &NotificationConfig) -> Result<(), Box<dyn Error>> {
        notification_config_save(&self.conn, config)
    }
}
