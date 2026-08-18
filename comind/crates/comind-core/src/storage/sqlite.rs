use std::error::Error;
use std::path::Path;
use rusqlite::{Connection, params};
use super::super::types::*;
use super::repository::*;

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
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at FROM Block WHERE deleted_at IS NULL"
        )?;
        let blocks = stmt.query_map([], |row| {
            Ok(Block {
                id: row.get(0)?,
                page_id: row.get(1)?,
                parent_id: row.get(2)?,
                pos: row.get(3)?,
                content: row.get(4)?,
                format: row.get(5)?,
                r#type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                version: row.get(9)?,
                deleted_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(blocks)
    }

    fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at 
             FROM Block WHERE id = ?1 AND deleted_at IS NULL"
        )?;
        
        let block = stmt.query_row(params![id], |row| {
            Ok(Block {
                id: row.get(0)?,
                page_id: row.get(1)?,
                parent_id: row.get(2)?,
                pos: row.get(3)?,
                content: row.get(4)?,
                format: row.get(5)?,
                r#type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                version: row.get(9)?,
                deleted_at: row.get(10)?,
            })
        })?;
        
        Ok(block)
    }
    
    fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at 
             FROM Block WHERE page_id = ?1 AND deleted_at IS NULL ORDER BY pos"
        )?;
        
        let blocks = stmt.query_map(params![page_id], |row| {
            Ok(Block {
                id: row.get(0)?,
                page_id: row.get(1)?,
                parent_id: row.get(2)?,
                pos: row.get(3)?,
                content: row.get(4)?,
                format: row.get(5)?,
                r#type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                version: row.get(9)?,
                deleted_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(blocks)
    }
    
    fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at 
             FROM Block WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY pos"
        )?;
        
        let blocks = stmt.query_map(params![parent_id], |row| {
            Ok(Block {
                id: row.get(0)?,
                page_id: row.get(1)?,
                parent_id: row.get(2)?,
                pos: row.get(3)?,
                content: row.get(4)?,
                format: row.get(5)?,
                r#type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                version: row.get(9)?,
                deleted_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(blocks)
    }


    fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Block>, Box<dyn Error>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at FROM Block WHERE id IN ({}) AND deleted_at IS NULL",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let blocks = stmt.query_map(params.as_slice(), |row| {
            Ok(Block {
                id: row.get(0)?,
                page_id: row.get(1)?,
                parent_id: row.get(2)?,
                pos: row.get(3)?,
                content: row.get(4)?,
                format: row.get(5)?,
                r#type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                version: row.get(9)?,
                deleted_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(blocks)
    }
    fn create(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Block (id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                block.id,
                block.page_id,
                block.parent_id,
                block.pos,
                block.content,
                block.format,
                block.r#type,
                block.created_at,
                block.updated_at,
                block.version,
                block.deleted_at
            ]
        )?;
        
        self.update_search_index(block)?;
        
        Ok(block.clone())
    }
    
    fn update(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Block SET page_id = ?2, parent_id = ?3, pos = ?4, content = ?5, format = ?6, type = ?7, updated_at = ?8, version = version + 1
             WHERE id = ?1",
            params![
                block.id,
                block.page_id,
                block.parent_id,
                block.pos,
                block.content,
                block.format,
                block.r#type,
                block.updated_at
            ]
        )?;
        
        self.update_search_index(block)?;
        
        Ok(block.clone())
    }
    
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Block SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        
        self.conn.execute(
            "DELETE FROM SearchIndex WHERE block_id = ?1",
            params![id]
        )?;
        
        Ok(())
    }
    
    fn delete_by_page_id(&mut self, page_id: &str) -> Result<(), Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM Block WHERE page_id = ?1 AND deleted_at IS NULL"
        )?;
        let block_ids: Vec<String> = stmt.query_map(params![page_id], |row| {
            row.get(0)
        })?.collect::<Result<_, _>>()?;
        
        self.conn.execute(
            "UPDATE Block SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE page_id = ?1",
            params![page_id, chrono::Utc::now().timestamp_millis()]
        )?;
        
        for block_id in block_ids {
            self.conn.execute(
                "DELETE FROM SearchIndex WHERE block_id = ?1",
                params![block_id]
            )?;
        }
        
        Ok(())
    }
}

impl PageRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<Page, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at 
             FROM Page WHERE id = ?1 AND deleted_at IS NULL"
        )?;
        
        let page = stmt.query_row(params![id], |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        })?;
        
        Ok(page)
    }
    
    fn get_by_title_including_deleted(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
        let sql = "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at FROM Page WHERE title = ?1";
        let mut stmt = self.conn.prepare(sql)?;

        let result = stmt.query_row(params![title], |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        });

        match result {
            Ok(page) => Ok(Some(page)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at 
             FROM Page WHERE title = ?1 AND deleted = 0 AND deleted_at IS NULL"
        )?;
        
        let result = stmt.query_row(params![title], |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        });
        
        match result {
            Ok(page) => Ok(Some(page)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }
    
    fn get_all(&self) -> Result<Vec<Page>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at 
             FROM Page WHERE deleted = 0 AND deleted_at IS NULL ORDER BY updated_at DESC"
        )?;
        
        let pages = stmt.query_map([], |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(pages)
    }

    fn get_trash(&self) -> Result<Vec<Page>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at
             FROM Page WHERE deleted = 1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC"
        )?;

        let pages = stmt.query_map([], |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(pages)
    }


    fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Page>, Box<dyn Error>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at FROM Page WHERE id IN ({}) AND deleted_at IS NULL",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let pages = stmt.query_map(params.as_slice(), |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(pages)
    }

    fn get_ideas_by_month(&self, year: i32, month: u32) -> Result<Vec<Page>, Box<dyn Error>> {
        let start = format!("{}-{:02}-01", year, month);
        let end = if month == 12 {
            format!("{}-01-01", year + 1)
        } else {
            format!("{}-{:02}-01", year, month + 1)
        };
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at
             FROM Page WHERE type IN ('ideas', 'journal') AND deleted = 0 AND deleted_at IS NULL AND title >= ?1 AND title < ?2 ORDER BY title DESC"
        )?;
        let pages = stmt.query_map(params![start, end], |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(pages)
    }

    fn get_ideas_months(&self) -> Result<Vec<String>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT substr(title, 1, 7) AS month
             FROM Page
             WHERE type IN ('ideas', 'journal') AND deleted = 0 AND deleted_at IS NULL
             ORDER BY month DESC"
        )?;
        let months = stmt.query_map([], |row| {
            Ok(row.get::<_, String>(0)?)
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(months)
    }

    fn create(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Page (id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                page.id,
                page.block_id,
                page.title,
                page.r#type,
                page.icon,
                page.cover,
                page.aliases,
                page.file_path,
                page.children_count,
                page.word_count,
                page.deleted,
                page.created_at,
                page.updated_at,
                page.version,
                page.deleted_at
            ]
        )?;
        
        Ok(page.clone())
    }
    
    fn update(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Page SET block_id = ?2, title = ?3, type = ?4, icon = ?5, cover = ?6, aliases = ?7, file_path = ?8, children_count = ?9, word_count = ?10, deleted = ?11, updated_at = ?12, version = version + 1
             WHERE id = ?1",
            params![
                page.id,
                page.block_id,
                page.title,
                page.r#type,
                page.icon,
                page.cover,
                page.aliases,
                page.file_path,
                page.children_count,
                page.word_count,
                page.deleted,
                page.updated_at
            ]
        )?;
        
        Ok(page.clone())
    }
    
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Page SET deleted = 1, deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
}

