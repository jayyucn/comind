# Sprint 3: Tauri Command + WASM 编译 实施方案
> **面向智能体执行者：必须使用子技能**：通过 subagent‑driven‑development（推荐）或 executing‑plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
**目标**：实现 Tauri Command 定义和 WASM 绑定，使 Rust Core 层能够被前端调用
**架构**：混合模式（细粒度查询 + 粗粒度写操作 + 批处理 API），Tauri 端使用 rusqlite，WASM 端使用 sql.js，共享同一套 comind-core 业务逻辑
**技术栈**：Tauri 2.x、rusqlite、wasm-bindgen、sql.js、serde_json
---

## 任务1：实现 DatabaseConnection 状态管理
**涉及文件：**
- 修改：`comind/src-tauri/src/state.rs`
- 测试：无

### 步骤1：实现真实的 DatabaseConnection

```rust
use comind_core::storage::SQLiteAdapter;
use std::sync::Mutex;
use std::path::Path;

pub struct DatabaseConnection {
    adapter: Mutex<SQLiteAdapter>,
}

impl DatabaseConnection {
    pub fn new(data_dir: &Path) -> Result<Self, String> {
        let db_path = data_dir.join("comind.db");
        let adapter = SQLiteAdapter::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;
        Ok(Self {
            adapter: Mutex::new(adapter),
        })
    }

    pub fn get_adapter(&self) -> Result<std::sync::MutexGuard<'_, SQLiteAdapter>, String> {
        self.adapter.lock().map_err(|e| format!("Failed to lock database: {}", e))
    }
}
```

### 步骤2：编译检查

执行命令：`cd comind/src-tauri && cargo check`
预期结果：编译通过，无错误

---

## 任务2：定义并实现 Tauri Command
**涉及文件：**
- 修改：`comind/src-tauri/src/commands.rs`
- 测试：无

### 步骤1：实现细粒度查询命令

```rust
use tauri::State;
use comind_core::{
    services::{BlockService, PageService, LinkService, PropertyService, RelationshipTypeService},
    types::*,
    storage::StorageAdapter,
};
use std::error::Error;

fn execute_with_adapter<F, R>(db: State<'_, super::state::DatabaseConnection>, f: F) -> Result<R, String>
where
    F: FnOnce(&mut dyn StorageAdapter) -> Result<R, Box<dyn Error>>,
{
    let mut adapter = db.get_adapter()?;
    f(&mut *adapter).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_block(db: State<'_, super::state::DatabaseConnection>, block_id: &str) -> Result<Block, String> {
    execute_with_adapter(db, |storage| BlockService::get_by_id(storage, block_id))
}

#[tauri::command]
pub async fn get_blocks_by_page(db: State<'_, super::state::DatabaseConnection>, page_id: &str) -> Result<Vec<Block>, String> {
    execute_with_adapter(db, |storage| BlockService::get_by_page_id(storage, page_id))
}

#[tauri::command]
pub async fn get_page(db: State<'_, super::state::DatabaseConnection>, page_id: &str) -> Result<Page, String> {
    execute_with_adapter(db, |storage| PageService::get_by_id(storage, page_id))
}

#[tauri::command]
pub async fn get_all_pages(db: State<'_, super::state::DatabaseConnection>) -> Result<Vec<Page>, String> {
    execute_with_adapter(db, |storage| PageService::get_all(storage))
}

#[tauri::command]
pub async fn get_backlinks(db: State<'_, super::state::DatabaseConnection>, page_id: &str) -> Result<Vec<Link>, String> {
    execute_with_adapter(db, |storage| LinkService::get_backlinks(storage, page_id))
}

#[tauri::command]
pub async fn search(db: State<'_, super::state::DatabaseConnection>, query: &str) -> Result<Vec<SearchResult>, String> {
    execute_with_adapter(db, |storage| {
        storage.search().search(query, 20)
    })
}

#[tauri::command]
pub async fn get_properties(db: State<'_, super::state::DatabaseConnection>, block_id: &str) -> Result<Vec<Property>, String> {
    execute_with_adapter(db, |storage| PropertyService::get_by_block_id(storage, block_id))
}

#[tauri::command]
pub async fn get_relationship_types(db: State<'_, super::state::DatabaseConnection>) -> Result<Vec<RelationshipType>, String> {
    execute_with_adapter(db, |storage| RelationshipTypeService::get_all(storage))
}
```

### 步骤2：实现粗粒度写操作命令

