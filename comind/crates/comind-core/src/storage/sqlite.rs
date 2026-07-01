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
                FOREIGN KEY (page_id) REFERENCES Page(id)
            );
            
            CREATE TABLE IF NOT EXISTS Link (
                id              TEXT PRIMARY KEY,
                source_block_id TEXT NOT NULL,
                target_page_id  TEXT NOT NULL,
                display_text    TEXT NOT NULL,
                relationship_type TEXT,
                created_at      INTEGER NOT NULL,
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
                updated_at      INTEGER NOT NULL
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
            
            CREATE INDEX IF NOT EXISTS idx_page_blockId        ON Page(block_id);
            CREATE INDEX IF NOT EXISTS idx_page_type           ON Page(type);
            CREATE INDEX IF NOT EXISTS idx_page_updatedAt      ON Page(updated_at);
            CREATE INDEX IF NOT EXISTS idx_block_pageId    ON Block(page_id);
            CREATE INDEX IF NOT EXISTS idx_block_parentId  ON Block(parent_id);
            CREATE INDEX IF NOT EXISTS idx_block_pos       ON Block(pos);
            CREATE INDEX IF NOT EXISTS idx_link_target     ON Link(target_page_id);
            CREATE INDEX IF NOT EXISTS idx_link_source     ON Link(source_block_id);
            CREATE INDEX IF NOT EXISTS idx_property_blockId ON Property(block_id);
            CREATE INDEX IF NOT EXISTS idx_property_key    ON Property(key);"
        )?;
        
        Self::migrate_add_page_title_unique(conn)?;
        
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
}

impl BlockRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at 
             FROM Block WHERE id = ?1"
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
            })
        })?;
        
        Ok(block)
    }
    
    fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at 
             FROM Block WHERE page_id = ?1 ORDER BY pos"
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
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(blocks)
    }
    
    fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at 
             FROM Block WHERE parent_id = ?1 ORDER BY pos"
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
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(blocks)
    }
    
    fn create(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Block (id, page_id, parent_id, pos, content, format, type, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                block.id,
                block.page_id,
                block.parent_id,
                block.pos,
                block.content,
                block.format,
                block.r#type,
                block.created_at,
                block.updated_at
            ]
        )?;
        
        self.update_search_index(block)?;
        
        Ok(block.clone())
    }
    
    fn update(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Block SET page_id = ?2, parent_id = ?3, pos = ?4, content = ?5, format = ?6, type = ?7, updated_at = ?8
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
        self.conn.execute("DELETE FROM Block WHERE id = ?1", params![id])?;
        
        self.conn.execute(
            "DELETE FROM SearchIndex WHERE block_id = ?1",
            params![id]
        )?;
        
        Ok(())
    }
    
    fn delete_by_page_id(&mut self, page_id: &str) -> Result<(), Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM Block WHERE page_id = ?1"
        )?;
        let block_ids: Vec<String> = stmt.query_map(params![page_id], |row| {
            row.get(0)
        })?.collect::<Result<_, _>>()?;
        
        self.conn.execute("DELETE FROM Block WHERE page_id = ?1", params![page_id])?;
        
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
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at 
             FROM Page WHERE id = ?1"
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
            })
        })?;
        
        Ok(page)
    }
    
    fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at 
             FROM Page WHERE title = ?1 AND deleted = 0"
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
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at 
             FROM Page WHERE deleted = 0 ORDER BY updated_at DESC"
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
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(pages)
    }
    
    fn create(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Page (id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
                page.updated_at
            ]
        )?;
        
        Ok(page.clone())
    }
    
    fn update(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Page SET block_id = ?2, title = ?3, type = ?4, icon = ?5, cover = ?6, aliases = ?7, file_path = ?8, children_count = ?9, word_count = ?10, deleted = ?11, updated_at = ?12
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
            "UPDATE Page SET deleted = 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
}