impl LinkRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at 
             FROM Link WHERE id = ?1 AND deleted_at IS NULL"
        )?;
        
        let link = stmt.query_row(params![id], |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                version: row.get(7)?,
                deleted_at: row.get(8)?,
            })
        })?;
        
        Ok(link)
    }
    
    fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at 
             FROM Link WHERE source_block_id = ?1 AND deleted_at IS NULL"
        )?;
        
        let links = stmt.query_map(params![source_block_id], |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                version: row.get(7)?,
                deleted_at: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(links)
    }

    fn get_by_source_block_ids(&self, source_block_ids: &[String]) -> Result<Vec<Link>, Box<dyn Error>> {
        if source_block_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=source_block_ids.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at
             FROM Link WHERE source_block_id IN ({}) AND deleted_at IS NULL",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = source_block_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let links = stmt.query_map(params.as_slice(), |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                version: row.get(7)?,
                deleted_at: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(links)
    }
    
    fn get_by_target_page_id(&self, target_page_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at 
             FROM Link WHERE target_page_id = ?1 AND deleted_at IS NULL"
        )?;
        
        let links = stmt.query_map(params![target_page_id], |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                version: row.get(7)?,
                deleted_at: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(links)
    }
    
    fn create(&mut self, link: &Link) -> Result<Link, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Link (id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                link.id,
                link.source_block_id,
                link.target_page_id,
                link.display_text,
                link.relationship_type,
                link.created_at,
                link.updated_at,
                link.version,
                link.deleted_at
            ]
        )?;
        
        Ok(link.clone())
    }
    
    fn create_many(&mut self, links: &[Link]) -> Result<Vec<Link>, Box<dyn Error>> {
        let tx = self.conn.transaction()?;
        
        for link in links {
            tx.execute(
                "INSERT INTO Link (id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
                params![
                    link.id,
                    link.source_block_id,
                    link.target_page_id,
                    link.display_text,
                    link.relationship_type,
                    link.created_at,
                    link.updated_at,
                    link.version
                ]
            )?;
        }
        
        tx.commit()?;
        Ok(links.to_vec())
    }
    
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Link SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
    
    fn delete_by_source_block_id(&mut self, source_block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Link SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE source_block_id = ?1",
            params![source_block_id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }

    fn delete_by_target_page_id(&mut self, target_page_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Link SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE target_page_id = ?1",
            params![target_page_id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
}

impl PropertyRepository for SQLiteAdapter {
    fn get_all(&self) -> Result<Vec<Property>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at FROM Property WHERE is_deleted = 0 AND deleted_at IS NULL"
        )?;
        let properties = stmt.query_map([], |row| {
            Ok(Property {
                id: row.get(0)?,
                block_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                r#type: row.get(4)?,
                sort_order: row.get(5)?,
                is_hidden: row.get(6)?,
                is_deleted: row.get(7)?,
                schema_version: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                version: row.get(11)?,
                deleted_at: row.get(12)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(properties)
    }

    fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at 
             FROM Property WHERE id = ?1 AND deleted_at IS NULL"
        )?;
        
        let property = stmt.query_row(params![id], |row| {
            Ok(Property {
                id: row.get(0)?,
                block_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                r#type: row.get(4)?,
                sort_order: row.get(5)?,
                is_hidden: row.get(6)?,
                is_deleted: row.get(7)?,
                schema_version: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                version: row.get(11)?,
                deleted_at: row.get(12)?,
            })
        })?;
        
        Ok(property)
    }
    
    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at 
             FROM Property WHERE block_id = ?1 AND is_deleted = 0 AND deleted_at IS NULL ORDER BY sort_order"
        )?;
        
        let properties = stmt.query_map(params![block_id], |row| {
            Ok(Property {
                id: row.get(0)?,
                block_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                r#type: row.get(4)?,
                sort_order: row.get(5)?,
                is_hidden: row.get(6)?,
                is_deleted: row.get(7)?,
                schema_version: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                version: row.get(11)?,
                deleted_at: row.get(12)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(properties)
    }

    fn get_by_block_ids(&self, block_ids: &[String]) -> Result<Vec<Property>, Box<dyn Error>> {
        if block_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=block_ids.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at
             FROM Property WHERE block_id IN ({}) AND is_deleted = 0 AND deleted_at IS NULL ORDER BY sort_order",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = block_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let properties = stmt.query_map(params.as_slice(), |row| {
            Ok(Property {
                id: row.get(0)?,
                block_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                r#type: row.get(4)?,
                sort_order: row.get(5)?,
                is_hidden: row.get(6)?,
                is_deleted: row.get(7)?,
                schema_version: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                version: row.get(11)?,
                deleted_at: row.get(12)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(properties)
    }
    
    fn get_by_block_id_and_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at 
             FROM Property WHERE block_id = ?1 AND key = ?2 AND is_deleted = 0 AND deleted_at IS NULL"
        )?;
        
        let result = stmt.query_row(params![block_id, key], |row| {
            Ok(Property {
                id: row.get(0)?,
                block_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                r#type: row.get(4)?,
                sort_order: row.get(5)?,
                is_hidden: row.get(6)?,
                is_deleted: row.get(7)?,
                schema_version: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                version: row.get(11)?,
                deleted_at: row.get(12)?,
            })
        });
        
        match result {
            Ok(property) => Ok(Some(property)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn query_block_ids_by_key_value(&self, key: &str, values: &[String]) -> Result<Vec<String>, Box<dyn Error>> {
        if values.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = values.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT DISTINCT block_id FROM Property WHERE key = ? AND value IN ({}) AND is_deleted = 0 AND deleted_at IS NULL",
            placeholders
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        params_vec.push(Box::new(key.to_string()));
        for v in values {
            params_vec.push(Box::new(v.clone()));
        }
        let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        let ids = stmt.query_map(param_refs.as_slice(), |row| {
            row.get::<_, String>(0)
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(ids)
    }

    fn create(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Property (id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                property.id,
                property.block_id,
                property.key,
                property.value,
                property.r#type,
                property.sort_order,
                property.is_hidden,
                property.is_deleted,
                property.schema_version,
                property.created_at,
                property.updated_at,
                property.version,
                property.deleted_at
            ]
        )?;
        
        Ok(property.clone())
    }
    fn upsert(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Property (id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(block_id, key) DO UPDATE SET
                value = excluded.value,
                type = excluded.type,
                updated_at = excluded.updated_at,
                sort_order = excluded.sort_order,
                is_hidden = excluded.is_hidden,
                schema_version = excluded.schema_version,
                is_deleted = 0,
                deleted_at = NULL",
            params![
                property.id,
                property.block_id,
                property.key,
                property.value,
                property.r#type,
                property.sort_order,
                property.is_hidden,
                property.is_deleted,
                property.schema_version,
                property.created_at,
                property.updated_at,
                property.version,
                property.deleted_at
            ]
        )?;
        Ok(property.clone())
    }

    
    fn update(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Property SET value = ?2, type = ?3, sort_order = ?4, is_hidden = ?5, is_deleted = ?6, updated_at = ?7, version = version + 1
             WHERE id = ?1",
            params![
                property.id,
                property.value,
                property.r#type,
                property.sort_order,
                property.is_hidden,
                property.is_deleted,
                property.updated_at
            ]
        )?;
        
        Ok(property.clone())
    }
    
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Property SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
    
    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Property SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE block_id = ?1",
            params![block_id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
}

impl RelationshipTypeRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<RelationshipType, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, inverse, label, inverse_label, color, `order`, strength, deleted, builtin, created_at, updated_at 
             FROM RelationshipType WHERE id = ?1"
        )?;
        
        let rt = stmt.query_row(params![id], |row| {
            Ok(RelationshipType {
                id: row.get(0)?,
                r#type: row.get(1)?,
                inverse: row.get(2)?,
                label: row.get(3)?,
                inverse_label: row.get(4)?,
                color: row.get(5)?,
                order: row.get(6)?,
                strength: row.get(7)?,
                deleted: row.get(8)?,
                builtin: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?;
        
        Ok(rt)
    }
    
    fn get_by_type(&self, r#type: &str) -> Result<Option<RelationshipType>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, inverse, label, inverse_label, color, `order`, strength, deleted, builtin, created_at, updated_at 
             FROM RelationshipType WHERE type = ?1 AND deleted = 0"
        )?;
        
        let result = stmt.query_row(params![r#type], |row| {
            Ok(RelationshipType {
                id: row.get(0)?,
                r#type: row.get(1)?,
                inverse: row.get(2)?,
                label: row.get(3)?,
                inverse_label: row.get(4)?,
                color: row.get(5)?,
                order: row.get(6)?,
                strength: row.get(7)?,
                deleted: row.get(8)?,
                builtin: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        });
        
        match result {
            Ok(rt) => Ok(Some(rt)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }
    
    fn get_all(&self) -> Result<Vec<RelationshipType>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, inverse, label, inverse_label, color, `order`, strength, deleted, builtin, created_at, updated_at 
             FROM RelationshipType WHERE deleted = 0 ORDER BY `order`"
        )?;
        
        let rts = stmt.query_map([], |row| {
            Ok(RelationshipType {
                id: row.get(0)?,
                r#type: row.get(1)?,
                inverse: row.get(2)?,
                label: row.get(3)?,
                inverse_label: row.get(4)?,
                color: row.get(5)?,
                order: row.get(6)?,
                strength: row.get(7)?,
                deleted: row.get(8)?,
                builtin: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(rts)
    }
    
    fn create(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO RelationshipType (id, type, inverse, label, inverse_label, color, `order`, strength, deleted, builtin, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                rt.id,
                rt.r#type,
                rt.inverse,
                rt.label,
                rt.inverse_label,
                rt.color,
                rt.order,
                rt.strength,
                rt.deleted,
                rt.builtin,
                rt.created_at,
                rt.updated_at
            ]
        )?;
        
        Ok(rt.clone())
    }
    
    fn update(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE RelationshipType SET type = ?2, inverse = ?3, label = ?4, inverse_label = ?5, color = ?6, `order` = ?7, strength = ?8, deleted = ?9, updated_at = ?10, version = version + 1
             WHERE id = ?1",
            params![
                rt.id,
                rt.r#type,
                rt.inverse,
                rt.label,
                rt.inverse_label,
                rt.color,
                rt.order,
                rt.strength,
                rt.deleted,
                rt.updated_at
            ]
        )?;
        
        Ok(rt.clone())
    }
    
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE RelationshipType SET deleted = 1, deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
}

impl TemplateRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<UserTemplate, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, category, content, created_at, updated_at 
             FROM UserTemplate WHERE id = ?1"
        )?;
        
        let template = stmt.query_row(params![id], |row| {
            Ok(UserTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        
        Ok(template)
    }
    
    fn get_by_name(&self, name: &str) -> Result<Option<UserTemplate>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, category, content, created_at, updated_at 
             FROM UserTemplate WHERE name = ?1"
        )?;
        
        let result = stmt.query_row(params![name], |row| {
            Ok(UserTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        });
        
        match result {
            Ok(template) => Ok(Some(template)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }
    
    fn get_all(&self) -> Result<Vec<UserTemplate>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, category, content, created_at, updated_at 
             FROM UserTemplate ORDER BY name"
        )?;
        
        let templates = stmt.query_map([], |row| {
            Ok(UserTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(templates)
    }
    
    fn create(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO UserTemplate (id, name, category, content, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                template.id,
                template.name,
                template.category,
                template.content,
                template.created_at,
                template.updated_at
            ]
        )?;
        
        Ok(template.clone())
    }
    
    fn update(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE UserTemplate SET name = ?2, category = ?3, content = ?4, updated_at = ?5
             WHERE id = ?1",
            params![
                template.id,
                template.name,
                template.category,
                template.content,
                template.updated_at
            ]
        )?;
        
        Ok(template.clone())
    }
    
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM UserTemplate WHERE id = ?1", params![id])?;
        Ok(())
    }
}

impl SearchRepository for SQLiteAdapter {
    fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT block_id, content, title, bm25(SearchIndex) as score
             FROM SearchIndex 
             WHERE SearchIndex MATCH ?1 
             ORDER BY bm25(SearchIndex)
             LIMIT ?2"
        )?;
        
        let fts_query = query.replace(" ", "* ");
        let fts_query = format!("{}*", fts_query);
        
        let results = stmt.query_map(params![fts_query, limit as i64], |row| {
            let block_id: String = row.get(0)?;
            let content: String = row.get(1)?;
            let title: String = row.get(2)?;
            let score: f64 = row.get(3)?;
            
            Ok(SearchResult::new(
                &block_id,
                "",
                &title,
                &content,
                score
            ))
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(results)
    }
    
    fn update_index(&mut self, block_id: &str, content: &str, title: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "DELETE FROM SearchIndex WHERE block_id = ?1",
            params![block_id]
        )?;
        
        self.conn.execute(
            "INSERT INTO SearchIndex (block_id, content, title) VALUES (?1, ?2, ?3)",
            params![block_id, content, title]
        )?;
        
        Ok(())
    }
    
    fn delete_from_index(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "DELETE FROM SearchIndex WHERE block_id = ?1",
            params![block_id]
        )?;
        Ok(())
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
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, version, snapshot, hash, message, source, restored_from_version_id, created_at 
             FROM BlockVersion WHERE id = ?1"
        )?;
        
        let version = stmt.query_row(params![id], |row| {
            Ok(BlockVersion {
                id: row.get(0)?,
                block_id: row.get(1)?,
                version: row.get(2)?,
                snapshot: row.get(3)?,
                hash: row.get(4)?,
                message: row.get(5)?,
                source: row.get(6)?,
                restored_from_version_id: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;
        
        Ok(version)
    }
    
    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<BlockVersion>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, version, snapshot, hash, message, source, restored_from_version_id, created_at 
             FROM BlockVersion WHERE block_id = ?1 ORDER BY version DESC"
        )?;
        
        let versions = stmt.query_map(params![block_id], |row| {
            Ok(BlockVersion {
                id: row.get(0)?,
                block_id: row.get(1)?,
                version: row.get(2)?,
                snapshot: row.get(3)?,
                hash: row.get(4)?,
                message: row.get(5)?,
                source: row.get(6)?,
                restored_from_version_id: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(versions)
    }
    
    fn get_latest_version(&self, block_id: &str) -> Result<Option<BlockVersion>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, version, snapshot, hash, message, source, restored_from_version_id, created_at 
             FROM BlockVersion WHERE block_id = ?1 ORDER BY version DESC LIMIT 1"
        )?;
        
        let result = stmt.query_row(params![block_id], |row| {
            Ok(BlockVersion {
                id: row.get(0)?,
                block_id: row.get(1)?,
                version: row.get(2)?,
                snapshot: row.get(3)?,
                hash: row.get(4)?,
                message: row.get(5)?,
                source: row.get(6)?,
                restored_from_version_id: row.get(7)?,
                created_at: row.get(8)?,
            })
        });
        
        match result {
            Ok(version) => Ok(Some(version)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }
    
    fn create(&mut self, version: &BlockVersion) -> Result<BlockVersion, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO BlockVersion (id, block_id, version, snapshot, hash, message, source, restored_from_version_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                version.id,
                version.block_id,
                version.version,
                version.snapshot,
                version.hash,
                version.message,
                version.source,
                version.restored_from_version_id,
                version.created_at
            ]
        )?;
        
        Ok(version.clone())
    }
    
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM BlockVersion WHERE id = ?1", params![id])?;
        Ok(())
    }
    
    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM BlockVersion WHERE block_id = ?1", params![block_id])?;
        Ok(())
    }
    
    fn delete_older_than(&mut self, block_id: &str, timestamp: i64) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "DELETE FROM BlockVersion WHERE block_id = ?1 AND created_at < ?2",
            params![block_id, timestamp]
        )?;
        Ok(())
    }
}

impl SavedFilterRepository for SQLiteAdapter {
    fn get_all(&self) -> Result<Vec<SavedFilter>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, query_json, created_at, updated_at FROM SavedFilter ORDER BY created_at DESC"
        )?;
        let filters = stmt.query_map([], |row| {
            Ok(SavedFilter {
                id: row.get(0)?,
                name: row.get(1)?,
                query_json: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(filters)
    }

    fn get_by_id(&self, id: &str) -> Result<SavedFilter, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, query_json, created_at, updated_at FROM SavedFilter WHERE id = ?1"
        )?;
        let filter = stmt.query_row(params![id], |row| {
            Ok(SavedFilter {
                id: row.get(0)?,
                name: row.get(1)?,
                query_json: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(filter)
    }

    fn create(&mut self, filter: &SavedFilter) -> Result<SavedFilter, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO SavedFilter (id, name, query_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                filter.id,
                filter.name,
                filter.query_json,
                filter.created_at,
                filter.updated_at
            ]
        )?;
        Ok(filter.clone())
    }

    fn update(&mut self, filter: &SavedFilter) -> Result<SavedFilter, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE SavedFilter SET name = ?2, query_json = ?3, updated_at = ?4 WHERE id = ?1",
            params![
                filter.id,
                filter.name,
                filter.query_json,
                filter.updated_at
            ]
        )?;
        Ok(filter.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM SavedFilter WHERE id = ?1", params![id])?;
        Ok(())
    }
}

impl ScreenViewRepository for SQLiteAdapter {
    fn get_all_by_entity(&self, entity: &str) -> Result<Vec<ScreenView>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, query_json, view_type, group_by, is_default, sort_order, COALESCE(config, '') AS config, entity, parent_id, created_at, updated_at FROM screen_view WHERE entity = ?1 ORDER BY sort_order ASC, created_at DESC"
        )?;
        let views = stmt.query_map(params![entity], |row| {
            Ok(ScreenView {
                id: row.get(0)?,
                entity: row.get(8).unwrap_or_else(|_| "block".to_string()),
                parent_id: row.get(9).unwrap_or_default(),
                name: row.get(1)?,
                query_json: row.get(2)?,
                view_type: row.get(3)?,
                group_by: row.get(4)?,
                is_default: row.get(5)?,
                sort_order: row.get(6)?,
                config: row.get(7)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(views)
    }

    fn get_by_id(&self, id: &str) -> Result<ScreenView, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, query_json, view_type, group_by, is_default, sort_order, COALESCE(config, '') AS config, entity, parent_id, created_at, updated_at FROM screen_view WHERE id = ?1"
        )?;
        let view = stmt.query_row(params![id], |row| {
            Ok(ScreenView {
                id: row.get(0)?,
                entity: row.get(8).unwrap_or_else(|_| "block".to_string()),
                parent_id: row.get(9).unwrap_or_default(),
                name: row.get(1)?,
                query_json: row.get(2)?,
                view_type: row.get(3)?,
                group_by: row.get(4)?,
                is_default: row.get(5)?,
                sort_order: row.get(6)?,
                config: row.get(7)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?;
        Ok(view)
    }

    fn create(&mut self, view: &ScreenView) -> Result<ScreenView, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO screen_view (id, entity, parent_id, name, query_json, view_type, group_by, is_default, sort_order, config, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                view.id,
                view.entity,
                view.parent_id,
                view.name,
                view.query_json,
                view.view_type,
                view.group_by,
                view.is_default,
                view.sort_order,
                view.config,
                view.created_at,
                view.updated_at
            ]
        )?;
        Ok(view.clone())
    }

    fn update(&mut self, view: &ScreenView) -> Result<ScreenView, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE screen_view SET parent_id = ?2, name = ?3, query_json = ?4, view_type = ?5, group_by = ?6, is_default = ?7, sort_order = ?8, config = ?9, updated_at = ?10 WHERE id = ?1",
            params![
                view.id,
                view.parent_id,
                view.name,
                view.query_json,
                view.view_type,
                view.group_by,
                view.is_default,
                view.sort_order,
                view.config,
                view.updated_at
            ]
        )?;
        Ok(view.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM screen_view WHERE id = ?1", params![id])?;
        Ok(())
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
        let mut stmt = self.conn.prepare(
            "SELECT id, enabled, schedule_enabled, deadline_enabled, overdue_enabled, quiet_hours_start, quiet_hours_end, web_browser_notifications_enabled FROM notification_config WHERE id = 1"
        )?;
        let config = stmt.query_row([], |row| {
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
        })?;
        Ok(config)
    }

    fn save(&mut self, config: &NotificationConfig) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO notification_config (id, enabled, schedule_enabled, deadline_enabled, overdue_enabled, quiet_hours_start, quiet_hours_end, web_browser_notifications_enabled)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, schedule_enabled=excluded.schedule_enabled, deadline_enabled=excluded.deadline_enabled, overdue_enabled=excluded.overdue_enabled, quiet_hours_start=excluded.quiet_hours_start, quiet_hours_end=excluded.quiet_hours_end, web_browser_notifications_enabled=excluded.web_browser_notifications_enabled",
            params![config.enabled as i64, config.schedule_enabled as i64, config.deadline_enabled as i64, config.overdue_enabled as i64, config.quiet_hours_start, config.quiet_hours_end, config.web_browser_notifications_enabled as i64],
        )?;
        Ok(())
    }
}

impl DateRefRepository for SQLiteAdapter {
    fn get_all(&self) -> Result<Vec<DateRef>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, created_at, event_ts, updated_at, version, deleted_at FROM DateRef WHERE deleted_at IS NULL"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    fn get_by_id(&self, id: &str) -> Result<DateRef, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, created_at, event_ts, updated_at, version, deleted_at FROM DateRef WHERE id = ? AND deleted_at IS NULL"
        )?;
        let dr = stmt.query_row(params![id], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
})
        });
        match dr {
            Ok(d) => Ok(d),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "DateRef not found"))),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, created_at, event_ts, updated_at, version, deleted_at FROM DateRef WHERE block_id = ? AND deleted_at IS NULL"
        )?;
        let rows = stmt.query_map(params![block_id], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
})
        })?;
        let mut result = Vec::new();
        for r in rows { result.push(r?); }
        Ok(result)
    }

    fn query_by_date_range(&self, kind: &str, from: &str, to: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, created_at, event_ts, updated_at, version, deleted_at FROM DateRef WHERE (kind = ?1 OR ?1 = '*') AND date_day BETWEEN ?2 AND ?3 AND deleted_at IS NULL ORDER BY date_day, block_id"
        )?;
        let rows = stmt.query_map(params![kind, from, to], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
})
        })?;
        let mut result = Vec::new();
        for r in rows { result.push(r?); }
        Ok(result)
    }

    fn query_overdue(&self, today: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, created_at, event_ts, updated_at, version, deleted_at FROM DateRef WHERE kind = 'deadline' AND date_day < ? AND deleted_at IS NULL ORDER BY date_day"
        )?;
        let rows = stmt.query_map(params![today], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
})
        })?;
        let mut result = Vec::new();
        for r in rows { result.push(r?); }
        Ok(result)
    }

    fn query_due_non_recurring(&self, now_ms: i64) -> Result<Vec<DateRef>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, event_ts, created_at, updated_at, version, deleted_at FROM DateRef WHERE recurrence = 'none' AND kind != 'ref' AND (event_ts - lead_minutes * 60000) <= ?1 AND deleted_at IS NULL"
        )?;
        let rows = stmt.query_map(params![now_ms], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
            })
        })?;
        let mut result = Vec::new();
        for r in rows { result.push(r?); }
        Ok(result)
    }

    fn query_all_recurring(&self) -> Result<Vec<DateRef>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, event_ts, created_at, updated_at, version, deleted_at FROM DateRef WHERE recurrence != 'none' AND kind != 'ref' AND deleted_at IS NULL"
        )?;
        let rows = stmt.query_map(params![], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
            })
        })?;
        let mut result = Vec::new();
        for r in rows { result.push(r?); }
        Ok(result)
    }

    fn create(&mut self, date_ref: &DateRef) -> Result<DateRef, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO DateRef (id, block_id, kind, iso, date_day, recurrence, lead_minutes, event_ts, created_at, updated_at, version, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![date_ref.id, date_ref.block_id, date_ref.kind, date_ref.iso, date_ref.date_day, date_ref.recurrence, date_ref.lead_minutes, date_ref.event_ts, date_ref.created_at, date_ref.updated_at, date_ref.version, date_ref.deleted_at],
        )?;
        Ok(date_ref.clone())
    }

    fn create_many(&mut self, date_refs: &[DateRef]) -> Result<Vec<DateRef>, Box<dyn Error>> {
        for dr in date_refs {
            DateRefRepository::create(self, dr)?;
        }
        Ok(date_refs.to_vec())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE DateRef SET deleted_at = ?1, version = version + 1, updated_at = ?1 WHERE id = ?2",
            params![chrono::Utc::now().timestamp_millis(), id]
        )?;
        Ok(())
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE DateRef SET deleted_at = ?1, version = version + 1, updated_at = ?1 WHERE block_id = ?2",
            params![chrono::Utc::now().timestamp_millis(), block_id]
        )?;
        Ok(())
    }
}