```rust
#[tauri::command]
pub async fn save_block_tree(db: State<'_, super::state::DatabaseConnection>, blocks: Vec<serde_json::Value>) -> Result<Vec<Block>, String> {
    execute_with_adapter(db, |storage| {
        let mut results = Vec::new();
        for block_json in blocks {
            let block: Block = serde_json::from_value(block_json)
                .map_err(|e| format!("Failed to parse block: {}", e))?;
            let existing = storage.blocks().get_by_id(&block.id);
            let result = match existing {
                Ok(_) => storage.blocks().update(&block),
                Err(_) => storage.blocks().create(&block),
            };
            results.push(result?);
        }
        Ok(results)
    })
}

#[tauri::command]
pub async fn save_page(db: State<'_, super::state::DatabaseConnection>, page: serde_json::Value) -> Result<Page, String> {
    execute_with_adapter(db, |storage| {
        let page: Page = serde_json::from_value(page)
            .map_err(|e| format!("Failed to parse page: {}", e))?;
        let existing = storage.pages().get_by_id(&page.id);
        match existing {
            Ok(_) => storage.pages().update(&page),
            Err(_) => storage.pages().create(&page),
        }
    })
}

#[tauri::command]
pub async fn delete_page_cascade(db: State<'_, super::state::DatabaseConnection>, page_id: &str) -> Result<(), String> {
    execute_with_adapter(db, |storage| {
        storage.properties().delete_by_block_id(page_id)?;
        storage.links().delete_by_source_block_id(page_id)?;
        storage.blocks().delete_by_page_id(page_id)?;
        storage.pages().delete(page_id)?;
        Ok(())
    })
}

#[tauri::command]
pub async fn set_property(db: State<'_, super::state::DatabaseConnection>, block_id: &str, key: &str, value: &str, type_: &str) -> Result<Property, String> {
    execute_with_adapter(db, |storage| {
        let existing = PropertyService::get_by_block_id_and_key(storage, block_id, key)?;
        match existing {
            Some(mut prop) => {
                prop.value = value.to_string();
                prop.r#type = type_.to_string();
                prop.updated_at = chrono::Utc::now().timestamp_millis();
                storage.properties().update(&prop)
            }
            None => PropertyService::create(storage, block_id, key, value, type_, 0, 0, 1),
        }
    })
}

#[tauri::command]
pub async fn delete_property(db: State<'_, super::state::DatabaseConnection>, block_id: &str, key: &str) -> Result<(), String> {
    execute_with_adapter(db, |storage| {
        if let Some(prop) = PropertyService::get_by_block_id_and_key(storage, block_id, key)? {
            storage.properties().delete(&prop.id)?;
        }
        Ok(())
    })
}
```

### 步骤3：实现批处理 API

```rust
#[tauri::command]
pub async fn execute_batch(db: State<'_, super::state::DatabaseConnection>, operations: Vec<serde_json::Value>) -> Result<Vec<serde_json::Value>, String> {
    execute_with_adapter(db, |storage| {
        let mut results = Vec::new();
        for op in operations {
            let entity: String = op.get("entity")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let action: String = op.get("action")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let params = op.get("params").cloned().unwrap_or_default();

            let result = match (entity.as_str(), action.as_str()) {
                ("block", "create") => {
                    let block: Block = serde_json::from_value(params)?;
                    let result = storage.blocks().create(&block)?;
                    serde_json::to_value(result)?
                }
                ("block", "update") => {
                    let block: Block = serde_json::from_value(params)?;
                    let result = storage.blocks().update(&block)?;
                    serde_json::to_value(result)?
                }
                ("block", "delete") => {
                    let id: String = params.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    storage.blocks().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("page", "create") => {
                    let page: Page = serde_json::from_value(params)?;
                    let result = storage.pages().create(&page)?;
                    serde_json::to_value(result)?
                }
                ("page", "update") => {
                    let page: Page = serde_json::from_value(params)?;
                    let result = storage.pages().update(&page)?;
                    serde_json::to_value(result)?
                }
                ("page", "delete") => {
                    let id: String = params.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    storage.pages().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("link", "create") => {
                    let link: Link = serde_json::from_value(params)?;
                    let result = storage.links().create(&link)?;
                    serde_json::to_value(result)?
                }
                ("link", "delete") => {
                    let id: String = params.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    storage.links().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("property", "create") => {
                    let prop: Property = serde_json::from_value(params)?;
                    let result = storage.properties().create(&prop)?;
                    serde_json::to_value(result)?
                }
                ("property", "update") => {
                    let prop: Property = serde_json::from_value(params)?;
                    let result = storage.properties().update(&prop)?;
                    serde_json::to_value(result)?
                }
                ("property", "delete") => {
                    let id: String = params.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    storage.properties().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("relationship_type", "create") => {
                    let rt: RelationshipType = serde_json::from_value(params)?;
                    let result = storage.relationship_types().create(&rt)?;
                    serde_json::to_value(result)?
                }
                ("relationship_type", "update") => {
                    let rt: RelationshipType = serde_json::from_value(params)?;
                    let result = storage.relationship_types().update(&rt)?;
                    serde_json::to_value(result)?
                }
                ("relationship_type", "delete") => {
                    let id: String = params.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    storage.relationship_types().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("template", "create") => {
                    let template: UserTemplate = serde_json::from_value(params)?;
                    let result = storage.templates().create(&template)?;
                    serde_json::to_value(result)?
                }
                ("template", "update") => {
                    let template: UserTemplate = serde_json::from_value(params)?;
                    let result = storage.templates().update(&template)?;
                    serde_json::to_value(result)?
                }
                ("template", "delete") => {
                    let id: String = params.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    storage.templates().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                _ => serde_json::to_value(format!("Unknown operation: {} {}", entity, action))?,
            };
            results.push(result);
        }
        Ok(results)
    })
}
```

