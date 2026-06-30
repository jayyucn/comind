# Sprint 2 实施方案：SQLite 存储层 + Service 重写

> **面向智能体执行者：必须使用子技能**：通过 subagent-driven-development（推荐）或 executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
**目标**：实现 SQLite Repository、FTS5 搜索索引同步、7 个 Rust Service 重写
**架构**：基于 Sprint 1 已完成的 Repository trait 和类型定义，实现 SQLite 存储层和业务逻辑层
**技术栈**：Rust 1.80+、rusqlite 0.32 (bundled + fts5)、serde + serde_json、uuid、chrono

---

## 任务概览

| 任务 | 描述 | 依赖 |
|------|------|------|
| T2.1 | 实现 SQLite Repository | Sprint 1 类型定义 |
| T2.2 | 实现 FTS5 搜索索引同步 | T2.1 |
| T2.3 | 实现 BlockService | T2.1 |
| T2.4 | 实现 LinkService | T2.1, T2.3 |
| T2.5 | 实现 PageService | T2.1, T2.3 |
| T2.6 | 实现 PropertyService | T2.1, T2.3 |
| T2.7 | 实现 TagService | 无（纯解析逻辑） |
| T2.8 | 实现 RelationshipTypeService | T2.1 |
| T2.9 | 实现 TemplateService | T2.1 |
| T2.10 | 集成测试验证 | 所有前置任务 |

---

## 涉及文件

**新建文件：**
- `comind/crates/comind-core/src/storage/sqlite.rs`
- `comind/crates/comind-core/src/storage/mod.rs`（修改）
- `comind/crates/comind-core/src/services/block.rs`
- `comind/crates/comind-core/src/services/page.rs`
- `comind/crates/comind-core/src/services/link.rs`
- `comind/crates/comind-core/src/services/property.rs`
- `comind/crates/comind-core/src/services/tag.rs`
- `comind/crates/comind-core/src/services/relationship_type.rs`
- `comind/crates/comind-core/src/services/template.rs`
- `comind/crates/comind-core/src/services/mod.rs`（修改）
- `comind/crates/comind-core/src/search/sqlite_search.rs`
- `comind/crates/comind-core/src/search/mod.rs`（修改）

**修改文件：**
- `comind/crates/comind-core/Cargo.toml`
- `comind/crates/comind-core/src/lib.rs`

---

## T2.1：实现 SQLite Repository

### 步骤 1：更新 Cargo.toml 添加 fts5 feature

- [ ] **步骤 1：修改 Cargo.toml**

**文件：** `comind/crates/comind-core/Cargo.toml`

```toml
[package]
name = "comind-core"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
uuid = { version = "1.0", features = ["v4", "serde"] }
rusqlite = { version = "0.32", features = ["bundled", "serde_json"] }
thiserror = "1.0"
chrono = { version = "0.4", features = ["serde"] }

[dev-dependencies]
tempfile = "3.0"
```

**说明：** rusqlite 已经配置了 bundled feature，FTS5 是 SQLite 内置功能，无需额外 feature。

---

### 步骤 2：实现 SQLite Schema 初始化

- [ ] **步骤 2：编写 SQLite Schema 初始化代码**

**文件：** `comind/crates/comind-core/src/storage/sqlite.rs`

```rust
use std::error::Error;
use std::path::Path;
use rusqlite::{Connection, params};
use super::super::types::*;
use super::repository::*;

/// SQLite 存储适配器
pub struct SQLiteAdapter {
    conn: Connection,
}

impl SQLiteAdapter {
    /// 打开或创建 SQLite 数据库
    pub fn open(path: &Path) -> Result<Self, Box<dyn Error>> {
        let conn = Connection::open(path)?;
        
        // 配置 PRAGMA
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;"
        )?;
        
        // 初始化 Schema
        Self::init_schema(&conn)?;
        
        Ok(Self { conn })
    }
    
    /// 创建内存数据库（测试用）
    pub fn open_in_memory() -> Result<Self, Box<dyn Error>> {
        let conn = Connection::open_in_memory()?;
        
        // 配置 PRAGMA
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;"
        )?;
        
        // 初始化 Schema
        Self::init_schema(&conn)?;
        
        Ok(Self { conn })
    }
    
    /// 初始化数据库 Schema
    fn init_schema(conn: &Connection) -> Result<(), Box<dyn Error>> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS Page (
                id              TEXT PRIMARY KEY,
                block_id        TEXT,
                title           TEXT NOT NULL,
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
                order           INTEGER NOT NULL DEFAULT 0,
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
            
            CREATE INDEX IF NOT EXISTS idx_page_blockId    ON Page(block_id);
            CREATE INDEX IF NOT EXISTS idx_page_type       ON Page(type);
            CREATE INDEX IF NOT EXISTS idx_page_updatedAt  ON Page(updated_at);
            CREATE INDEX IF NOT EXISTS idx_block_pageId    ON Block(page_id);
            CREATE INDEX IF NOT EXISTS idx_block_parentId  ON Block(parent_id);
            CREATE INDEX IF NOT EXISTS idx_block_pos       ON Block(pos);
            CREATE INDEX IF NOT EXISTS idx_link_target     ON Link(target_page_id);
            CREATE INDEX IF NOT EXISTS idx_link_source     ON Link(source_block_id);
            CREATE INDEX IF NOT EXISTS idx_property_blockId ON Property(block_id);
            CREATE INDEX IF NOT EXISTS idx_property_key    ON Property(key);"
        )?;
        
        Ok(())
    }
}
```

---

### 步骤 3：实现 BlockRepository trait

- [ ] **步骤 3：编写 BlockRepository 实现**