impl LinkRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at 
             FROM Link WHERE id = ?1"
        )?;
        
        let link = stmt.query_row(params![id], |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        
        Ok(link)
    }
    
    fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at 
             FROM Link WHERE source_block_id = ?1"
        )?;
        
        let links = stmt.query_map(params![source_block_id], |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(links)
    }
    
    fn get_by_target_page_id(&self, target_page_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at 
             FROM Link WHERE target_page_id = ?1"
        )?;
        
        let links = stmt.query_map(params![target_page_id], |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(links)
    }
    
    fn create(&mut self, link: &Link) -> Result<Link, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Link (id, source_block_id, target_page_id, display_text, relationship_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                link.id,
                link.source_block_id,
                link.target_page_id,
                link.display_text,
                link.relationship_type,
                link.created_at
            ]
        )?;
        
        Ok(link.clone())
    }
    
    fn create_many(&mut self, links: &[Link]) -> Result<Vec<Link>, Box<dyn Error>> {
        let tx = self.conn.transaction()?;
        
        for link in links {
            tx.execute(
                "INSERT INTO Link (id, source_block_id, target_page_id, display_text, relationship_type, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    link.id,
                    link.source_block_id,
                    link.target_page_id,
                    link.display_text,
                    link.relationship_type,
                    link.created_at
                ]
            )?;
        }
        
        tx.commit()?;
        Ok(links.to_vec())
    }
    
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Link WHERE id = ?1", params![id])?;
        Ok(())
    }
    
    fn delete_by_source_block_id(&mut self, source_block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Link WHERE source_block_id = ?1", params![source_block_id])?;
        Ok(())
    }
}

impl PropertyRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at 
             FROM Property WHERE id = ?1"
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
            })
        })?;
        
        Ok(property)
    }
    
    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at 
             FROM Property WHERE block_id = ?1 AND is_deleted = 0 ORDER BY sort_order"
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
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(properties)
    }
    
    fn get_by_block_id_and_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at 
             FROM Property WHERE block_id = ?1 AND key = ?2 AND is_deleted = 0"
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
            })
        });
        
        match result {
            Ok(property) => Ok(Some(property)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }
    
    fn create(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Property (id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
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
                property.updated_at
            ]
        )?;
        
        Ok(property.clone())
    }
    
    fn update(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Property SET value = ?2, type = ?3, sort_order = ?4, is_hidden = ?5, is_deleted = ?6, updated_at = ?7
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
        self.conn.execute("DELETE FROM Property WHERE id = ?1", params![id])?;
        Ok(())
    }
    
    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Property WHERE block_id = ?1", params![block_id])?;
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
            "UPDATE RelationshipType SET type = ?2, inverse = ?3, label = ?4, inverse_label = ?5, color = ?6, `order` = ?7, strength = ?8, deleted = ?9, updated_at = ?10
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
            "UPDATE RelationshipType SET deleted = 1, updated_at = ?2 WHERE id = ?1",
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
    fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at 
             FROM Block WHERE id = ?1"
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
            })
        })?;
        
        Ok(block)
    }
    
    fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at 
             FROM Block WHERE page_id = ?1 ORDER BY pos"
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
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(blocks)
    }
    
    fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at 
             FROM Block WHERE parent_id = ?1 ORDER BY pos"
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
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(blocks)
    }
    
    fn create(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Block (id, page_id, parent_id, pos, content, format, type, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                block.id,
                block.page_id,
                block.parent_id,
                block.pos,
                block.content,
                block.format,
                block.r#type,
                block.created_at,
                block.updated_at
            ]
        )?;
        
        self.update_search_index(block)?;
        
        Ok(block.clone())
    }
    
    fn update(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Block SET page_id = ?2, parent_id = ?3, pos = ?4, content = ?5, format = ?6, type = ?7, updated_at = ?8
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
        self.conn.execute("DELETE FROM Block WHERE id = ?1", params![id])?;
        
        self.conn.execute(
            "DELETE FROM SearchIndex WHERE block_id = ?1",
            params![id]
        )?;
        
        Ok(())
    }
    
    fn delete_by_page_id(&mut self, page_id: &str) -> Result<(), Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM Block WHERE page_id = ?1"
        )?;
        let block_ids: Vec<String> = stmt.query_map(params![page_id], |row| {
            row.get(0)
        })?.collect::<Result<_, _>>()?;
        
        self.conn.execute("DELETE FROM Block WHERE page_id = ?1", params![page_id])?;
        
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
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at
             FROM Page WHERE id = ?1"
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
            })
        })?;

        Ok(page)
    }

    fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at
             FROM Page WHERE title = ?1 AND deleted = 0"
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
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at
             FROM Page WHERE deleted = 0 ORDER BY updated_at DESC"
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
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(pages)
    }

    fn create(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Page (id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
                page.updated_at
            ]
        )?;

        Ok(page.clone())
    }

    fn update(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Page SET block_id = ?2, title = ?3, type = ?4, icon = ?5, cover = ?6, aliases = ?7, file_path = ?8, children_count = ?9, word_count = ?10, deleted = ?11, updated_at = ?12
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
            "UPDATE Page SET deleted = 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
}