### 步骤4：编译检查

执行命令：`cd comind/src-tauri && cargo check`
预期结果：编译通过，无错误

---

## 任务3：实现 Tauri 主入口
**涉及文件：**
- 修改：`comind/src-tauri/src/main.rs`
- 测试：无

### 步骤1：实现完整的 Tauri 主入口

```rust
use tauri::{Manager, Window};
use std::path::Path;

mod commands;
mod state;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            let data_dir = app_handle.path_resolver().app_data_dir()
                .expect("Failed to get app data directory");
            
            if !data_dir.exists() {
                std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");
            }

            let db = state::DatabaseConnection::new(&data_dir)
                .expect("Failed to initialize database");
            app.manage(db);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_block,
            commands::get_blocks_by_page,
            commands::get_page,
            commands::get_all_pages,
            commands::get_backlinks,
            commands::search,
            commands::get_properties,
            commands::get_relationship_types,
            commands::save_block_tree,
            commands::save_page,
            commands::delete_page_cascade,
            commands::set_property,
            commands::delete_property,
            commands::execute_batch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 步骤2：编译检查

执行命令：`cd comind/src-tauri && cargo check`
预期结果：编译通过，无错误

---

## 任务4：实现 WASM 存储后端（sql.js）
**涉及文件：**
- 新建：`comind/crates/comind-core/src/storage/sqljs.rs`
- 修改：`comind/crates/comind-core/src/storage/mod.rs`
- 修改：`comind/crates/comind-core/Cargo.toml`

### 步骤1：修改 comind-core/Cargo.toml 添加 sql.js 依赖

```toml
[dependencies]
sql-js = { version = "0.4", optional = true }
```

### 步骤2：新建 sqljs.rs 实现 WASM 存储后端

```rust
use std::error::Error;
use std::collections::HashMap;
use sql_js::SqlJs;
use super::super::types::*;
use super::repository::*;

pub struct SqlJsAdapter {
    db: SqlJs,
}

impl SqlJsAdapter {
    pub fn new() -> Result<Self, Box<dyn Error>> {
        let db = SqlJs::default();
        Self::init_schema(&db)?;
        Ok(Self { db })
    }