**文件：** `comind/crates/comind-core/src/storage/sqlite.rs`（续）

```rust
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
    
    fn create(&self, block: &Block) -> Result<Block, Box<dyn Error>> {
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
        
        Ok(block.clone())
    }
    
    fn update(&self, block: &Block) -> Result<Block, Box<dyn Error>> {
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
        
        Ok(block.clone())
    }
    
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Block WHERE id = ?1", params![id])?;
        Ok(())
    }
    
    fn delete_by_page_id(&self, page_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Block WHERE page_id = ?1", params![page_id])?;
        Ok(())
    }
}
```

---

### 步骤 4：实现 PageRepository trait

- [ ] **步骤 4：编写 PageRepository 实现**

**文件：** `comind/crates/comind-core/src/storage/sqlite.rs`（续）

```rust
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
    
    fn create(&self, page: &Page) -> Result<Page, Box<dyn Error>> {
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
    
    fn update(&self, page: &Page) -> Result<Page, Box<dyn Error>> {
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
    
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>> {
        // 软删除
        self.conn.execute(
            "UPDATE Page SET deleted = 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
}
```

---

### 步骤 5：实现 LinkRepository trait

- [ ] **步骤 5：编写 LinkRepository 实现**

**文件：** `comind/crates/comind-core/src/storage/sqlite.rs`（续）

```rust
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
    
    fn create(&self, link: &Link) -> Result<Link, Box<dyn Error>> {
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
    
    fn create_many(&self, links: &[Link]) -> Result<Vec<Link>, Box<dyn Error>> {
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
    
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Link WHERE id = ?1", params![id])?;
        Ok(())
    }
    
    fn delete_by_source_block_id(&self, source_block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Link WHERE source_block_id = ?1", params![source_block_id])?;
        Ok(())
    }
}
```

---

### 步骤 6：实现 PropertyRepository trait

- [ ] **步骤 6：编写 PropertyRepository 实现**

**文件：** `comind/crates/comind-core/src/storage/sqlite.rs`（续）

```rust
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
    
    fn create(&self, property: &Property) -> Result<Property, Box<dyn Error>> {
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
    
    fn update(&self, property: &Property) -> Result<Property, Box<dyn Error>> {
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
    
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Property WHERE id = ?1", params![id])?;
        Ok(())
    }
    
    fn delete_by_block_id(&self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Property WHERE block_id = ?1", params![block_id])?;
        Ok(())
    }
}
```

---

### 步骤 7：实现 RelationshipTypeRepository trait

- [ ] **步骤 7：编写 RelationshipTypeRepository 实现**

**文件：** `comind/crates/comind-core/src/storage/sqlite.rs`（续）

```rust
impl RelationshipTypeRepository for SQLiteAdapter {
    fn get_by_id(&self, id: &str) -> Result<RelationshipType, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, inverse, label, inverse_label, color, order, strength, deleted, builtin, created_at, updated_at 
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
            "SELECT id, type, inverse, label, inverse_label, color, order, strength, deleted, builtin, created_at, updated_at 
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
            "SELECT id, type, inverse, label, inverse_label, color, order, strength, deleted, builtin, created_at, updated_at 
             FROM RelationshipType WHERE deleted = 0 ORDER BY order"
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
    
    fn create(&self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        self.conn.execute(
            "INSERT INTO RelationshipType (id, type, inverse, label, inverse_label, color, order, strength, deleted, builtin, created_at, updated_at)
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
    
    fn update(&self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        self.conn.execute(
            "UPDATE RelationshipType SET type = ?2, inverse = ?3, label = ?4, inverse_label = ?5, color = ?6, order = ?7, strength = ?8, deleted = ?9, updated_at = ?10
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
    
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>> {
        // 软删除
        self.conn.execute(
            "UPDATE RelationshipType SET deleted = 1, updated_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()]
        )?;
        Ok(())
    }
}
```

---

### 步骤 8：实现 TemplateRepository trait

- [ ] **步骤 8：编写 TemplateRepository 实现**

**文件：** `comind/crates/comind-core/src/storage/sqlite.rs`（续）

```rust
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
    
    fn create(&self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
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
    
    fn update(&self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
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
    
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM UserTemplate WHERE id = ?1", params![id])?;
        Ok(())
    }
}
```

---

### 步骤 9：实现 StorageAdapter trait

- [ ] **步骤 9：编写 StorageAdapter trait 实现**

**文件：** `comind/crates/comind-core/src/storage/sqlite.rs`（续）

```rust
impl StorageAdapter for SQLiteAdapter {
    fn blocks(&self) -> &dyn BlockRepository {
        self
    }
    
    fn pages(&self) -> &dyn PageRepository {
        self
    }
    
    fn links(&self) -> &dyn LinkRepository {
        self
    }
    
    fn properties(&self) -> &dyn PropertyRepository {
        self
    }
    
    fn relationship_types(&self) -> &dyn RelationshipTypeRepository {
        self
    }
    
    fn templates(&self) -> &dyn TemplateRepository {
        self
    }
    
    fn search(&self) -> &dyn SearchRepository {
        self
    }
    
    fn transaction<R, F>(&self, f: F) -> Result<R, Box<dyn Error>>
    where
        F: FnOnce(&dyn StorageAdapter) -> Result<R, Box<dyn Error>>,
    {
        let tx = self.conn.transaction()?;
        let tx_adapter = SQLiteTransactionAdapter { conn: &tx };
        let result = f(&tx_adapter)?;
        tx.commit()?;
        Ok(result)
    }
}

/// 事务适配器（内部使用）
struct SQLiteTransactionAdapter<'a> {
    conn: &'a rusqlite::Transaction<'a>,
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
    
    fn create(&self, block: &Block) -> Result<Block, Box<dyn Error>> {
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
        
        Ok(block.clone())
    }
    
    fn update(&self, block: &Block) -> Result<Block, Box<dyn Error>> {
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
        
        Ok(block.clone())
    }
    
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Block WHERE id = ?1", params![id])?;
        Ok(())
    }
    
    fn delete_by_page_id(&self, page_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM Block WHERE page_id = ?1", params![page_id])?;
        Ok(())
    }
}

// 其他 Repository trait 实现类似，省略以节省篇幅...
// 完整实现请参考 SQLiteAdapter 的对应实现
```