impl NotificationRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<Notification, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE id = ?"
        )?;
        let notif = stmt.query_row(params![id], |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        Ok(notif)
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Notification>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE block_id = ? ORDER BY fired_at DESC"
        )?;
        let notifs = stmt.query_map(params![block_id], |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        let mut result = Vec::new();
        for n in notifs {
            result.push(n?);
        }
        Ok(result)
    }


    fn get_by_block_ids(&self, block_ids: &[String]) -> Result<Vec<Notification>, Box<dyn Error>> {
        if block_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=block_ids.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE block_id IN ({}) ORDER BY fired_at DESC",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = block_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let notifs = stmt.query_map(params.as_slice(), |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(notifs)
    }
    fn find_by_event(&self, block_id: &str, kind: &str, event_iso: &str) -> Result<Option<Notification>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE block_id = ? AND kind = ? AND event_iso = ? LIMIT 1"
        )?;
        let result = stmt.query_row(params![block_id, kind, event_iso], |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        });
        match result {
            Ok(n) => Ok(Some(n)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn query_unread(&self) -> Result<Vec<Notification>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE status = 'unread' ORDER BY fired_at DESC"
        )?;
        let notifs = stmt.query_map([], |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        let mut result = Vec::new();
        for n in notifs {
            result.push(n?);
        }
        Ok(result)
    }

    fn query_pending_due(&self, now_ms: i64) -> Result<Vec<Notification>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE status = 'pending' AND snooze_until IS NOT NULL AND snooze_until <= ? ORDER BY snooze_until ASC"
        )?;
        let notifs = stmt.query_map(params![now_ms], |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        let mut result = Vec::new();
        for n in notifs {
            result.push(n?);
        }
        Ok(result)
    }

    fn query_recent(&self, limit: usize) -> Result<Vec<Notification>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE status IN ('unread', 'read') ORDER BY fired_at DESC LIMIT ?"
        )?;
        let notifs = stmt.query_map(params![limit as i64], |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        let mut result = Vec::new();
        for n in notifs {
            result.push(n?);
        }
        Ok(result)
    }

    fn create(&mut self, notification: &Notification) -> Result<Notification, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Notification (id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                notification.id,
                notification.block_id,
                notification.page_id,
                notification.kind,
                notification.event_iso,
                notification.fired_at,
                notification.status,
                notification.snooze_until,
                notification.payload,
                notification.created_at,
                notification.updated_at,
            ],
        )?;
        Ok(notification.clone())
    }

    fn batch_create(&mut self, notifications: &[Notification]) -> Result<Vec<Notification>, Box<dyn Error>> {
        for n in notifications {
            self.conn.execute(
                "INSERT INTO Notification (id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    n.id, n.block_id, n.page_id, n.kind, n.event_iso, n.fired_at,
                    n.status, n.snooze_until, n.payload, n.created_at, n.updated_at,
                ],
            )?;
        }
        Ok(notifications.to_vec())
    }

    fn update_status(&mut self, id: &str, status: &str) -> Result<Notification, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Notification SET status = ?, updated_at = ? WHERE id = ?",
            params![status, chrono::Utc::now().timestamp_millis(), id],
        )?;
        crate::NotificationRepository::get_by_id(self, id)
    }

    fn set_snooze(&mut self, id: &str, snooze_until: i64, status: &str) -> Result<Notification, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Notification SET snooze_until = ?, status = ?, updated_at = ? WHERE id = ?",
            params![snooze_until, status, chrono::Utc::now().timestamp_millis(), id],
        )?;
        crate::NotificationRepository::get_by_id(self, id)
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Notification WHERE id = ?", params![id])?;
        Ok(())
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Notification WHERE block_id = ?", params![block_id])?;
        Ok(())
    }

    fn delete_by_block_and_kind(&mut self, block_id: &str, kind: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Notification WHERE block_id = ? AND kind = ?", params![block_id, kind])?;
        Ok(())
    }

    fn delete_older_than(&mut self, timestamp: i64) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "DELETE FROM Notification WHERE status = 'read' AND updated_at < ?",
            params![timestamp],
        )?;
        Ok(())
    }

    fn mark_all_read(&mut self) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Notification SET status = 'read', updated_at = ? WHERE status = 'unread'",
            params![chrono::Utc::now().timestamp_millis()],
        )?;
        Ok(())
    }

    fn update_payload(&mut self, id: &str, payload: &str) -> Result<Notification, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Notification SET payload = ?, updated_at = ? WHERE id = ?",
            params![payload, chrono::Utc::now().timestamp_millis(), id],
        )?;
        crate::NotificationRepository::get_by_id(self, id)
    }

    fn reschedule(&mut self, block_id: &str, kind: &str, new_event_iso: &str) -> Result<(), Box<dyn Error>> {
        // 非 recurring 通知原地改期：把匹配 (block_id, kind) 的通知 event_iso 改掉，
        // 状态重置为 unread、清 snooze。event_iso 计算见 DateRefService::compute_event_iso（与 TS 一致）。
        self.conn.execute(
            "UPDATE Notification SET event_iso = ?, status = 'unread', snooze_until = NULL, updated_at = ? WHERE block_id = ? AND kind = ? AND status IN ('unread','read','dismissed')",
            params![new_event_iso, chrono::Utc::now().timestamp_millis(), block_id, kind],
        )?;
        Ok(())
    }

}