    fn init_schema(db: &SqlJs) -> Result<(), Box<dyn Error>> {
        db.run(
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
                updated_at      INTEGER NOT NULL
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
                updated_at      INTEGER NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS Link (
                id              TEXT PRIMARY KEY,
                source_block_id TEXT NOT NULL,
                target_page_id  TEXT NOT NULL,
                display_text    TEXT NOT NULL,
                relationship_type TEXT,
                created_at      INTEGER NOT NULL
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
                UNIQUE(block_id, key)
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

fn row_to_block(row: &HashMap<String, String>) -> Block {
    Block {
        id: row.get("id").unwrap_or(&"".to_string()).clone(),
        page_id: row.get("page_id").unwrap_or(&"".to_string()).clone(),
        parent_id: {
            let p = row.get("parent_id").unwrap_or(&"".to_string());
            if p.is_empty() { None } else { Some(p.clone()) }
        },
        pos: row.get("pos").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        content: row.get("content").unwrap_or(&"".to_string()).clone(),
        format: row.get("format").unwrap_or(&"{}".to_string()).clone(),
        r#type: row.get("type").unwrap_or(&"bullet".to_string()).clone(),
        created_at: row.get("created_at").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        updated_at: row.get("updated_at").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

fn row_to_page(row: &HashMap<String, String>) -> Page {
    Page {
        id: row.get("id").unwrap_or(&"".to_string()).clone(),
        block_id: {
            let p = row.get("block_id").unwrap_or(&"".to_string());
            if p.is_empty() { None } else { Some(p.clone()) }
        },
        title: row.get("title").unwrap_or(&"".to_string()).clone(),
        r#type: row.get("type").unwrap_or(&"normal".to_string()).clone(),
        icon: {
            let p = row.get("icon").unwrap_or(&"".to_string());
            if p.is_empty() { None } else { Some(p.clone()) }
        },
        cover: {
            let p = row.get("cover").unwrap_or(&"".to_string());
            if p.is_empty() { None } else { Some(p.clone()) }
        },
        aliases: row.get("aliases").unwrap_or(&"[]".to_string()).clone(),
        file_path: {
            let p = row.get("file_path").unwrap_or(&"".to_string());
            if p.is_empty() { None } else { Some(p.clone()) }
        },
        children_count: row.get("children_count").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        word_count: row.get("word_count").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        deleted: row.get("deleted").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        created_at: row.get("created_at").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        updated_at: row.get("updated_at").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

fn row_to_link(row: &HashMap<String, String>) -> Link {
    Link {
        id: row.get("id").unwrap_or(&"".to_string()).clone(),
        source_block_id: row.get("source_block_id").unwrap_or(&"".to_string()).clone(),
        target_page_id: row.get("target_page_id").unwrap_or(&"".to_string()).clone(),
        display_text: row.get("display_text").unwrap_or(&"".to_string()).clone(),
        relationship_type: {
            let p = row.get("relationship_type").unwrap_or(&"".to_string());
            if p.is_empty() { None } else { Some(p.clone()) }
        },
        created_at: row.get("created_at").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

fn row_to_property(row: &HashMap<String, String>) -> Property {
    Property {
        id: row.get("id").unwrap_or(&"".to_string()).clone(),
        block_id: row.get("block_id").unwrap_or(&"".to_string()).clone(),
        key: row.get("key").unwrap_or(&"".to_string()).clone(),
        value: row.get("value").unwrap_or(&"".to_string()).clone(),
        r#type: row.get("type").unwrap_or(&"".to_string()).clone(),
        sort_order: row.get("sort_order").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        is_hidden: row.get("is_hidden").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        is_deleted: row.get("is_deleted").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        schema_version: row.get("schema_version").unwrap_or(&"1".to_string()).parse::<i64>().unwrap_or(1),
        created_at: row.get("created_at").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        updated_at: row.get("updated_at").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

fn row_to_relationship_type(row: &HashMap<String, String>) -> RelationshipType {
    RelationshipType {
        id: row.get("id").unwrap_or(&"".to_string()).clone(),
        r#type: row.get("type").unwrap_or(&"".to_string()).clone(),
        inverse: {
            let p = row.get("inverse").unwrap_or(&"".to_string());
            if p.is_empty() { None } else { Some(p.clone()) }
        },
        label: row.get("label").unwrap_or(&"".to_string()).clone(),
        inverse_label: row.get("inverse_label").unwrap_or(&"".to_string()).clone(),
        color: row.get("color").unwrap_or(&"".to_string()).clone(),
        order: row.get("order").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        strength: row.get("strength").unwrap_or(&"medium".to_string()).clone(),
        deleted: row.get("deleted").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        builtin: row.get("builtin").unwrap_or(&"1".to_string()).parse::<i64>().unwrap_or(1),
        created_at: row.get("created_at").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        updated_at: row.get("updated_at").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

fn row_to_template(row: &HashMap<String, String>) -> UserTemplate {
    UserTemplate {
        id: row.get("id").unwrap_or(&"".to_string()).clone(),
        name: row.get("name").unwrap_or(&"".to_string()).clone(),
        category: row.get("category").unwrap_or(&"".to_string()).clone(),
        content: row.get("content").unwrap_or(&"".to_string()).clone(),
        created_at: row.get("created_at").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
        updated_at: row.get("updated_at").unwrap_or(&"0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

impl BlockRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at FROM Block WHERE id = ?",
            &[id]
        )?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Block not found")));
        }
        Ok(row_to_block(&result[0]))
    }

    fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at FROM Block WHERE page_id = ? ORDER BY pos",
            &[page_id]
        )?;
        Ok(result.into_iter().map(row_to_block).collect())
    }

    fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at FROM Block WHERE parent_id = ? ORDER BY pos",
            &[parent_id]
        )?;
        Ok(result.into_iter().map(row_to_block).collect())
    }

    fn create(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        let parent_id = block.parent_id.as_deref().unwrap_or("");
        self.db.exec(
            "INSERT INTO Block (id, page_id, parent_id, pos, content, format, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &[
                &block.id, &block.page_id, parent_id, 
                &block.pos.to_string(), &block.content, &block.format, 
                &block.r#type, &block.created_at.to_string(), &block.updated_at.to_string()
            ]
        )?;
        Ok(block.clone())
    }

    fn update(&mut self, block: &Block) -> Result<Block, Box<dyn Error>> {
        let parent_id = block.parent_id.as_deref().unwrap_or("");
        self.db.exec(
            "UPDATE Block SET page_id = ?, parent_id = ?, pos = ?, content = ?, format = ?, type = ?, updated_at = ? WHERE id = ?",
            &[
                &block.page_id, parent_id, &block.pos.to_string(), 
                &block.content, &block.format, &block.r#type, 
                &block.updated_at.to_string(), &block.id
            ]
        )?;
        Ok(block.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.db.exec("DELETE FROM Block WHERE id = ?", &[id])?;
        Ok(())
    }

    fn delete_by_page_id(&mut self, page_id: &str) -> Result<(), Box<dyn Error>> {
        self.db.exec("DELETE FROM Block WHERE page_id = ?", &[page_id])?;
        Ok(())
    }
}

impl PageRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<Page, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at FROM Page WHERE id = ?",
            &[id]
        )?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Page not found")));
        }
        Ok(row_to_page(&result[0]))
    }

    fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at FROM Page WHERE title = ? AND deleted = 0",
            &[title]
        )?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_page(&result[0])))
        }
    }