---

### 步骤 10：更新 storage/mod.rs 导出

- [ ] **步骤 10：修改 storage/mod.rs**

**文件：** `comind/crates/comind-core/src/storage/mod.rs`

```rust
pub mod repository;
pub mod sqlite;

pub use repository::*;
pub use sqlite::*;
```

---

## T2.2：实现 FTS5 搜索索引同步

### 步骤 1：实现 SearchRepository trait

- [ ] **步骤 1：编写 SearchRepository 实现**

**文件：** `comind/crates/comind-core/src/storage/sqlite.rs`（续）

```rust
impl SearchRepository for SQLiteAdapter {
    fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT block_id, content, title, bm25(SearchIndex) as score
             FROM SearchIndex 
             WHERE SearchIndex MATCH ?1 
             ORDER BY bm25(SearchIndex)
             LIMIT ?2"
        )?;
        
        // FTS5 搜索需要特殊处理查询字符串
        let fts_query = query.replace(" ", "* ");
        let fts_query = format!("{}*", fts_query);
        
        let results = stmt.query_map(params![fts_query, limit as i64], |row| {
            let block_id: String = row.get(0)?;
            let content: String = row.get(1)?;
            let title: String = row.get(2)?;
            let score: f64 = row.get(3)?;
            
            // 通过 block_id 查询 page_id 和 page_title
            let block = self.get_by_id(&block_id)?;
            
            Ok(SearchResult::new(
                &block_id,
                &block.page_id,
                &title,
                &content,
                score
            ))
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(results)
    }
    
    fn update_index(&self, block_id: &str, content: &str, title: &str) -> Result<(), Box<dyn Error>> {
        // 先删除旧索引
        self.conn.execute(
            "DELETE FROM SearchIndex WHERE block_id = ?1",
            params![block_id]
        )?;
        
        // 插入新索引
        self.conn.execute(
            "INSERT INTO SearchIndex (block_id, content, title) VALUES (?1, ?2, ?3)",
            params![block_id, content, title]
        )?;
        
        Ok(())
    }
    
    fn delete_from_index(&self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute(
            "DELETE FROM SearchIndex WHERE block_id = ?1",
            params![block_id]
        )?;
        Ok(())
    }
}
```

---

## T2.3：实现 BlockService

### 步骤 1：编写 BlockService 基础结构

- [ ] **步骤 1：创建 BlockService 文件**

**文件：** `comind/crates/comind-core/src/services/block.rs`

```rust
use std::error::Error;
use super::super::storage::*;
use super::super::types::*;

/// Block 领域服务
pub struct BlockService {
    storage: Box<dyn StorageAdapter>,
}

impl BlockService {
    pub fn new(storage: Box<dyn StorageAdapter>) -> Self {
        BlockService { storage }
    }
    
    /// 根据 ID 获取 Block
    pub fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn Error>> {
        self.storage.blocks().get_by_id(id)
    }
    
    /// 获取页面的所有 Block
    pub fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        self.storage.blocks().get_by_page_id(page_id)
    }
    
    /// 获取子 Block
    pub fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        self.storage.blocks().get_children(parent_id)
    }
    
    /// 创建 Block
    pub fn create(&self, options: BlockCreateOptions) -> Result<Block, Box<dyn Error>> {
        let block = Block::new(options);
        self.storage.blocks().create(&block)?;
        
        // 更新搜索索引
        self.storage.search().update_index(&block.id, &block.content, "")?;
        
        Ok(block)
    }
    
    /// 更新 Block
    pub fn update(&self, id: &str, options: BlockUpdateOptions) -> Result<Block, Box<dyn Error>> {
        let block = self.storage.blocks().get_by_id(id)?;
        
        let updated_block = Block {
            id: block.id.clone(),
            page_id: block.page_id.clone(),
            parent_id: options.parent_id.or(block.parent_id),
            pos: options.pos.or(Some(block.pos)).unwrap(),
            content: options.content.or(Some(block.content)).unwrap(),
            format: options.format.or(Some(block.format)).unwrap(),
            r#type: options.r#type.or(Some(block.r#type)).unwrap(),
            created_at: block.created_at,
            updated_at: chrono::Utc::now().timestamp_millis(),
        };
        
        self.storage.blocks().update(&updated_block)?;
        
        // 更新搜索索引
        self.storage.search().update_index(&updated_block.id, &updated_block.content, "")?;
        
        Ok(updated_block)
    }
    
    /// 删除 Block（递归删除子 Block）
    pub fn delete(&self, id: &str) -> Result<(), Box<dyn Error>> {
        // 递归删除子 Block
        let children = self.storage.blocks().get_children(id)?;
        for child in children {
            self.delete(&child.id)?;
        }
        
        // 删除属性
        self.storage.properties().delete_by_block_id(id)?;
        
        // 删除链接
        self.storage.links().delete_by_source_block_id(id)?;
        
        // 删除搜索索引
        self.storage.search().delete_from_index(id)?;
        
        // 删除 Block
        self.storage.blocks().delete(id)?;
        
        Ok(())
    }
}
```

---

### 步骤 2：编写 Gap Sort 排序逻辑