impl TransactionalStorageAdapter for SQLiteAdapter {
    fn transaction<R, F>(&mut self, f: F) -> Result<R, Box<dyn Error>>
    where
        F: FnOnce(&mut dyn StorageAdapter) -> Result<R, Box<dyn Error>>,
    {
        let tx = self.conn.transaction()?;
        let mut tx_adapter = SQLiteTransactionAdapter { conn: tx };
        let result = f(&mut tx_adapter)?;
        tx_adapter.conn.commit()?;
        Ok(result)
    }
}

struct SQLiteTransactionAdapter<'a> {
    conn: rusqlite::Transaction<'a>,
}

impl<'a> BlockRepository for SQLiteTransactionAdapter<'a> {
    fn get_all(&self) -> Result<Vec<Block>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at FROM Block WHERE deleted_at IS NULL"
        )?;
        let blocks = stmt.query_map([], |row| {
            Ok(Block {
                id: row.get(0)?,
                page_id: row.get(1)?,
                parent_id: row.get(2)?,
                pos: row.get(3)?,
                content: row.get(4)?,
                format: row.get(5)?,
                r#type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                version: row.get(9)?,
                deleted_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(blocks)
    }

    fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at 
             FROM Block WHERE id = ?1 AND deleted_at IS NULL"
        )?;
        
        let block = stmt.query_row(params![id], |row| {
            Ok(Block {
                id: row.get(0)?,
                page_id: row.get(1)?,
                parent_id: row.get(2)?,
                pos: row.get(3)?,
                content: row.get(4)?,
                format: row.get(5)?,
                r#type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                version: row.get(9)?,
                deleted_at: row.get(10)?,
            })
        })?;
        
        Ok(block)
    }
    
    fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at 
             FROM Block WHERE page_id = ?1 AND deleted_at IS NULL ORDER BY pos"
        )?;
        
        let blocks = stmt.query_map(params![page_id], |row| {
            Ok(Block {
                id: row.get(0)?,
                page_id: row.get(1)?,
                parent_id: row.get(2)?,
                pos: row.get(3)?,
                content: row.get(4)?,
                format: row.get(5)?,
                r#type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                version: row.get(9)?,
                deleted_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(blocks)
    }
    
    fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at 
             FROM Block WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY pos"
        )?;
        
        let blocks = stmt.query_map(params![parent_id], |row| {
            Ok(Block {
                id: row.get(0)?,
                page_id: row.get(1)?,
                parent_id: row.get(2)?,
                pos: row.get(3)?,
                content: row.get(4)?,
                format: row.get(5)?,
                r#type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                version: row.get(9)?,
                deleted_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(blocks)
    }


    fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Block>, Box<dyn Error>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at FROM Block WHERE id IN ({}) AND deleted_at IS NULL",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let blocks = stmt.query_map(params.as_slice(), |row| {
            Ok(Block {
                id: row.get(0)?,
                page_id: row.get(1)?,
                parent_id: row.get(2)?,
                pos: row.get(3)?,
                content: row.get(4)?,
                format: row.get(5)?,
                r#type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                version: row.get(9)?,
                deleted_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(blocks)
    }

    
    fn create(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Block (id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                block.id,
                block.page_id,
                block.parent_id,
                block.pos,
                block.content,
                block.format,
                block.r#type,
                block.created_at,
                block.updated_at,
                block.version,
                block.deleted_at
            ]
        )?;
        
        self.update_search_index(block)?;
        
        Ok(block.clone())
    }
    
    fn update(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Block SET page_id = ?2, parent_id = ?3, pos = ?4, content = ?5, format = ?6, type = ?7, updated_at = ?8, version = version + 1
             WHERE id = ?1",
            params![
                block.id,
                block.page_id,
                block.parent_id,
                block.pos,
                block.content,
                block.format,
                block.r#type,
                block.updated_at
            ]
        )?;
        
        self.update_search_index(block)?;
        
        Ok(block.clone())
    }
    
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Block SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        
        self.conn.execute(
            "DELETE FROM SearchIndex WHERE block_id = ?1",
            params![id]
        )?;
        
        Ok(())
    }
    
    fn delete_by_page_id(&mut self, page_id: &str) -> Result<(), Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM Block WHERE page_id = ?1 AND deleted_at IS NULL"
        )?;
        let block_ids: Vec<String> = stmt.query_map(params![page_id], |row| {
            row.get(0)
        })?.collect::<Result<_, _>>()?;
        
        self.conn.execute(
            "UPDATE Block SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE page_id = ?1",
            params![page_id, chrono::Utc::now().timestamp_millis()]
        )?;
        
        for block_id in block_ids {
            self.conn.execute(
                "DELETE FROM SearchIndex WHERE block_id = ?1",
                params![block_id]
            )?;
        }
        
        Ok(())
    }
}