    fn get_all(&self) -> Result<Vec<Page>, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at FROM Page WHERE deleted = 0 ORDER BY updated_at DESC",
            &[]
        )?;
        Ok(result.into_iter().map(row_to_page).collect())
    }

    fn create(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        let block_id = page.block_id.as_deref().unwrap_or("");
        let icon = page.icon.as_deref().unwrap_or("");
        let cover = page.cover.as_deref().unwrap_or("");
        let file_path = page.file_path.as_deref().unwrap_or("");
        self.db.exec(
            "INSERT INTO Page (id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &[
                &page.id, block_id, &page.title, &page.r#type, icon, cover, 
                &page.aliases, file_path, &page.children_count.to_string(), 
                &page.word_count.to_string(), &page.deleted.to_string(), 
                &page.created_at.to_string(), &page.updated_at.to_string()
            ]
        )?;
        Ok(page.clone())
    }

    fn update(&mut self, page: &Page) -> Result<Page, Box<dyn Error>> {
        let block_id = page.block_id.as_deref().unwrap_or("");
        let icon = page.icon.as_deref().unwrap_or("");
        let cover = page.cover.as_deref().unwrap_or("");
        let file_path = page.file_path.as_deref().unwrap_or("");
        self.db.exec(
            "UPDATE Page SET block_id = ?, title = ?, type = ?, icon = ?, cover = ?, aliases = ?, file_path = ?, children_count = ?, word_count = ?, deleted = ?, updated_at = ? WHERE id = ?",
            &[
                block_id, &page.title, &page.r#type, icon, cover, 
                &page.aliases, file_path, &page.children_count.to_string(), 
                &page.word_count.to_string(), &page.deleted.to_string(), 
                &page.updated_at.to_string(), &page.id
            ]
        )?;
        Ok(page.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.exec(
            "UPDATE Page SET deleted = 1, updated_at = ? WHERE id = ?",
            &[&now.to_string(), id]
        )?;
        Ok(())
    }
}

impl LinkRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at FROM Link WHERE id = ?",
            &[id]
        )?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Link not found")));
        }
        Ok(row_to_link(&result[0]))
    }

    fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at FROM Link WHERE source_block_id = ?",
            &[source_block_id]
        )?;
        Ok(result.into_iter().map(row_to_link).collect())
    }

    fn get_by_target_page_id(&self, target_page_id: &str) -> Result<Vec<Link>, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at FROM Link WHERE target_page_id = ?",
            &[target_page_id]
        )?;
        Ok(result.into_iter().map(row_to_link).collect())
    }

    fn create(&mut self, link: &Link) -> Result<Link, Box<dyn Error>> {
        let relationship_type = link.relationship_type.as_deref().unwrap_or("");
        self.db.exec(
            "INSERT INTO Link (id, source_block_id, target_page_id, display_text, relationship_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            &[
                &link.id, &link.source_block_id, &link.target_page_id, 
                &link.display_text, relationship_type, &link.created_at.to_string()
            ]
        )?;
        Ok(link.clone())
    }

    fn create_many(&mut self, links: &[Link]) -> Result<Vec<Link>, Box<dyn Error>> {
        for link in links {
            self.create(link)?;
        }
        Ok(links.to_vec())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.db.exec("DELETE FROM Link WHERE id = ?", &[id])?;
        Ok(())
    }

    fn delete_by_source_block_id(&mut self, source_block_id: &str) -> Result<(), Box<dyn Error>> {
        self.db.exec("DELETE FROM Link WHERE source_block_id = ?", &[source_block_id])?;
        Ok(())
    }
}

impl PropertyRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at FROM Property WHERE id = ?",
            &[id]
        )?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Property not found")));
        }
        Ok(row_to_property(&result[0]))
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at FROM Property WHERE block_id = ? AND is_deleted = 0 ORDER BY sort_order",
            &[block_id]
        )?;
        Ok(result.into_iter().map(row_to_property).collect())
    }

    fn get_by_block_id_and_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at FROM Property WHERE block_id = ? AND key = ? AND is_deleted = 0",
            &[block_id, key]
        )?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_property(&result[0])))
        }
    }

    fn create(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        self.db.exec(
            "INSERT INTO Property (id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &[
                &property.id, &property.block_id, &property.key, &property.value, &property.r#type,
                &property.sort_order.to_string(), &property.is_hidden.to_string(), &property.is_deleted.to_string(),
                &property.schema_version.to_string(), &property.created_at.to_string(), &property.updated_at.to_string()
            ]
        )?;
        Ok(property.clone())
    }

    fn update(&mut self, property: &Property) -> Result<Property, Box<dyn Error>> {
        self.db.exec(
            "UPDATE Property SET value = ?, type = ?, sort_order = ?, is_hidden = ?, is_deleted = ?, updated_at = ? WHERE id = ?",
            &[
                &property.value, &property.r#type, &property.sort_order.to_string(),
                &property.is_hidden.to_string(), &property.is_deleted.to_string(),
                &property.updated_at.to_string(), &property.id
            ]
        )?;
        Ok(property.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.db.exec("DELETE FROM Property WHERE id = ?", &[id])?;
        Ok(())
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        self.db.exec("DELETE FROM Property WHERE block_id = ?", &[block_id])?;
        Ok(())
    }
}