- [ ] **步骤 2：添加 Gap Sort 实现**

**文件：** `comind/crates/comind-core/src/services/block.rs`（续）

```rust
impl BlockService {
    /// Gap Sort 排序常量
    const GAP: i64 = 1000;
    
    /// 计算插入位置
    pub fn calculate_insert_pos(&self, page_id: &str, after_block_id: Option<&str>) -> Result<i64, Box<dyn Error>> {
        match after_block_id {
            Some(after_id) => {
                let after_block = self.storage.blocks().get_by_id(after_id)?;
                let children = self.storage.blocks().get_children(after_block.parent_id.unwrap_or(page_id))?;
                
                // 查找 after_block 在子节点中的位置
                let after_index = children.iter().position(|b| b.id == after_id);
                
                match after_index {
                    Some(idx) => {
                        if idx + 1 < children.len() {
                            // 在两个节点之间插入
                            let after_pos = after_block.pos;
                            let next_pos = children[idx + 1].pos;
                            (after_pos + next_pos) / 2
                        } else {
                            // 在末尾插入
                            after_block.pos + Self::GAP
                        }
                    }
                    None => Self::GAP,
                }
            }
            None => {
                // 作为第一个节点插入
                let children = self.storage.blocks().get_children(page_id)?;
                if children.is_empty() {
                    Self::GAP
                } else {
                    children[0].pos / 2
                }
            }
        }
    }
    
    /// 移动 Block 到新位置
    pub fn move_block(&self, block_id: &str, new_parent_id: Option<&str>, after_block_id: Option<&str>) -> Result<Block, Box<dyn Error>> {
        let block = self.storage.blocks().get_by_id(block_id)?;
        let page_id = block.page_id.clone();
        
        // 计算新位置
        let new_pos = self.calculate_insert_pos(&page_id, after_block_id)?;
        
        // 检查是否需要重平衡
        if new_pos < 2 {
            self.rebalance(&page_id)?;
            // 重新计算位置
            let new_pos = self.calculate_insert_pos(&page_id, after_block_id)?;
            
            let updated_block = Block {
                id: block.id.clone(),
                page_id: block.page_id.clone(),
                parent_id: new_parent_id.map(|s| s.to_string()),
                pos: new_pos,
                content: block.content.clone(),
                format: block.format.clone(),
                r#type: block.r#type.clone(),
                created_at: block.created_at,
                updated_at: chrono::Utc::now().timestamp_millis(),
            };
            
            self.storage.blocks().update(&updated_block)?;
            Ok(updated_block)
        } else {
            let updated_block = Block {
                id: block.id.clone(),
                page_id: block.page_id.clone(),
                parent_id: new_parent_id.map(|s| s.to_string()),
                pos: new_pos,
                content: block.content.clone(),
                format: block.format.clone(),
                r#type: block.r#type.clone(),
                created_at: block.created_at,
                updated_at: chrono::Utc::now().timestamp_millis(),
            };
            
            self.storage.blocks().update(&updated_block)?;
            Ok(updated_block)
        }
    }
    
    /// 重平衡 Block 位置
    fn rebalance(&self, page_id: &str) -> Result<(), Box<dyn Error>> {
        // 获取页面的所有根 Block
        let blocks = self.storage.blocks().get_by_page_id(page_id)?;
        let root_blocks: Vec<Block> = blocks.iter()
            .filter(|b| b.parent_id.is_none())
            .collect();
        
        // 按 pos 排序
        let mut sorted_blocks: Vec<Block> = root_blocks.into_iter().collect();
        sorted_blocks.sort_by_key(|b| b.pos);
        
        // 重新分配位置
        for (i, block) in sorted_blocks.iter_mut().enumerate() {
            block.pos = (i as i64 + 1) * Self::GAP;
            block.updated_at = chrono::Utc::now().timestamp_millis();
            self.storage.blocks().update(block)?;
        }
        
        // 递归重平衡子节点
        for block in &sorted_blocks {
            self.rebalance_children(&block.id)?;
        }
        
        Ok(())
    }
    
    /// 重平衡子节点
    fn rebalance_children(&self, parent_id: &str) -> Result<(), Box<dyn Error>> {
        let children = self.storage.blocks().get_children(parent_id)?;
        
        if children.is_empty() {
            return Ok(());
        }
        
        // 按 pos 排序
        let mut sorted_children: Vec<Block> = children.into_iter().collect();
        sorted_children.sort_by_key(|b| b.pos);
        
        // 重新分配位置
        for (i, block) in sorted_children.iter_mut().enumerate() {
            block.pos = (i as i64 + 1) * Self::GAP;
            block.updated_at = chrono::Utc::now().timestamp_millis();
            self.storage.blocks().update(block)?;
            
            // 递归重平衡
            self.rebalance_children(&block.id)?;
        }
        
        Ok(())
    }
    
    /// 构建 Block 树
    pub fn build_tree(&self, page_id: &str) -> Result<Vec<TreeNode>, Box<dyn Error>> {
        let blocks = self.storage.blocks().get_by_page_id(page_id)?;
        
        // 找到根节点
        let root_blocks: Vec<&Block> = blocks.iter()
            .filter(|b| b.parent_id.is_none())
            .collect();
        
        // 递归构建树
        let tree: Vec<TreeNode> = root_blocks.iter()
            .map(|block| self.build_tree_node(block, &blocks))
            .collect();
        
        Ok(tree)
    }
    
    /// 构建树节点
    fn build_tree_node(&self, block: &Block, all_blocks: &[Block]) -> TreeNode {
        let children: Vec<&Block> = all_blocks.iter()
            .filter(|b| b.parent_id.as_ref() == Some(&block.id))
            .collect();
        
        let child_nodes: Vec<TreeNode> = children.iter()
            .map(|child| self.build_tree_node(child, all_blocks))
            .collect();
        
        TreeNode {
            id: block.id.clone(),
            page_id: block.page_id.clone(),
            parent_id: block.parent_id.clone(),
            pos: block.pos,
            content: block.content.clone(),
            format: block.format.clone(),
            r#type: block.r#type.clone(),
            created_at: block.created_at,
            updated_at: block.updated_at,
            children: child_nodes,
        }
    }
}

/// 树节点结构
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TreeNode {
    pub id: String,
    pub page_id: String,
    pub parent_id: Option<String>,
    pub pos: i64,
    pub content: String,
    pub format: String,
    pub r#type: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub children: Vec<TreeNode>,
}
```