impl<'a> SQLiteTransactionAdapter<'a> {
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

impl<'a> PageRepository for SQLiteTransactionAdapter<'a> {
    fn get_by_id(&self, id: &str) -> Result<Page, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at
             FROM Page WHERE id = ?1 AND deleted_at IS NULL"
        )?;

        let page = stmt.query_row(params![id], |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        })?;

        Ok(page)
    }

    fn get_by_title_including_deleted(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
        let sql = "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at FROM Page WHERE title = ?1";
        let mut stmt = self.conn.prepare(sql)?;

        let result = stmt.query_row(params![title], |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        });

        match result {
            Ok(page) => Ok(Some(page)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at
             FROM Page WHERE title = ?1 AND deleted = 0 AND deleted_at IS NULL"
        )?;

        let result = stmt.query_row(params![title], |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        });

        match result {
            Ok(page) => Ok(Some(page)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn get_all(&self) -> Result<Vec<Page>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at
             FROM Page WHERE deleted = 0 AND deleted_at IS NULL ORDER BY updated_at DESC"
        )?;

        let pages = stmt.query_map([], |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(pages)
    }

    fn get_trash(&self) -> Result<Vec<Page>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at
             FROM Page WHERE deleted = 1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC"
        )?;

        let pages = stmt.query_map([], |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(pages)
    }


    fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Page>, Box<dyn Error>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at FROM Page WHERE id IN ({}) AND deleted_at IS NULL",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let pages = stmt.query_map(params.as_slice(), |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(pages)
    }

    fn get_ideas_by_month(&self, year: i32, month: u32) -> Result<Vec<Page>, Box<dyn Error>> {
        let start = format!("{}-{:02}-01", year, month);
        let end = if month == 12 {
            format!("{}-01-01", year + 1)
        } else {
            format!("{}-{:02}-01", year, month + 1)
        };
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at
             FROM Page WHERE type IN ('ideas', 'journal') AND deleted = 0 AND deleted_at IS NULL AND title >= ?1 AND title < ?2 ORDER BY title DESC"
        )?;
        let pages = stmt.query_map(params![start, end], |row| {
            Ok(Page {
                id: row.get(0)?,
                block_id: row.get(1)?,
                title: row.get(2)?,
                r#type: row.get(3)?,
                icon: row.get(4)?,
                cover: row.get(5)?,
                aliases: row.get(6)?,
                file_path: row.get(7)?,
                children_count: row.get(8)?,
                word_count: row.get(9)?,
                deleted: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                version: row.get(13)?,
                deleted_at: row.get(14)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(pages)
    }

    fn get_ideas_months(&self) -> Result<Vec<String>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT substr(title, 1, 7) AS month
             FROM Page
             WHERE type IN ('ideas', 'journal') AND deleted = 0 AND deleted_at IS NULL
             ORDER BY month DESC"
        )?;
        let months = stmt.query_map([], |row| {
            Ok(row.get::<_, String>(0)?)
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(months)
    }

    fn create(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Page (id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at, version, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                page.id,
                page.block_id,
                page.title,
                page.r#type,
                page.icon,
                page.cover,
                page.aliases,
                page.file_path,
                page.children_count,
                page.word_count,
                page.deleted,
                page.created_at,
                page.updated_at,
                page.version,
                page.deleted_at
            ]
        )?;

        Ok(page.clone())
    }

    fn update(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Page SET block_id = ?2, title = ?3, type = ?4, icon = ?5, cover = ?6, aliases = ?7, file_path = ?8, children_count = ?9, word_count = ?10, deleted = ?11, updated_at = ?12, version = version + 1
             WHERE id = ?1",
            params![
                page.id,
                page.block_id,
                page.title,
                page.r#type,
                page.icon,
                page.cover,
                page.aliases,
                page.file_path,
                page.children_count,
                page.word_count,
                page.deleted,
                page.updated_at
            ]
        )?;

        Ok(page.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Page SET deleted = 1, deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
}

impl<'a> LinkRepository for SQLiteTransactionAdapter<'a> {
    fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at
             FROM Link WHERE id = ?1 AND deleted_at IS NULL"
        )?;

        let link = stmt.query_row(params![id], |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                version: row.get(7)?,
                deleted_at: row.get(8)?,
            })
        })?;
        
        Ok(link)
    }
    
    fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at
             FROM Link WHERE source_block_id = ?1 AND deleted_at IS NULL"
        )?;

        let links = stmt.query_map(params![source_block_id], |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                version: row.get(7)?,
                deleted_at: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(links)
    }

    fn get_by_source_block_ids(&self, source_block_ids: &[String]) -> Result<Vec<Link>, Box<dyn Error>> {
        if source_block_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=source_block_ids.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at
             FROM Link WHERE source_block_id IN ({}) AND deleted_at IS NULL",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = source_block_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let links = stmt.query_map(params.as_slice(), |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                version: row.get(7)?,
                deleted_at: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(links)
    }
    
    fn get_by_target_page_id(&self, target_page_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at
             FROM Link WHERE target_page_id = ?1 AND deleted_at IS NULL"
        )?;

        let links = stmt.query_map(params![target_page_id], |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                version: row.get(7)?,
                deleted_at: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(links)
    }
    
    fn create(&mut self, link: &Link) -> Result<Link, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Link (id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                link.id,
                link.source_block_id,
                link.target_page_id,
                link.display_text,
                link.relationship_type,
                link.created_at,
                link.updated_at,
                link.version,
                link.deleted_at
            ]
        )?;

        Ok(link.clone())
    }

    fn create_many(&mut self, links: &[Link]) -> Result<Vec<Link>, Box<dyn Error>> {
        for link in links {
            self.conn.execute(
                "INSERT INTO Link (id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
                params![
                    link.id,
                    link.source_block_id,
                    link.target_page_id,
                    link.display_text,
                    link.relationship_type,
                    link.created_at,
                    link.updated_at,
                    link.version
                ]
            )?;
        }

        Ok(links.to_vec())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Link SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }

    fn delete_by_source_block_id(&mut self, source_block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Link SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE source_block_id = ?1",
            params![source_block_id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }

    fn delete_by_target_page_id(&mut self, target_page_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Link SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE target_page_id = ?1",
            params![target_page_id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
}

impl<'a> PropertyRepository for SQLiteTransactionAdapter<'a> {
    fn get_all(&self) -> Result<Vec<Property>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at FROM Property WHERE is_deleted = 0 AND deleted_at IS NULL"
        )?;
        let properties = stmt.query_map([], |row| {
            Ok(Property {
                id: row.get(0)?,
                block_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                r#type: row.get(4)?,
                sort_order: row.get(5)?,
                is_hidden: row.get(6)?,
                is_deleted: row.get(7)?,
                schema_version: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                version: row.get(11)?,
                deleted_at: row.get(12)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(properties)
    }

    fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at
             FROM Property WHERE id = ?1 AND deleted_at IS NULL"
        )?;

        let property = stmt.query_row(params![id], |row| {
            Ok(Property {
                id: row.get(0)?,
                block_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                r#type: row.get(4)?,
                sort_order: row.get(5)?,
                is_hidden: row.get(6)?,
                is_deleted: row.get(7)?,
                schema_version: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                version: row.get(11)?,
                deleted_at: row.get(12)?,
            })
        })?;

        Ok(property)
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at
             FROM Property WHERE block_id = ?1 AND is_deleted = 0 AND deleted_at IS NULL ORDER BY sort_order"
        )?;

        let properties = stmt.query_map(params![block_id], |row| {
            Ok(Property {
                id: row.get(0)?,
                block_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                r#type: row.get(4)?,
                sort_order: row.get(5)?,
                is_hidden: row.get(6)?,
                is_deleted: row.get(7)?,
                schema_version: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                version: row.get(11)?,
                deleted_at: row.get(12)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(properties)
    }

    fn get_by_block_ids(&self, block_ids: &[String]) -> Result<Vec<Property>, Box<dyn Error>> {
        if block_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=block_ids.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at
             FROM Property WHERE block_id IN ({}) AND is_deleted = 0 AND deleted_at IS NULL ORDER BY sort_order",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = block_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let properties = stmt.query_map(params.as_slice(), |row| {
            Ok(Property {
                id: row.get(0)?,
                block_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                r#type: row.get(4)?,
                sort_order: row.get(5)?,
                is_hidden: row.get(6)?,
                is_deleted: row.get(7)?,
                schema_version: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                version: row.get(11)?,
                deleted_at: row.get(12)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(properties)
    }

    fn get_by_block_id_and_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at
             FROM Property WHERE block_id = ?1 AND key = ?2 AND is_deleted = 0 AND deleted_at IS NULL"
        )?;

        let result = stmt.query_row(params![block_id, key], |row| {
            Ok(Property {
                id: row.get(0)?,
                block_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                r#type: row.get(4)?,
                sort_order: row.get(5)?,
                is_hidden: row.get(6)?,
                is_deleted: row.get(7)?,
                schema_version: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                version: row.get(11)?,
                deleted_at: row.get(12)?,
            })
        });

        match result {
            Ok(property) => Ok(Some(property)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn query_block_ids_by_key_value(&self, key: &str, values: &[String]) -> Result<Vec<String>, Box<dyn Error>> {
        if values.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = values.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT DISTINCT block_id FROM Property WHERE key = ? AND value IN ({}) AND is_deleted = 0 AND deleted_at IS NULL",
            placeholders
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        params_vec.push(Box::new(key.to_string()));
        for v in values {
            params_vec.push(Box::new(v.clone()));
        }
        let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        let ids = stmt.query_map(param_refs.as_slice(), |row| {
            row.get::<_, String>(0)
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(ids)
    }

    fn create(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Property (id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                property.id,
                property.block_id,
                property.key,
                property.value,
                property.r#type,
                property.sort_order,
                property.is_hidden,
                property.is_deleted,
                property.schema_version,
                property.created_at,
                property.updated_at,
                property.version,
                property.deleted_at
            ]
        )?;

        Ok(property.clone())
    }
    fn upsert(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Property (id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(block_id, key) DO UPDATE SET
                value = excluded.value,
                type = excluded.type,
                updated_at = excluded.updated_at,
                sort_order = excluded.sort_order,
                is_hidden = excluded.is_hidden,
                schema_version = excluded.schema_version,
                is_deleted = 0,
                deleted_at = NULL",
            params![
                property.id,
                property.block_id,
                property.key,
                property.value,
                property.r#type,
                property.sort_order,
                property.is_hidden,
                property.is_deleted,
                property.schema_version,
                property.created_at,
                property.updated_at,
                property.version,
                property.deleted_at
            ]
        )?;
        Ok(property.clone())
    }


    fn update(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Property SET value = ?2, type = ?3, sort_order = ?4, is_hidden = ?5, is_deleted = ?6, updated_at = ?7, version = version + 1
             WHERE id = ?1",
            params![
                property.id,
                property.value,
                property.r#type,
                property.sort_order,
                property.is_hidden,
                property.is_deleted,
                property.updated_at
            ]
        )?;

        Ok(property.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Property SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Property SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE block_id = ?1",
            params![block_id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
}

impl<'a> RelationshipTypeRepository for SQLiteTransactionAdapter<'a> {
    fn get_by_id(&self, id: &str) -> Result<RelationshipType, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, inverse, label, inverse_label, color, `order`, strength, deleted, builtin, created_at, updated_at
             FROM RelationshipType WHERE id = ?1"
        )?;

        let rt = stmt.query_row(params![id], |row| {
            Ok(RelationshipType {
                id: row.get(0)?,
                r#type: row.get(1)?,
                inverse: row.get(2)?,
                label: row.get(3)?,
                inverse_label: row.get(4)?,
                color: row.get(5)?,
                order: row.get(6)?,
                strength: row.get(7)?,
                deleted: row.get(8)?,
                builtin: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?;

        Ok(rt)
    }

    fn get_by_type(&self, r#type: &str) -> Result<Option<RelationshipType>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, inverse, label, inverse_label, color, `order`, strength, deleted, builtin, created_at, updated_at
             FROM RelationshipType WHERE type = ?1 AND deleted = 0"
        )?;

        let result = stmt.query_row(params![r#type], |row| {
            Ok(RelationshipType {
                id: row.get(0)?,
                r#type: row.get(1)?,
                inverse: row.get(2)?,
                label: row.get(3)?,
                inverse_label: row.get(4)?,
                color: row.get(5)?,
                order: row.get(6)?,
                strength: row.get(7)?,
                deleted: row.get(8)?,
                builtin: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        });

        match result {
            Ok(rt) => Ok(Some(rt)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn get_all(&self) -> Result<Vec<RelationshipType>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, inverse, label, inverse_label, color, `order`, strength, deleted, builtin, created_at, updated_at
             FROM RelationshipType WHERE deleted = 0 ORDER BY `order`"
        )?;

        let rts = stmt.query_map([], |row| {
            Ok(RelationshipType {
                id: row.get(0)?,
                r#type: row.get(1)?,
                inverse: row.get(2)?,
                label: row.get(3)?,
                inverse_label: row.get(4)?,
                color: row.get(5)?,
                order: row.get(6)?,
                strength: row.get(7)?,
                deleted: row.get(8)?,
                builtin: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(rts)
    }

    fn create(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO RelationshipType (id, type, inverse, label, inverse_label, color, `order`, strength, deleted, builtin, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                rt.id,
                rt.r#type,
                rt.inverse,
                rt.label,
                rt.inverse_label,
                rt.color,
                rt.order,
                rt.strength,
                rt.deleted,
                rt.builtin,
                rt.created_at,
                rt.updated_at
            ]
        )?;

        Ok(rt.clone())
    }

    fn update(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE RelationshipType SET type = ?2, inverse = ?3, label = ?4, inverse_label = ?5, color = ?6, `order` = ?7, strength = ?8, deleted = ?9, updated_at = ?10, version = version + 1
             WHERE id = ?1",
            params![
                rt.id,
                rt.r#type,
                rt.inverse,
                rt.label,
                rt.inverse_label,
                rt.color,
                rt.order,
                rt.strength,
                rt.deleted,
                rt.updated_at
            ]
        )?;

        Ok(rt.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE RelationshipType SET deleted = 1, deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
}

impl<'a> TemplateRepository for SQLiteTransactionAdapter<'a> {
    fn get_by_id(&self, id: &str) -> Result<UserTemplate, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, category, content, created_at, updated_at
             FROM UserTemplate WHERE id = ?1"
        )?;

        let template = stmt.query_row(params![id], |row| {
            Ok(UserTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;

        Ok(template)
    }

    fn get_by_name(&self, name: &str) -> Result<Option<UserTemplate>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, category, content, created_at, updated_at
             FROM UserTemplate WHERE name = ?1"
        )?;

        let result = stmt.query_row(params![name], |row| {
            Ok(UserTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        });

        match result {
            Ok(template) => Ok(Some(template)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn get_all(&self) -> Result<Vec<UserTemplate>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, category, content, created_at, updated_at
             FROM UserTemplate ORDER BY name"
        )?;

        let templates = stmt.query_map([], |row| {
            Ok(UserTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(templates)
    }

    fn create(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO UserTemplate (id, name, category, content, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                template.id,
                template.name,
                template.category,
                template.content,
                template.created_at,
                template.updated_at
            ]
        )?;

        Ok(template.clone())
    }

    fn update(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE UserTemplate SET name = ?2, category = ?3, content = ?4, updated_at = ?5
             WHERE id = ?1",
            params![
                template.id,
                template.name,
                template.category,
                template.content,
                template.updated_at
            ]
        )?;

        Ok(template.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM UserTemplate WHERE id = ?1", params![id])?;
        Ok(())
    }
}

impl<'a> SearchRepository for SQLiteTransactionAdapter<'a> {
    fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT block_id, content, title, bm25(SearchIndex) as score
             FROM SearchIndex
             WHERE SearchIndex MATCH ?1
             ORDER BY bm25(SearchIndex)
             LIMIT ?2"
        )?;

        let fts_query = query.replace(" ", "* ");
        let fts_query = format!("{}*", fts_query);

        let results = stmt.query_map(params![fts_query, limit as i64], |row| {
            let block_id: String = row.get(0)?;
            let content: String = row.get(1)?;
            let title: String = row.get(2)?;
            let score: f64 = row.get(3)?;

            Ok(SearchResult::new(
                &block_id,
                "",
                &title,
                &content,
                score
            ))
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(results)
    }

    fn update_index(&mut self, block_id: &str, content: &str, title: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "DELETE FROM SearchIndex WHERE block_id = ?1",
            params![block_id]
        )?;

        self.conn.execute(
            "INSERT INTO SearchIndex (block_id, content, title) VALUES (?1, ?2, ?3)",
            params![block_id, content, title]
        )?;

        Ok(())
    }

    fn delete_from_index(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "DELETE FROM SearchIndex WHERE block_id = ?1",
            params![block_id]
        )?;
        Ok(())
    }
}

impl<'a> BlockVersionRepository for SQLiteTransactionAdapter<'a> {
    fn get_by_id(&self, id: &str) -> Result<BlockVersion, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, version, snapshot, hash, message, source, restored_from_version_id, created_at 
             FROM BlockVersion WHERE id = ?1"
        )?;
        
        let version = stmt.query_row(params![id], |row| {
            Ok(BlockVersion {
                id: row.get(0)?,
                block_id: row.get(1)?,
                version: row.get(2)?,
                snapshot: row.get(3)?,
                hash: row.get(4)?,
                message: row.get(5)?,
                source: row.get(6)?,
                restored_from_version_id: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;
        
        Ok(version)
    }
    
    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<BlockVersion>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, version, snapshot, hash, message, source, restored_from_version_id, created_at 
             FROM BlockVersion WHERE block_id = ?1 ORDER BY version DESC"
        )?;
        
        let versions = stmt.query_map(params![block_id], |row| {
            Ok(BlockVersion {
                id: row.get(0)?,
                block_id: row.get(1)?,
                version: row.get(2)?,
                snapshot: row.get(3)?,
                hash: row.get(4)?,
                message: row.get(5)?,
                source: row.get(6)?,
                restored_from_version_id: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(versions)
    }
    
    fn get_latest_version(&self, block_id: &str) -> Result<Option<BlockVersion>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, version, snapshot, hash, message, source, restored_from_version_id, created_at 
             FROM BlockVersion WHERE block_id = ?1 ORDER BY version DESC LIMIT 1"
        )?;
        
        let result = stmt.query_row(params![block_id], |row| {
            Ok(BlockVersion {
                id: row.get(0)?,
                block_id: row.get(1)?,
                version: row.get(2)?,
                snapshot: row.get(3)?,
                hash: row.get(4)?,
                message: row.get(5)?,
                source: row.get(6)?,
                restored_from_version_id: row.get(7)?,
                created_at: row.get(8)?,
            })
        });
        
        match result {
            Ok(version) => Ok(Some(version)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }
    
    fn create(&mut self, version: &BlockVersion) -> Result<BlockVersion, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO BlockVersion (id, block_id, version, snapshot, hash, message, source, restored_from_version_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                version.id,
                version.block_id,
                version.version,
                version.snapshot,
                version.hash,
                version.message,
                version.source,
                version.restored_from_version_id,
                version.created_at
            ]
        )?;
        
        Ok(version.clone())
    }
    
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM BlockVersion WHERE id = ?1", params![id])?;
        Ok(())
    }
    
    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM BlockVersion WHERE block_id = ?1", params![block_id])?;
        Ok(())
    }
    
    fn delete_older_than(&mut self, block_id: &str, timestamp: i64) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "DELETE FROM BlockVersion WHERE block_id = ?1 AND created_at < ?2",
            params![block_id, timestamp]
        )?;
        Ok(())
    }
}

impl<'a> StorageAdapter for SQLiteTransactionAdapter<'a> {
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

impl<'a> SavedFilterRepository for SQLiteTransactionAdapter<'a> {
    fn get_all(&self) -> Result<Vec<SavedFilter>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, query_json, created_at, updated_at FROM SavedFilter ORDER BY created_at DESC"
        )?;
        let filters = stmt.query_map([], |row| {
            Ok(SavedFilter {
                id: row.get(0)?,
                name: row.get(1)?,
                query_json: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(filters)
    }

    fn get_by_id(&self, id: &str) -> Result<SavedFilter, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, query_json, created_at, updated_at FROM SavedFilter WHERE id = ?1"
        )?;
        let filter = stmt.query_row(params![id], |row| {
            Ok(SavedFilter {
                id: row.get(0)?,
                name: row.get(1)?,
                query_json: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(filter)
    }

    fn create(&mut self, filter: &SavedFilter) -> Result<SavedFilter, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO SavedFilter (id, name, query_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                filter.id,
                filter.name,
                filter.query_json,
                filter.created_at,
                filter.updated_at
            ]
        )?;
        Ok(filter.clone())
    }

    fn update(&mut self, filter: &SavedFilter) -> Result<SavedFilter, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE SavedFilter SET name = ?2, query_json = ?3, updated_at = ?4 WHERE id = ?1",
            params![
                filter.id,
                filter.name,
                filter.query_json,
                filter.updated_at
            ]
        )?;
        Ok(filter.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM SavedFilter WHERE id = ?1", params![id])?;
        Ok(())
    }
}

impl<'a> ScreenViewRepository for SQLiteTransactionAdapter<'a> {
    fn get_all_by_entity(&self, entity: &str) -> Result<Vec<ScreenView>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, query_json, view_type, group_by, is_default, sort_order, COALESCE(config, '') AS config, entity, parent_id, created_at, updated_at FROM screen_view WHERE entity = ?1 ORDER BY sort_order ASC, created_at DESC"
        )?;
        let views = stmt.query_map(params![entity], |row| {
            Ok(ScreenView {
                id: row.get(0)?,
                entity: row.get(8).unwrap_or_else(|_| "block".to_string()),
                parent_id: row.get(9).unwrap_or_default(),
                name: row.get(1)?,
                query_json: row.get(2)?,
                view_type: row.get(3)?,
                group_by: row.get(4)?,
                is_default: row.get(5)?,
                sort_order: row.get(6)?,
                config: row.get(7)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(views)
    }

    fn get_by_id(&self, id: &str) -> Result<ScreenView, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, query_json, view_type, group_by, is_default, sort_order, COALESCE(config, '') AS config, entity, parent_id, created_at, updated_at FROM screen_view WHERE id = ?1"
        )?;
        let view = stmt.query_row(params![id], |row| {
            Ok(ScreenView {
                id: row.get(0)?,
                entity: row.get(8).unwrap_or_else(|_| "block".to_string()),
                parent_id: row.get(9).unwrap_or_default(),
                name: row.get(1)?,
                query_json: row.get(2)?,
                view_type: row.get(3)?,
                group_by: row.get(4)?,
                is_default: row.get(5)?,
                sort_order: row.get(6)?,
                config: row.get(7)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?;
        Ok(view)
    }

    fn create(&mut self, view: &ScreenView) -> Result<ScreenView, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO screen_view (id, entity, parent_id, name, query_json, view_type, group_by, is_default, sort_order, config, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                view.id,
                view.entity,
                view.parent_id,
                view.name,
                view.query_json,
                view.view_type,
                view.group_by,
                view.is_default,
                view.sort_order,
                view.config,
                view.created_at,
                view.updated_at
            ]
        )?;
        Ok(view.clone())
    }

    fn update(&mut self, view: &ScreenView) -> Result<ScreenView, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE screen_view SET parent_id = ?2, name = ?3, query_json = ?4, view_type = ?5, group_by = ?6, is_default = ?7, sort_order = ?8, config = ?9, updated_at = ?10 WHERE id = ?1",
            params![
                view.id,
                view.parent_id,
                view.name,
                view.query_json,
                view.view_type,
                view.group_by,
                view.is_default,
                view.sort_order,
                view.config,
                view.updated_at
            ]
        )?;
        Ok(view.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM screen_view WHERE id = ?1", params![id])?;
        Ok(())
    }
}

impl<'a> DateRefRepository for SQLiteTransactionAdapter<'a> {
    fn get_all(&self) -> Result<Vec<DateRef>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, created_at, event_ts, updated_at, version, deleted_at FROM DateRef WHERE deleted_at IS NULL"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    fn get_by_id(&self, id: &str) -> Result<DateRef, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, created_at, event_ts, updated_at, version, deleted_at FROM DateRef WHERE id = ? AND deleted_at IS NULL"
        )?;
        let dr = stmt.query_row(params![id], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
})
        });
        match dr {
            Ok(d) => Ok(d),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "DateRef not found"))),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, created_at, event_ts, updated_at, version, deleted_at FROM DateRef WHERE block_id = ? AND deleted_at IS NULL"
        )?;
        let rows = stmt.query_map(params![block_id], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
})
        })?;
        let mut result = Vec::new();
        for r in rows { result.push(r?); }
        Ok(result)
    }

    fn query_by_date_range(&self, kind: &str, from: &str, to: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, created_at, event_ts, updated_at, version, deleted_at FROM DateRef WHERE (kind = ?1 OR ?1 = '*') AND date_day BETWEEN ?2 AND ?3 AND deleted_at IS NULL ORDER BY date_day, block_id"
        )?;
        let rows = stmt.query_map(params![kind, from, to], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
})
        })?;
        let mut result = Vec::new();
        for r in rows { result.push(r?); }
        Ok(result)
    }

    fn query_overdue(&self, today: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, created_at, event_ts, updated_at, version, deleted_at FROM DateRef WHERE kind = 'deadline' AND date_day < ? AND deleted_at IS NULL ORDER BY date_day"
        )?;
        let rows = stmt.query_map(params![today], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
})
        })?;
        let mut result = Vec::new();
        for r in rows { result.push(r?); }
        Ok(result)
    }

    fn query_due_non_recurring(&self, now_ms: i64) -> Result<Vec<DateRef>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, event_ts, created_at, updated_at, version, deleted_at FROM DateRef WHERE recurrence = 'none' AND kind != 'ref' AND (event_ts - lead_minutes * 60000) <= ?1 AND deleted_at IS NULL"
        )?;
        let rows = stmt.query_map(params![now_ms], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
            })
        })?;
        let mut result = Vec::new();
        for r in rows { result.push(r?); }
        Ok(result)
    }

    fn query_all_recurring(&self) -> Result<Vec<DateRef>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, kind, iso, date_day, recurrence, lead_minutes, event_ts, created_at, updated_at, version, deleted_at FROM DateRef WHERE recurrence != 'none' AND kind != 'ref' AND deleted_at IS NULL"
        )?;
        let rows = stmt.query_map(params![], |row| {
            Ok(DateRef {
                id: row.get(0)?,
                block_id: row.get(1)?,
                kind: row.get(2)?,
                iso: row.get(3)?,
                date_day: row.get(4)?,
                recurrence: row.get(5)?,
                lead_minutes: row.get(6)?,
                event_ts: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
                deleted_at: row.get(11)?,
            })
        })?;
        let mut result = Vec::new();
        for r in rows { result.push(r?); }
        Ok(result)
    }

    fn create(&mut self, date_ref: &DateRef) -> Result<DateRef, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO DateRef (id, block_id, kind, iso, date_day, recurrence, lead_minutes, event_ts, created_at, updated_at, version, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![date_ref.id, date_ref.block_id, date_ref.kind, date_ref.iso, date_ref.date_day, date_ref.recurrence, date_ref.lead_minutes, date_ref.event_ts, date_ref.created_at, date_ref.updated_at, date_ref.version, date_ref.deleted_at],
        )?;
        Ok(date_ref.clone())
    }

    fn create_many(&mut self, date_refs: &[DateRef]) -> Result<Vec<DateRef>, Box<dyn Error>> {
        for dr in date_refs {
            DateRefRepository::create(self, dr)?;
        }
        Ok(date_refs.to_vec())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE DateRef SET deleted_at = ?1, version = version + 1, updated_at = ?1 WHERE id = ?2",
            params![chrono::Utc::now().timestamp_millis(), id]
        )?;
        Ok(())
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE DateRef SET deleted_at = ?1, version = version + 1, updated_at = ?1 WHERE block_id = ?2",
            params![chrono::Utc::now().timestamp_millis(), block_id]
        )?;
        Ok(())
    }
}