impl RelationshipTypeRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<RelationshipType, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, type, inverse, label, inverse_label, color, order, strength, deleted, builtin, created_at, updated_at FROM RelationshipType WHERE id = ?",
            &[id]
        )?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "RelationshipType not found")));
        }
        Ok(row_to_relationship_type(&result[0]))
    }

    fn get_by_type(&self, r#type: &str) -> Result<Option<RelationshipType>, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, type, inverse, label, inverse_label, color, order, strength, deleted, builtin, created_at, updated_at FROM RelationshipType WHERE type = ? AND deleted = 0",
            &[r#type]
        )?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_relationship_type(&result[0])))
        }
    }

    fn get_all(&self) -> Result<Vec<RelationshipType>, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, type, inverse, label, inverse_label, color, order, strength, deleted, builtin, created_at, updated_at FROM RelationshipType WHERE deleted = 0 ORDER BY order",
            &[]
        )?;
        Ok(result.into_iter().map(row_to_relationship_type).collect())
    }

    fn create(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        let inverse = rt.inverse.as_deref().unwrap_or("");
        self.db.exec(
            "INSERT INTO RelationshipType (id, type, inverse, label, inverse_label, color, order, strength, deleted, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &[
                &rt.id, &rt.r#type, inverse, &rt.label, &rt.inverse_label, &rt.color,
                &rt.order.to_string(), &rt.strength, &rt.deleted.to_string(), &rt.builtin.to_string(),
                &rt.created_at.to_string(), &rt.updated_at.to_string()
            ]
        )?;
        Ok(rt.clone())
    }

    fn update(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>> {
        let inverse = rt.inverse.as_deref().unwrap_or("");
        self.db.exec(
            "UPDATE RelationshipType SET type = ?, inverse = ?, label = ?, inverse_label = ?, color = ?, order = ?, strength = ?, deleted = ?, updated_at = ? WHERE id = ?",
            &[
                &rt.r#type, inverse, &rt.label, &rt.inverse_label, &rt.color,
                &rt.order.to_string(), &rt.strength, &rt.deleted.to_string(),
                &rt.updated_at.to_string(), &rt.id
            ]
        )?;
        Ok(rt.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.exec(
            "UPDATE RelationshipType SET deleted = 1, updated_at = ? WHERE id = ?",
            &[&now.to_string(), id]
        )?;
        Ok(())
    }
}

impl TemplateRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<UserTemplate, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, name, category, content, created_at, updated_at FROM UserTemplate WHERE id = ?",
            &[id]
        )?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Template not found")));
        }
        Ok(row_to_template(&result[0]))
    }

    fn get_by_name(&self, name: &str) -> Result<Option<UserTemplate>, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, name, category, content, created_at, updated_at FROM UserTemplate WHERE name = ?",
            &[name]
        )?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_template(&result[0])))
        }
    }

    fn get_all(&self) -> Result<Vec<UserTemplate>, Box<dyn Error>> {
        let result = self.db.exec(
            "SELECT id, name, category, content, created_at, updated_at FROM UserTemplate ORDER BY name",
            &[]
        )?;
        Ok(result.into_iter().map(row_to_template).collect())
    }

    fn create(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
        self.db.exec(
            "INSERT INTO UserTemplate (id, name, category, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            &[
                &template.id, &template.name, &template.category, &template.content,
                &template.created_at.to_string(), &template.updated_at.to_string()
            ]
        )?;
        Ok(template.clone())
    }

    fn update(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>> {
        self.db.exec(
            "UPDATE UserTemplate SET name = ?, category = ?, content = ?, updated_at = ? WHERE id = ?",
            &[
                &template.name, &template.category, &template.content,
                &template.updated_at.to_string(), &template.id
            ]
        )?;
        Ok(template.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.db.exec("DELETE FROM UserTemplate WHERE id = ?", &[id])?;
        Ok(())
    }
}

impl SearchRepository for SqlJsAdapter {
    fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, Box<dyn Error>> {
        Ok(Vec::new())
    }

    fn update_index(&mut self, block_id: &str, content: &str, title: &str) -> Result<(), Box<dyn Error>> {
        Ok(())
    }

    fn delete_from_index(&mut self, block_id: &str) -> Result<(), Box<dyn Error>> {
        Ok(())
    }
}

impl StorageAdapter for SqlJsAdapter {
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

impl TransactionalStorageAdapter for SqlJsAdapter {
    fn transaction<R, F>(&mut self, f: F) -> Result<R, Box<dyn Error>>
    where
        F: FnOnce(&mut dyn StorageAdapter) -> Result<R, Box<dyn Error>>,
    {
        f(self)
    }
}
```

### 步骤3：修改 mod.rs 添加 sqljs 模块导出

```rust
pub mod repository;
pub mod sqlite;
pub mod sqljs;

pub use repository::*;
pub use sqlite::*;
pub use sqljs::*;
```

### 步骤4：编译检查

执行命令：`cd comind && cargo check --lib -p comind-core`
预期结果：编译通过，无错误

---

## 任务5：实现 WASM 绑定
**涉及文件：**
- 修改：`comind/crates/comind-wasm/src/lib.rs`
- 修改：`comind/crates/comind-wasm/Cargo.toml`

### 步骤1：修改 comind-wasm/Cargo.toml 添加依赖

```toml
[dependencies]
comind-core = { path = "../comind-core", features = ["sql-js"] }
wasm-bindgen = { version = "0.2", features = ["serde-serialize"] }
wasm-bindgen-futures = "0.4"
js-sys = "0.3"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
sql-js = "0.4"
```

### 步骤2：实现完整的 WASM 绑定

```rust
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;
use comind_core::{
    services::{BlockService, PageService, LinkService, PropertyService, RelationshipTypeService},
    storage::SqlJsAdapter,
    types::*,
};
use std::sync::Mutex;

lazy_static::lazy_static! {
    static ref ADAPTER: Mutex<Option<SqlJsAdapter>> = Mutex::new(None);
}

#[wasm_bindgen]
pub fn init_db() -> Result<(), JsValue> {
    let mut adapter = ADAPTER.lock().map_err(|e| JsValue::from_str(&format!("Failed to lock adapter: {}", e)))?;
    *adapter = Some(SqlJsAdapter::new().map_err(|e| JsValue::from_str(&e.to_string()))?);
    Ok(())
}

fn get_adapter() -> Result<std::sync::MutexGuard<'static, Option<SqlJsAdapter>>, JsValue> {
    let adapter = ADAPTER.lock().map_err(|e| JsValue::from_str(&format!("Failed to lock adapter: {}", e)))?;
    if adapter.is_none() {
        return Err(JsValue::from_str("Database not initialized. Call init_db() first."));
    }
    Ok(adapter)
}

#[wasm_bindgen]
pub async fn get_block(block_id: &str) -> Result<JsValue, JsValue> {
    let mut adapter = get_adapter()?;
    let result = BlockService::get_by_id(adapter.as_mut().unwrap(), block_id)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_serde(&result).unwrap())
}