---

## T2.4：实现 LinkService

### 步骤 1：编写 LinkService

- [ ] **步骤 1：创建 LinkService 文件**

**文件：** `comind/crates/comind-core/src/services/link.rs`

```rust
use std::error::Error;
use super::super::storage::*;
use super::super::types::*;

/// Link 领域服务
pub struct LinkService {
    storage: Box<dyn StorageAdapter>,
}

impl LinkService {
    pub fn new(storage: Box<dyn StorageAdapter>) -> Self {
        LinkService { storage }
    }
    
    /// 根据 ID 获取 Link
    pub fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn Error>> {
        self.storage.links().get_by_id(id)
    }
    
    /// 获取源 Block 的所有链接
    pub fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        self.storage.links().get_by_source_block_id(source_block_id)
    }
    
    /// 获取反向链接
    pub fn get_backlinks(&self, page_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        self.storage.links().get_by_target_page_id(page_id)
    }
    
    /// 创建 Link
    pub fn create(&self, options: LinkCreateOptions) -> Result<Link, Box<dyn Error>> {
        let link = Link::new(options);
        self.storage.links().create(&link)?;
        Ok(link)
    }
    
    /// 批量创建 Link
    pub fn create_many(&self, options: Vec<LinkCreateOptions>) -> Result<Vec<Link>, Box<dyn Error>> {
        let links: Vec<Link> = options.iter().map(|opt| Link::new(opt.clone())).collect();
        self.storage.links().create_many(&links)?;
        Ok(links)
    }
    
    /// 删除 Link
    pub fn delete(&self, id: &str) -> Result<(), Box<dyn Error>> {
        self.storage.links().delete(id)?;
        Ok(())
    }
    
    /// 删除源 Block 的所有链接
    pub fn delete_by_source_block_id(&self, source_block_id: &str) -> Result<(), Box<dyn Error>> {
        self.storage.links().delete_by_source_block_id(source_block_id)?;
        Ok(())
    }
    
    /// 同步 Block 的链接（解析内容 → 更新数据库）
    pub fn sync_block_links(&self, block_id: &str, page_id: &str, parsed_links: Vec<LinkParse>) -> Result<Vec<Link>, Box<dyn Error>> {
        // 删除旧链接
        self.storage.links().delete_by_source_block_id(block_id)?;
        
        // 创建新链接
        let links: Vec<Link> = parsed_links.iter()
            .map(|parsed| Link::new(LinkCreateOptions {
                source_block_id: block_id.to_string(),
                target_page_id: parsed.target_page_id.clone(),
                display_text: parsed.display_text.clone(),
                relationship_type: parsed.relationship_type.clone(),
            }))
            .collect();
        
        self.storage.links().create_many(&links)?;
        Ok(links)
    }
}

/// 链接解析结果
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LinkParse {
    pub target_page_id: String,
    pub display_text: String,
    pub relationship_type: Option<String>,
}
```

---

## T2.5：实现 PageService

### 步骤 1：编写 PageService

- [ ] **步骤 1：创建 PageService 文件**

**文件：** `comind/crates/comind-core/src/services/page.rs`

```rust
use std::error::Error;
use super::super::storage::*;
use super::super::types::*;

/// Page 领域服务
pub struct PageService {
    storage: Box<dyn StorageAdapter>,
}

impl PageService {
    pub fn new(storage: Box<dyn StorageAdapter>) -> Self {
        PageService { storage }
    }
    
    /// 根据 ID 获取 Page
    pub fn get_by_id(&self, id: &str) -> Result<Page, Box<dyn Error>> {
        self.storage.pages().get_by_id(id)
    }
    
    /// 根据标题获取 Page
    pub fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
        self.storage.pages().get_by_title(title)
    }
    
    /// 获取所有 Page
    pub fn get_all(&self) -> Result<Vec<Page>, Box<dyn Error>> {
        self.storage.pages().get_all()
    }
    
    /// 创建 Page
    pub fn create(&self, title: &str, r#type: Option<&str>) -> Result<Page, Box<dyn Error>> {
        let page = Page {
            id: uuid::Uuid::new_v4().to_string(),
            block_id: None,
            title: title.to_string(),
            r#type: r#type.unwrap_or("normal").to_string(),
            icon: None,
            cover: None,
            aliases: "[]".to_string(),
            file_path: None,
            children_count: 0,
            word_count: 0,
            deleted: 0,
            created_at: chrono::Utc::now().timestamp_millis(),
            updated_at: chrono::Utc::now().timestamp_millis(),
        };
        
        self.storage.pages().create(&page)?;
        Ok(page)
    }
    
    /// 更新 Page
    pub fn update(&self, page: &Page) -> Result<Page, Box<dyn Error>> {
        let updated_page = Page {
            id: page.id.clone(),
            block_id: page.block_id.clone(),
            title: page.title.clone(),
            r#type: page.r#type.clone(),
            icon: page.icon.clone(),
            cover: page.cover.clone(),
            aliases: page.aliases.clone(),
            file_path: page.file_path.clone(),
            children_count: page.children_count,
            word_count: page.word_count,
            deleted: page.deleted,
            created_at: page.created_at,
            updated_at: chrono::Utc::now().timestamp_millis(),
        };
        
        self.storage.pages().update(&updated_page)?;
        Ok(updated_page)
    }
    
    /// 删除 Page（级联删除 Block、Link、Property）
    pub fn delete_cascade(&self, page_id: &str) -> Result<(), Box<dyn Error>> {
        self.storage.transaction(|tx| {
            // 删除所有 Block 及其属性和链接
            let blocks = tx.blocks().get_by_page_id(page_id)?;
            for block in blocks {
                tx.properties().delete_by_block_id(&block.id)?;
                tx.links().delete_by_source_block_id(&block.id)?;
                tx.search().delete_from_index(&block.id)?;
            }
            tx.blocks().delete_by_page_id(page_id)?;
            
            // 删除 Page
            tx.pages().delete(page_id)?;
            
            Ok(())
        })?;
        
        Ok(())
    }
}
```