impl<'a> LinkRepository for SQLiteTransactionAdapter<'a> {
    fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at
             FROM Link WHERE id = ?1"
        )?;

        let link = stmt.query_row(params![id], |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        
        Ok(link)
    }
    
    fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at
             FROM Link WHERE source_block_id = ?1"
        )?;

        let links = stmt.query_map(params![source_block_id], |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(links)
    }
    
    fn get_by_target_page_id(&self, target_page_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at
             FROM Link WHERE target_page_id = ?1"
        )?;

        let links = stmt.query_map(params![target_page_id], |row| {
            Ok(Link {
                id: row.get(0)?,
                source_block_id: row.get(1)?,
                target_page_id: row.get(2)?,
                display_text: row.get(3)?,
                relationship_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(links)
    }

    fn create(&mut self, link: &Link) -> Result<Link, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Link (id, source_block_id, target_page_id, display_text, relationship_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                link.id,
                link.source_block_id,
                link.target_page_id,
                link.display_text,
                link.relationship_type,
                link.created_at
            ]
        )?;

        Ok(link.clone())
    }

    fn create_many(&mut self, links: &[Link]) -> Result<Vec<Link>, Box<dyn Error>> {
        for link in links {
            self.conn.execute(
                "INSERT INTO Link (id, source_block_id, target_page_id, display_text, relationship_type, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    link.id,
                    link.source_block_id,
                    link.target_page_id,
                    link.display_text,
                    link.relationship_type,
                    link.created_at
                ]
            )?;
        }

        Ok(links.to_vec())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Link WHERE id = ?1", params![id])?;
        Ok(())
    }

    fn delete_by_source_block_id(&mut self, source_block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Link WHERE source_block_id = ?1", params![source_block_id])?;
        Ok(())
    }
}

impl<'a> PropertyRepository for SQLiteTransactionAdapter<'a> {
    fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at
             FROM Property WHERE id = ?1"
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
            })
        })?;

        Ok(property)
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at
             FROM Property WHERE block_id = ?1 AND is_deleted = 0 ORDER BY sort_order"
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
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(properties)
    }

    fn get_by_block_id_and_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at
             FROM Property WHERE block_id = ?1 AND key = ?2 AND is_deleted = 0"
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
            })
        });

        match result {
            Ok(property) => Ok(Some(property)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn create(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO Property (id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
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
                property.updated_at
            ]
        )?;

        Ok(property.clone())
    }

    fn update(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE Property SET value = ?2, type = ?3, sort_order = ?4, is_hidden = ?5, is_deleted = ?6, updated_at = ?7
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
        self.conn.execute("DELETE FROM Property WHERE id = ?1", params![id])?;
        Ok(())
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Property WHERE block_id = ?1", params![block_id])?;
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
            "UPDATE RelationshipType SET type = ?2, inverse = ?3, label = ?4, inverse_label = ?5, color = ?6, `order` = ?7, strength = ?8, deleted = ?9, updated_at = ?10
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
            "UPDATE RelationshipType SET deleted = 1, updated_at = ?2 WHERE id = ?1",
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
}