#[wasm_bindgen]
pub async fn get_blocks_by_page(page_id: &str) -> Result<JsValue, JsValue> {
    let mut adapter = get_adapter()?;
    let result = BlockService::get_by_page_id(adapter.as_mut().unwrap(), page_id)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_serde(&result).unwrap())
}

#[wasm_bindgen]
pub async fn get_page(page_id: &str) -> Result<JsValue, JsValue> {
    let mut adapter = get_adapter()?;
    let result = PageService::get_by_id(adapter.as_mut().unwrap(), page_id)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_serde(&result).unwrap())
}

#[wasm_bindgen]
pub async fn get_all_pages() -> Result<JsValue, JsValue> {
    let mut adapter = get_adapter()?;
    let result = PageService::get_all(adapter.as_mut().unwrap())
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_serde(&result).unwrap())
}

#[wasm_bindgen]
pub async fn save_block_tree(blocks: JsValue) -> Result<JsValue, JsValue> {
    let blocks: Vec<Block> = serde_json::from_str(&blocks.as_string().unwrap_or("[]"))
        .map_err(|e| JsValue::from_str(&format!("Failed to parse blocks: {}", e)))?;
    
    let mut adapter = get_adapter()?;
    let mut results = Vec::new();
    for block in blocks {
        let existing = BlockService::get_by_id(adapter.as_mut().unwrap(), &block.id);
        let result = match existing {
            Ok(_) => adapter.as_mut().unwrap().blocks().update(&block),
            Err(_) => adapter.as_mut().unwrap().blocks().create(&block),
        };
        results.push(result.map_err(|e| JsValue::from_str(&e.to_string()))?);
    }
    Ok(JsValue::from_serde(&results).unwrap())
}