---

## T2.6：实现 PropertyService

### 步骤 1：编写 PropertyService

- [ ] **步骤 1：创建 PropertyService 文件**

**文件：** `comind/crates/comind-core/src/services/property.rs`

```rust
use std::error::Error;
use super::super::storage::*;
use super::super::types::*;

/// Property 领域服务
pub struct PropertyService {
    storage: Box<dyn StorageAdapter>,
}

impl PropertyService {
    pub fn new(storage: Box<dyn StorageAdapter>) -> Self {
        PropertyService { storage }
    }
    
    /// 根据 ID 获取 Property
    pub fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn Error>> {
        self.storage.properties().get_by_id(id)
    }
    
    /// 获取 Block 的所有属性
    pub fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn Error>> {
        self.storage.properties().get_by_block_id(block_id)
    }
    
    /// 根据 key 获取属性
    pub fn get_by_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn Error>> {
        self.storage.properties().get_by_block_id_and_key(block_id, key)
    }
    
    /// 设置属性（创建或更新）
    pub fn set(&self, block_id: &str, key: &str, value: &str, r#type: Option<&str>) -> Result<Property, Box<dyn Error>> {
        // 检查是否已存在
        let existing = self.storage.properties().get_by_block_id_and_key(block_id, key)?;
        
        match existing {
            Some(property) => {
                // 更新
                let updated = Property {
                    id: property.id.clone(),
                    block_id: property.block_id.clone(),
                    key: property.key.clone(),
                    value: value.to_string(),
                    r#type: r#type.unwrap_or(&property.r#type).to_string(),
                    sort_order: property.sort_order,
                    is_hidden: property.is_hidden,
                    is_deleted: 0,
                    schema_version: property.schema_version,
                    created_at: property.created_at,
                    updated_at: chrono::Utc::now().timestamp_millis(),
                };
                
                self.storage.properties().update(&updated)?;
                Ok(updated)
            }
            None => {
                // 创建
                let property = Property::new(PropertyCreateOptions {
                    block_id: block_id.to_string(),
                    key: key.to_string(),
                    value: value.to_string(),
                    r#type: r#type.unwrap_or("string").to_string(),
                });
                
                self.storage.properties().create(&property)?;
                Ok(property)
            }
        }
    }
    
    /// 删除属性
    pub fn delete(&self, block_id: &str, key: &str) -> Result<(), Box<dyn Error>> {
        let property = self.storage.properties().get_by_block_id_and_key(block_id, key)?;
        
        match property {
            Some(p) => {
                self.storage.properties().delete(&p.id)?;
                Ok(())
            }
            None => Ok(()),
        }
    }
    
    /// 推断属性类型
    pub fn infer_type(value: &str) -> String {
        // 尝试解析为数字
        if value.parse::<i64>().is_ok() {
            return "number".to_string();
        }
        
        // 尝试解析为浮点数
        if value.parse::<f64>().is_ok() {
            return "number".to_string();
        }
        
        // 尝试解析为布尔值
        if value == "true" || value == "false" {
            return "boolean".to_string();
        }
        
        // 尝试解析为日期
        if chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok() {
            return "date".to_string();
        }
        
        // 尝试解析为 JSON 数组
        if value.starts_with("[") && value.ends_with("]") {
            return "array".to_string();
        }
        
        // 默认为字符串
        "string".to_string()
    }
    
    /// 解析内联属性
    pub fn parse_inline_properties(content: &str) -> Vec<InlineProperty> {
        let mut properties = Vec::new();
        
        // 正则匹配 `key:: value`
        let re = regex::Regex::new(r"([a-zA-Z_][a-zA-Z0-9_-]*)::\s*(.+?)(?:\n|$)").unwrap();
        
        for cap in re.captures_iter(content) {
            let key = cap[1].to_string();
            let value = cap[2].trim().to_string();
            let r#type = Self::infer_type(&value);
            
            properties.push(InlineProperty {
                key,
                value,
                r#type,
                start: cap.get(0).unwrap().start(),
                end: cap.get(0).unwrap().end(),
            });
        }
        
        properties
    }
}

/// 内联属性解析结果
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InlineProperty {
    pub key: String,
    pub value: String,
    pub r#type: String,
    pub start: usize,
    pub end: usize,
}
```

---

## T2.7：实现 TagService

### 步骤 1：编写 TagService

- [ ] **步骤 1：创建 TagService 文件**

**文件：** `comind/crates/comind-core/src/services/tag.rs`