impl<'a> NotificationRepository for SQLiteTransactionAdapter<'a> {
    fn get_by_id(&self, id: &str) -> Result<Notification, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE id = ?"
        )?;
        let notif = stmt.query_row(params![id], |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        Ok(notif)
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Notification>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE block_id = ? ORDER BY fired_at DESC"
        )?;
        let notifs = stmt.query_map(params![block_id], |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        let mut result = Vec::new();
        for n in notifs {
            result.push(n?);
        }
        Ok(result)
    }


    fn get_by_block_ids(&self, block_ids: &[String]) -> Result<Vec<Notification>, Box<dyn Error>> {
        if block_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=block_ids.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE block_id IN ({}) ORDER BY fired_at DESC",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = block_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let notifs = stmt.query_map(params.as_slice(), |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(notifs)
    }


    fn find_by_event(&self, block_id: &str, kind: &str, event_iso: &str) -> Result<Option<Notification>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE block_id = ? AND kind = ? AND event_iso = ? LIMIT 1"
        )?;
        let result = stmt.query_row(params![block_id, kind, event_iso], |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        });
        match result {
            Ok(n) => Ok(Some(n)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn query_unread(&self) -> Result<Vec<Notification>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE status = 'unread' ORDER BY fired_at DESC"
        )?;
        let notifs = stmt.query_map([], |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        let mut result = Vec::new();
        for n in notifs {
            result.push(n?);
        }
        Ok(result)
    }

    fn query_pending_due(&self, now_ms: i64) -> Result<Vec<Notification>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE status = 'pending' AND snooze_until IS NOT NULL AND snooze_until <= ? ORDER BY snooze_until ASC"
        )?;
        let notifs = stmt.query_map(params![now_ms], |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        let mut result = Vec::new();
        for n in notifs {
            result.push(n?);
        }
        Ok(result)
    }

    fn query_recent(&self, limit: usize) -> Result<Vec<Notification>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at FROM Notification WHERE status IN ('unread', 'read') ORDER BY fired_at DESC LIMIT ?"
        )?;
        let notifs = stmt.query_map(params![limit as i64], |row| {
            Ok(Notification {
                id: row.get(0)?,
                block_id: row.get(1)?,
                page_id: row.get(2)?,
                kind: row.get(3)?,
                event_iso: row.get(4)?,
                fired_at: row.get(5)?,
                status: row.get(6)?,
                snooze_until: row.get(7)?,
                payload: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        let mut result = Vec::new();
        for n in notifs {
            result.push(n?);
        }
        Ok(result)
    }

    fn create(&mut self, notification: &Notification) -> Result<Notification, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Notification (id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                notification.id,
                notification.block_id,
                notification.page_id,
                notification.kind,
                notification.event_iso,
                notification.fired_at,
                notification.status,
                notification.snooze_until,
                notification.payload,
                notification.created_at,
                notification.updated_at,
            ],
        )?;
        Ok(notification.clone())
    }

    fn batch_create(&mut self, notifications: &[Notification]) -> Result<Vec<Notification>, Box<dyn Error>> {
        for n in notifications {
            self.conn.execute(
                "INSERT INTO Notification (id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    n.id, n.block_id, n.page_id, n.kind, n.event_iso, n.fired_at,
                    n.status, n.snooze_until, n.payload, n.created_at, n.updated_at,
                ],
            )?;
        }
        Ok(notifications.to_vec())
    }

    fn update_status(&mut self, id: &str, status: &str) -> Result<Notification, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Notification SET status = ?, updated_at = ? WHERE id = ?",
            params![status, chrono::Utc::now().timestamp_millis(), id],
        )?;
        crate::NotificationRepository::get_by_id(self, id)
    }

    fn set_snooze(&mut self, id: &str, snooze_until: i64, status: &str) -> Result<Notification, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Notification SET snooze_until = ?, status = ?, updated_at = ? WHERE id = ?",
            params![snooze_until, status, chrono::Utc::now().timestamp_millis(), id],
        )?;
        crate::NotificationRepository::get_by_id(self, id)
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Notification WHERE id = ?", params![id])?;
        Ok(())
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Notification WHERE block_id = ?", params![block_id])?;
        Ok(())
    }

    fn delete_by_block_and_kind(&mut self, block_id: &str, kind: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Notification WHERE block_id = ? AND kind = ?", params![block_id, kind])?;
        Ok(())
    }

    fn delete_older_than(&mut self, timestamp: i64) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "DELETE FROM Notification WHERE status = 'read' AND updated_at < ?",
            params![timestamp],
        )?;
        Ok(())
    }

    fn mark_all_read(&mut self) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Notification SET status = 'read', updated_at = ? WHERE status = 'unread'",
            params![chrono::Utc::now().timestamp_millis()],
        )?;
        Ok(())
    }

    fn update_payload(&mut self, id: &str, payload: &str) -> Result<Notification, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Notification SET payload = ?, updated_at = ? WHERE id = ?",
            params![payload, chrono::Utc::now().timestamp_millis(), id],
        )?;
        crate::NotificationRepository::get_by_id(self, id)
    }

    fn reschedule(&mut self, block_id: &str, kind: &str, new_event_iso: &str) -> Result<(), Box<dyn Error>> {
        // 非 recurring 通知原地改期：把匹配 (block_id, kind) 的通知 event_iso 改掉，
        // 状态重置为 unread、清 snooze。event_iso 计算见 DateRefService::compute_event_iso（与 TS 一致）。
        self.conn.execute(
            "UPDATE Notification SET event_iso = ?, status = 'unread', snooze_until = NULL, updated_at = ? WHERE block_id = ? AND kind = ? AND status IN ('unread','read','dismissed')",
            params![new_event_iso, chrono::Utc::now().timestamp_millis(), block_id, kind],
        )?;
        Ok(())
    }

}

impl<'a> NotificationConfigRepository for SQLiteTransactionAdapter<'a> {
    fn get(&self) -> Result<NotificationConfig, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, enabled, schedule_enabled, deadline_enabled, overdue_enabled, quiet_hours_start, quiet_hours_end, web_browser_notifications_enabled FROM notification_config WHERE id = 1"
        )?;
        let config = stmt.query_row([], |row| {
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
        })?;
        Ok(config)
    }

    fn save(&mut self, config: &NotificationConfig) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO notification_config (id, enabled, schedule_enabled, deadline_enabled, overdue_enabled, quiet_hours_start, quiet_hours_end, web_browser_notifications_enabled)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, schedule_enabled=excluded.schedule_enabled, deadline_enabled=excluded.deadline_enabled, overdue_enabled=excluded.overdue_enabled, quiet_hours_start=excluded.quiet_hours_start, quiet_hours_end=excluded.quiet_hours_end, web_browser_notifications_enabled=excluded.web_browser_notifications_enabled",
            params![config.enabled as i64, config.schedule_enabled as i64, config.deadline_enabled as i64, config.overdue_enabled as i64, config.quiet_hours_start, config.quiet_hours_end, config.web_browser_notifications_enabled as i64],
        )?;
        Ok(())
    }
}