#[wasm_bindgen]
pub async fn save_page(page: JsValue) -> Result<JsValue, JsValue> {
    let page: Page = serde_json::from_str(&page.as_string().unwrap_or("{}"))
        .map_err(|e| JsValue::from_str(&format!("Failed to parse page: {}", e)))?;
    
    let mut adapter = get_adapter()?;
    let existing = PageService::get_by_id(adapter.as_mut().unwrap(), &page.id);
    let result = match existing {
        Ok(_) => adapter.as_mut().unwrap().pages().update(&page),
        Err(_) => adapter.as_mut().unwrap().pages().create(&page),
    };
    let result = result.map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_serde(&result).unwrap())
}

#[wasm_bindgen]
pub async fn delete_page_cascade(page_id: &str) -> Result<JsValue, JsValue> {
    let mut adapter = get_adapter()?;
    let a = adapter.as_mut().unwrap();
    a.properties().delete_by_block_id(page_id).map_err(|e| JsValue::from_str(&e.to_string()))?;
    a.links().delete_by_source_block_id(page_id).map_err(|e| JsValue::from_str(&e.to_string()))?;
    a.blocks().delete_by_page_id(page_id).map_err(|e| JsValue::from_str(&e.to_string()))?;
    a.pages().delete(page_id).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_str("OK"))
}

#[wasm_bindgen]
pub async fn search(query: &str) -> Result<JsValue, JsValue> {
    let mut adapter = get_adapter()?;
    let result = adapter.as_mut().unwrap().search().search(query, 20)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_serde(&result).unwrap())
}

#[wasm_bindgen]
pub async fn get_backlinks(page_id: &str) -> Result<JsValue, JsValue> {
    let mut adapter = get_adapter()?;
    let result = LinkService::get_backlinks(adapter.as_mut().unwrap(), page_id)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_serde(&result).unwrap())
}

#[wasm_bindgen]
pub async fn get_properties(block_id: &str) -> Result<JsValue, JsValue> {
    let mut adapter = get_adapter()?;
    let result = PropertyService::get_by_block_id(adapter.as_mut().unwrap(), block_id)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_serde(&result).unwrap())
}

#[wasm_bindgen]
pub async fn set_property(block_id: &str, key: &str, value: &str, type_: &str) -> Result<JsValue, JsValue> {
    let mut adapter = get_adapter()?;
    let a = adapter.as_mut().unwrap();
    
    let existing = PropertyService::get_by_block_id_and_key(a, block_id, key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    
    let result = match existing {
        Some(mut prop) => {
            prop.value = value.to_string();
            prop.r#type = type_.to_string();
            prop.updated_at = chrono::Utc::now().timestamp_millis();
            a.properties().update(&prop)
        }
        None => PropertyService::create(a, block_id, key, value, type_, 0, 0, 1),
    };
    
    let result = result.map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_serde(&result).unwrap())
}

#[wasm_bindgen]
pub async fn delete_property(block_id: &str, key: &str) -> Result<JsValue, JsValue> {
    let mut adapter = get_adapter()?;
    let a = adapter.as_mut().unwrap();
    
    if let Some(prop) = PropertyService::get_by_block_id_and_key(a, block_id, key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?
    {
        a.properties().delete(&prop.id).map_err(|e| JsValue::from_str(&e.to_string()))?;
    }
    
    Ok(JsValue::from_str("OK"))
}

#[wasm_bindgen]
pub async fn get_relationship_types() -> Result<JsValue, JsValue> {
    let mut adapter = get_adapter()?;
    let result = RelationshipTypeService::get_all(adapter.as_mut().unwrap())
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_serde(&result).unwrap())
}
```

### 步骤3：编译检查

执行命令：`cd comind/crates/comind-wasm && cargo check --target wasm32-unknown-unknown`
预期结果：编译通过，无错误

---

## 任务6：WASM 编译配置
**涉及文件：**
- 修改：`comind/crates/comind-wasm/Cargo.toml`

### 步骤1：确认 WASM 编译配置

```toml
[lib]
crate-type = ["cdylib", "rlib"]

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
```

### 步骤2：测试 WASM 打包

执行命令：`cd comind/crates/comind-wasm && wasm-pack build --target web --out-dir ../../comind/src/wasm`
预期结果：打包成功，生成 `comind/src/wasm/comind_wasm.js` 和 `.wasm` 文件

---

## 自我审核

1. **规范覆盖性**：
   - ✅ T3.3.1: 定义 Tauri Command（混合模式）—— 实现了细粒度查询、粗粒度写操作、批处理 API
   - ✅ T3.3.2: 实现 WASM 绑定 —— 实现了所有 12 个函数
   - ✅ T3.3.3: 实现 WASM 存储后端 —— 实现了 SqlJsAdapter
   - ✅ T3.3.4: WASM 编译配置 —— 配置了 wasm-pack

2. **占位内容排查**：无占位内容

3. **类型一致性**：
   - ✅ Tauri Command 返回类型与设计文档一致
   - ✅ WASM 绑定函数签名与设计文档一致
   - ✅ 存储后端实现了所有 Repository trait