```rust
use super::super::types::*;

/// Tag 领域服务（纯解析逻辑，无需存储）
pub struct TagService;

impl TagService {
    /// 解析文本中的标签
    pub fn parse_tags(content: &str) -> Vec<TagParse> {
        let mut tags = Vec::new();
        
        // 正则匹配 `#标签名`
        let re = regex::Regex::new(r"#([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_/\u4e00-\u9fff]*)").unwrap();
        
        for cap in re.captures_iter(content) {
            let full_path = cap[1].to_string();
            
            // 提取标签名（最后一段）
            let name = full_path.split('/')
                .last()
                .unwrap_or(&full_path)
                .to_string();
            
            let m = cap.get(0).unwrap();
            
            tags.push(TagParse::new(&name, &full_path, m.start(), m.end()));
        }
        
        tags
    }
    
    /// 提取唯一标签名（含父标签）
    pub fn extract_unique_tags(content: &str) -> Vec<String> {
        let tags = Self::parse_tags(content);
        let mut unique_tags = Vec::new();
        
        for tag in &tags {
            // 添加完整路径
            if !unique_tags.contains(&tag.full_path) {
                unique_tags.push(tag.full_path.clone());
            }
            
            // 添加父标签
            let parts: Vec<&str> = tag.full_path.split('/').collect();
            for i in 0..parts.len() - 1 {
                let parent_path = parts[..=i].join("/");
                if !unique_tags.contains(&parent_path) {
                    unique_tags.push(parent_path);
                }
            }
        }
        
        unique_tags
    }
    
    /// 高亮标签（将 #标签 替换为 HTML span）
    pub fn highlight_tags(content: &str) -> String {
        let re = regex::Regex::new(r"#([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_/\u4e00-\u9fff]*)").unwrap();
        
        re.replace_all(content, |cap: &regex::Captures| {
            let tag = &cap[1];
            format!("<span class=\"tag\">#{}</span>", tag)
        }).to_string()
    }
}
```

---

## T2.8：实现 RelationshipTypeService

### 步骤 1：编写 RelationshipTypeService

- [ ] **步骤 1：创建 RelationshipTypeService 文件**

**文件：** `comind/crates/comind-core/src/services/relationship_type.rs`

```rust
use std::error::Error;
use super::super::storage::*;
use super::super::types::*;

/// RelationshipType 领域服务
pub struct RelationshipTypeService {
    storage: Box<dyn StorageAdapter>,
}

impl RelationshipTypeService {
    pub fn new(storage: Box<dyn StorageAdapter>) -> Self {
        RelationshipTypeService { storage }
    }
    
    /// 根据 ID 获取关系类型
    pub fn get_by_id(&self, id: &str) -> Result<RelationshipType, Box<dyn Error>> {
        self.storage.relationship_types().get_by_id(id)
    }
    
    /// 根据 type 获取关系类型
    pub fn get_by_type(&self, r#type: &str) -> Result<Option<RelationshipType>, Box<dyn Error>> {
        self.storage.relationship_types().get_by_type(r#type)
    }
    
    /// 获取所有关系类型
    pub fn get_all(&self) -> Result<Vec<RelationshipType>, Box<dyn Error>> {
        self.storage.relationship_types().get_all()
    }
    
    /// 创建关系类型
    pub fn create(&self, r#type: &str, label: &str, inverse_label: &str, color: &str, strength: Option<&str>) -> Result<RelationshipType, Box<dyn Error>> {
        let rt = RelationshipType {
            id: uuid::Uuid::new_v4().to_string(),
            r#type: r#type.to_string(),
            inverse: None,
            label: label.to_string(),
            inverse_label: inverse_label.to_string(),
            color: color.to_string(),
            order: 0,
            strength: strength.unwrap_or("medium").to_string(),
            deleted: 0,
            builtin: 0,
            created_at: chrono::Utc::now().timestamp_millis(),
            updated_at: chrono::Utc::now().timestamp_millis(),
        };
        
        self.storage.relationship_types().create(&rt)?;
        Ok(rt)
    }
    
    /// 更新关系类型
    pub fn update(&self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        let updated = RelationshipType {
            id: rt.id.clone(),
            r#type: rt.r#type.clone(),
            inverse: rt.inverse.clone(),
            label: rt.label.clone(),
            inverse_label: rt.inverse_label.clone(),
            color: rt.color.clone(),
            order: rt.order,
            strength: rt.strength.clone(),
            deleted: rt.deleted,
            builtin: rt.builtin,
            created_at: rt.created_at,
            updated_at: chrono::Utc::now().timestamp_millis(),
        };
        
        self.storage.relationship_types().update(&updated)?;
        Ok(updated)
    }
    
    /// 删除关系类型（软删除）
    pub fn delete(&self, id: &str) -> Result<(), Box<dyn Error>> {
        self.storage.relationship_types().delete(id)?;
        Ok(())
    }
    
    /// 获取关系强度（用于边宽度计算）
    pub fn get_strength(&self, r#type: &str) -> String {
        let rt = self.storage.relationship_types().get_by_type(r#type);
        
        match rt {
            Ok(Some(rt)) => rt.strength.clone(),
            _ => "medium".to_string(), // 默认值
        }
    }
    
    /// 初始化种子关系类型
    pub fn init_seed_types(&self) -> Result<(), Box<dyn Error>> {
        let seed_types = vec![
            ("is-a", "是一个", "是一种", "#3B82F6", "strong"),
            ("part-of", "是部分", "包含", "#10B981", "strong"),
            ("depends-on", "依赖", "被依赖", "#F59E0B", "strong"),
            ("causes", "导致", "被导致", "#EF4444", "strong"),
            ("uses", "使用", "被使用", "#8B5CF6", "medium"),
            ("supports", "支持", "被支持", "#06B6D4", "medium"),
            ("contradicts", "矛盾", "被矛盾", "#EC4899", "medium"),
            ("related", "相关", "相关", "#6B7280", "weak"),
        ];
        
        for (r#type, label, inverse_label, color, strength) in seed_types {
            let rt = RelationshipType {
                id: format!("rt_seed_{}", r#type),
                r#type: r#type.to_string(),
                inverse: None,
                label: label.to_string(),
                inverse_label: inverse_label.to_string(),
                color: color.to_string(),
                order: 0,
                strength: strength.to_string(),
                deleted: 0,
                builtin: 1,
                created_at: chrono::Utc::now().timestamp_millis(),
                updated_at: chrono::Utc::now().timestamp_millis(),
            };
            
            // 检查是否已存在
            let existing = self.storage.relationship_types().get_by_type(r#type)?;
            if existing.is_none() {
                self.storage.relationship_types().create(&rt)?;
            }
        }
        
        Ok(())
    }
}
```

---

## T2.9：实现 TemplateService

### 步骤 1：编写 TemplateService

- [ ] **步骤 1：创建 TemplateService 文件**

**文件：** `comind/crates/comind-core/src/services/template.rs`

```rust
use std::error::Error;
use super::super::storage::*;
use super::super::types::*;

/// Template 领域服务
pub struct TemplateService {
    storage: Box<dyn StorageAdapter>,
}

impl TemplateService {
    pub fn new(storage: Box<dyn StorageAdapter>) -> Self {
        TemplateService { storage }
    }
    
    /// 根据 ID 获取模板
    pub fn get_by_id(&self, id: &str) -> Result<UserTemplate, Box<dyn Error>> {
        self.storage.templates().get_by_id(id)
    }
    
    /// 根据名称获取模板
    pub fn get_by_name(&self, name: &str) -> Result<Option<UserTemplate>, Box<dyn Error>> {
        self.storage.templates().get_by_name(name)
    }
    
    /// 获取所有模板
    pub fn get_all(&self) -> Result<Vec<UserTemplate>, Box<dyn Error>> {
        self.storage.templates().get_all()
    }
    
    /// 创建模板
    pub fn create(&self, name: &str, category: &str, content: &str) -> Result<UserTemplate, Box<dyn Error>> {
        let template = UserTemplate::new(name, category, content);
        self.storage.templates().create(&template)?;
        Ok(template)
    }
    
    /// 更新模板
    pub fn update(&self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
        let updated = UserTemplate {
            id: template.id.clone(),
            name: template.name.clone(),
            category: template.category.clone(),
            content: template.content.clone(),
            created_at: template.created_at,
            updated_at: chrono::Utc::now().timestamp_millis(),
        };
        
        self.storage.templates().update(&updated)?;
        Ok(updated)
    }
    
    /// 删除模板
    pub fn delete(&self, id: &str) -> Result<(), Box<dyn Error>> {
        self.storage.templates().delete(id)?;
        Ok(())
    }
    
    /// 渲染模板（将模板内容转换为 Block 树）
    pub fn render(&self, template_id: &str) -> Result<Vec<TemplateBlock>, Box<dyn Error>> {
        let template = self.storage.templates().get_by_id(template_id)?;
        
        // 解析模板内容
        let blocks: Vec<TemplateBlock> = serde_json::from_str(&template.content)?;
        
        Ok(blocks)
    }
}

/// 模板 Block 结构
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TemplateBlock {
    pub content: String,
    pub r#type: String,
    pub children: Vec<TemplateBlock>,
    pub properties: Vec<TemplateProperty>,
}

/// 模板属性结构
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TemplateProperty {
    pub key: String,
    pub value: String,
    pub r#type: String,
}
```

---

## T2.10：更新 mod.rs 导出

### 步骤 1：更新 services/mod.rs

- [ ] **步骤 1：修改 services/mod.rs**

**文件：** `comind/crates/comind-core/src/services/mod.rs`

```rust
pub mod block;
pub mod page;
pub mod link;
pub mod property;
pub mod tag;
pub mod relationship_type;
pub mod template;

pub use block::*;
pub use page::*;
pub use link::*;
pub use property::*;
pub use tag::*;
pub use relationship_type::*;
pub use template::*;
```

---

### 步骤 2：更新 search/mod.rs

- [ ] **步骤 2：修改 search/mod.rs**

**文件：** `comind/crates/comind-core/src/search/mod.rs`

```rust
pub mod sqlite_search;

pub use sqlite_search::*;
```

---

### 步骤 3：更新 lib.rs

- [ ] **步骤 3：修改 lib.rs**

**文件：** `comind/crates/comind-core/src/lib.rs`

```rust
pub mod services;
pub mod storage;
pub mod search;
pub mod types;
pub mod utils;

pub use services::*;
pub use storage::*;
pub use search::*;
pub use types::*;
pub use utils::*;
```

---

## 验收标准

- [ ] SQLite Repository 实现完整（7 个 Repository trait）
- [ ] FTS5 搜索索引同步功能正常
- [ ] BlockService 包含 CRUD + Gap Sort + 树构建
- [ ] LinkService 包含 CRUD + 反向链接 + 同步
- [ ] PageService 包含 CRUD + 级联删除
- [ ] PropertyService 包含 CRUD + 类型推断 + 内联解析
- [ ] TagService 包含标签解析 + 高亮
- [ ] RelationshipTypeService 包含 CRUD + 种子初始化
- [ ] TemplateService 包含 CRUD + 模板渲染
- [ ] cargo build 成功
- [ ] cargo test 通过

---

*文档 v1.0，2026-06-30 Sprint 2 实施方案。*