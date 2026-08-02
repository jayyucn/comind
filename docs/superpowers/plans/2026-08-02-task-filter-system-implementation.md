# 任务系统与筛选系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-08-02-task-filter-system-design.md`（v2，commit 5776d2e）
**Goal:** 实现通用 Block 筛选系统 + 全局任务中心（表格/看板/日历三视图）
**Architecture:** P1 数据层 → P2 引擎 → P3 持久化 → P4 视图 → P5 入口/导航 → P6 测试打磨
**Tech Stack:** Rust (Tauri + comind-core), Vue 3, TypeScript, Vitest, Pinia

---

## 文件结构

| 文件 | 操作 | 目的 |
|------|------|------|
| `crates/comind-core/src/types/block_card.rs` | 创建 | BlockCard / DateRefLite Rust 类型 |
| `crates/comind-core/src/types/mod.rs` | 修改 | 注册 block_card 模块 |
| `crates/comind-core/src/storage/sqlite.rs` | 修改 | 新增 saved_filters / task_views 表 + CRUD + get_blocks_projection |
| `crates/comind-core/src/storage/sqljs.rs` | 修改 | 镜像新增表 + CRUD（WASM 适配器） |
| `crates/comind-core/src/storage/mod.rs` | 修改 | 注册 SavedFilter / TaskView repository trait |
| `src-tauri/src/commands.rs` | 修改 | 新增 6 个 Tauri command |
| `src-tauri/src/lib.rs` | 修改 | 注册新 command 到 invoke_handler |
| `src/wasm/client.ts` | 修改 | 新增 BlockCard / SavedFilter / TaskView 方法 |
| `src/types/blockQuery.ts` | 创建 | 筛选引擎类型定义 |
| `src/types/blockCard.ts` | 创建 | 前端 BlockCard 类型 |
| `src/composables/useBlockQuery.ts` | 创建 | applyQuery 纯函数 |
| `src/stores/blockCard.ts` | 创建 | BlockCard store + 缓存失效 |
| `src/stores/savedFilter.ts` | 创建 | SavedFilter store |
| `src/stores/taskView.ts` | 创建 | TaskView store |
| `src/router/routes.ts` | 修改 | 新增 /tasks 路由 |
| `src/components/Sidebar/SidebarContainer.vue` | 修改 | 新增「✅ 任务」侧栏项 |
| `src/components/TaskHub/TaskHub.vue` | 创建 | 任务中心容器 |
| `src/components/TaskHub/TaskViewBar.vue` | 创建 | 视图切换 + 命名视图管理 |
| `src/components/TaskHub/TaskFilterBar.vue` | 创建 | 通用筛选规则构建器 |
| `src/components/TaskHub/TableView.vue` | 创建 | 表格视图 |
| `src/components/TaskHub/BoardView.vue` | 创建 | 看板视图 |
| `src/components/TaskHub/CalendarView.vue` | 创建 | 日历视图 |

---

## Task 1: Rust 类型定义 — BlockCard / DateRefLite / SavedFilter / TaskView

**Files:**
- Create: `crates/comind-core/src/types/block_card.rs`
- Modify: `crates/comind-core/src/types/mod.rs`

- [ ] **Step 1: 创建 `block_card.rs`**

```rust
use std::collections::HashMap;

/// 轻量日期引用（投影自 date_ref 表）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DateRefLite {
    pub kind: String,
    pub iso: String,
    pub date_day: String,
    pub recurrence: String,
    pub event_ts: i64,
}

/// 单个 block 的轻量投影
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BlockCard {
    pub block_id: String,
    pub page_id: String,
    pub parent_id: String,
    pub content_preview: String,
    pub properties: HashMap<String, serde_json::Value>,
    pub date_refs: Vec<DateRefLite>,
    pub updated_at: i64,
}

/// 保存的筛选规则（模板库）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SavedFilter {
    pub id: String,
    pub name: String,
    pub query_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 任务中心命名视图
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TaskView {
    pub id: String,
    pub name: String,
    pub query_json: String,   // 内联完整 BlockQuery（非外键引用）
    pub view_type: String,    // table | board | calendar
    pub group_by: String,
    pub is_default: i64,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}
```

- [ ] **Step 2: 在 `mod.rs` 中注册模块**

在 `crates/comind-core/src/types/mod.rs` 添加：
```rust
pub mod block_card;
pub use block_card::{BlockCard, DateRefLite, SavedFilter, TaskView};
```

- [ ] **Step 3: 验证编译**

```powershell
cd D:\comind\comind; cargo check 2>&1 | Select-Object -Last 5
```

---

## Task 2: SQLiteAdapter — 新增表 + CRUD + get_blocks_projection

**Files:**
- Modify: `crates/comind-core/src/storage/sqlite.rs`
- Modify: `crates/comind-core/src/storage/mod.rs`

- [ ] **Step 1: 在 `init_schema` 中新增两张表**

在 `sqlite.rs` 的 `init_schema` 函数末尾（DateRef 表创建之后）添加：

```rust
self.conn.execute(
    "CREATE TABLE IF NOT EXISTS SavedFilter (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        query_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );",
    [],
)?;
self.conn.execute(
    "CREATE TABLE IF NOT EXISTS TaskView (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        query_json TEXT NOT NULL,
        view_type TEXT NOT NULL DEFAULT 'table',
        group_by TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );",
    [],
)?;
```

- [ ] **Step 2: 实现 SavedFilter CRUD**

在 `sqlite.rs` 中添加 SavedFilter repository 实现：

```rust
impl SavedFilterRepository for SqliteAdapter {
    fn get_all_saved_filters(&self) -> Result<Vec<SavedFilter>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, query_json, created_at, updated_at FROM SavedFilter ORDER BY updated_at DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SavedFilter {
                id: row.get(0)?,
                name: row.get(1)?,
                query_json: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.into())
    }

    fn save_saved_filter(&mut self, name: &str, query_json: &str) -> Result<SavedFilter, Box<dyn Error>> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO SavedFilter (id, name, query_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
            rusqlite::params![id, name, query_json, now],
        )?;
        Ok(SavedFilter { id, name: name.to_string(), query_json: query_json.to_string(), created_at: now, updated_at: now })
    }

    fn update_saved_filter(&mut self, id: &str, name: &str, query_json: &str) -> Result<(), Box<dyn Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE SavedFilter SET name = ?1, query_json = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![name, query_json, now, id],
        )?;
        Ok(())
    }

    fn delete_saved_filter(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("DELETE FROM SavedFilter WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }
}
```

- [ ] **Step 3: 实现 TaskView CRUD**

```rust
impl TaskViewRepository for SqliteAdapter {
    fn get_all_task_views(&self) -> Result<Vec<TaskView>, Box<dyn Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, query_json, view_type, group_by, is_default, sort_order, created_at, updated_at FROM TaskView ORDER BY sort_order ASC, updated_at DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TaskView {
                id: row.get(0)?,
                name: row.get(1)?,
                query_json: row.get(2)?,
                view_type: row.get(3)?,
                group_by: row.get(4)?,
                is_default: row.get(5)?,
                sort_order: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.into())
    }

    fn save_task_view(&mut self, name: &str, query_json: &str, view_type: &str, group_by: &str, is_default: bool, sort_order: i64) -> Result<TaskView, Box<dyn Error>> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        if is_default {
            self.conn.execute("UPDATE TaskView SET is_default = 0", [])?;
        }
        self.conn.execute(
            "INSERT INTO TaskView (id, name, query_json, view_type, group_by, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            rusqlite::params![id, name, query_json, view_type, group_by, is_default as i64, sort_order, now],
        )?;
        Ok(TaskView { id, name: name.to_string(), query_json: query_json.to_string(), view_type: view_type.to_string(), group_by: group_by.to_string(), is_default: is_default as i64, sort_order, created_at: now, updated_at: now })
    }

    fn update_task_view(&mut self, id: &str, name: &str, query_json: &str, view_type: &str, group_by: &str) -> Result<(), Box<dyn Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE TaskView SET name = ?1, query_json = ?2, view_type = ?3, group_by = ?4, updated_at = ?5 WHERE id = ?6",
            rusqlite::params![name, query_json, view_type, group_by, now, id],
        )?;
        Ok(())
    }

    fn delete_task_view(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        // 不允许删除默认视图
        let is_default: i64 = self.conn.query_row(
            "SELECT is_default FROM TaskView WHERE id = ?1", rusqlite::params![id], |row| row.get(0)
        )?;
        if is_default == 1 {
            return Err("Cannot delete default task view".into());
        }
        self.conn.execute("DELETE FROM TaskView WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    fn set_default_task_view(&mut self, id: &str) -> Result<(), Box<dyn Error>> {
        self.conn.execute("UPDATE TaskView SET is_default = 0", [])?;
        self.conn.execute("UPDATE TaskView SET is_default = 1 WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    fn ensure_default_task_view(&mut self) -> Result<(), Box<dyn Error>> {
        let count: i64 = self.conn.query_row("SELECT COUNT(*) FROM TaskView WHERE is_default = 1", [], |row| row.get(0))?;
        if count == 0 {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().timestamp_millis();
            let default_query = r#"{"filters":[{"field":{"kind":"property","key":"status"},"op":"hasAny","value":null}],"sort":[],"groupBy":null}"#;
            self.conn.execute(
                "INSERT INTO TaskView (id, name, query_json, view_type, group_by, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, 0, ?6, ?6)",
                rusqlite::params![id, "全部任务", default_query, "table", "", now],
            )?;
        }
        Ok(())
    }
}
```

- [ ] **Step 4: 实现 `get_blocks_projection()`**

```rust
impl SqliteAdapter {
    pub fn get_blocks_projection(&self) -> Result<Vec<BlockCard>, Box<dyn Error>> {
        // 1. 查全部未删除 block
        let mut stmt = self.conn.prepare(
            "SELECT id, page_id, parent_id, content, updated_at FROM Block WHERE deleted_at IS NULL"
        )?;
        let block_rows: Vec<(String, String, String, String, i64)> = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        })?.collect::<Result<Vec<_>, _>>()?;

        // 2. 查全部有效属性
        let mut prop_stmt = self.conn.prepare(
            "SELECT block_id, key, value, type FROM Property WHERE is_deleted = 0"
        )?;
        let prop_rows: Vec<(String, String, String, String)> = prop_stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?.collect::<Result<Vec<_>, _>>()?;

        // 3. 查全部有效 date_ref
        let mut dr_stmt = self.conn.prepare(
            "SELECT block_id, kind, iso, date_day, recurrence, event_ts FROM DateRef WHERE deleted_at IS NULL"
        )?;
        let dr_rows: Vec<(String, String, String, String, String, i64)> = dr_stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
        })?.collect::<Result<Vec<_>, _>>()?;

        // 4. Rust 端组装
        use std::collections::HashMap;
        let mut prop_map: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
        for (block_id, key, value, prop_type) in prop_rows {
            prop_map.entry(block_id).or_default().push((key, value, prop_type));
        }
        let mut dr_map: HashMap<String, Vec<DateRefLite>> = HashMap::new();
        for (block_id, kind, iso, date_day, recurrence, event_ts) in dr_rows {
            dr_map.entry(block_id).or_default().push(DateRefLite { kind, iso, date_day, recurrence, event_ts });
        }

        let re = regex::Regex::new(r"\{\{(?:schedule|deadline):[^}]+\}\}").unwrap();
        let cards = block_rows.into_iter().map(|(id, page_id, parent_id, content, updated_at)| {
            let content_preview = {
                let cleaned = re.replace_all(&content, "");
                let trimmed = cleaned.trim();
                if trimmed.len() > 200 { trimmed[..200].to_string() } else { trimmed.to_string() }
            };
            let mut properties: HashMap<String, serde_json::Value> = HashMap::new();
            if let Some(props) = prop_map.get(&id) {
                for (key, value, prop_type) in props {
                    let val = match prop_type.as_str() {
                        "number" => value.parse::<f64>().ok().map(serde_json::Value::from).unwrap_or(serde_json::Value::String(value.clone())),
                        "boolean" => serde_json::Value::Bool(value == "true"),
                        _ => serde_json::Value::String(value.clone()),
                    };
                    properties.insert(key.clone(), val);
                }
            }
            let date_refs = dr_map.get(&id).cloned().unwrap_or_default();
            BlockCard { block_id: id, page_id, parent_id, content_preview, properties, date_refs, updated_at }
        }).collect();

        Ok(cards)
    }
}
```

- [ ] **Step 5: 在 `mod.rs` 中注册 Repository trait**

```rust
pub trait SavedFilterRepository {
    fn get_all_saved_filters(&self) -> Result<Vec<SavedFilter>, Box<dyn Error>>;
    fn save_saved_filter(&mut self, name: &str, query_json: &str) -> Result<SavedFilter, Box<dyn Error>>;
    fn update_saved_filter(&mut self, id: &str, name: &str, query_json: &str) -> Result<(), Box<dyn Error>>;
    fn delete_saved_filter(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait TaskViewRepository {
    fn get_all_task_views(&self) -> Result<Vec<TaskView>, Box<dyn Error>>;
    fn save_task_view(&mut self, name: &str, query_json: &str, view_type: &str, group_by: &str, is_default: bool, sort_order: i64) -> Result<TaskView, Box<dyn Error>>;
    fn update_task_view(&mut self, id: &str, name: &str, query_json: &str, view_type: &str, group_by: &str) -> Result<(), Box<dyn Error>>;
    fn delete_task_view(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
    fn set_default_task_view(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
    fn ensure_default_task_view(&mut self) -> Result<(), Box<dyn Error>>;
}
```

- [ ] **Step 6: 验证编译**

```powershell
cd D:\comind\comind; cargo check 2>&1 | Select-Object -Last 10
```

---

## Task 3: Tauri Commands — 暴露 6 个新命令

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 在 `commands.rs` 添加 6 个命令**

```rust
#[tauri::command]
pub async fn get_block_cards(state: tauri::State<'_, AppState>) -> Result<Vec<BlockCard>, String> {
    state.adapter.get_blocks_projection().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_saved_filters(state: tauri::State<'_, AppState>) -> Result<Vec<SavedFilter>, String> {
    state.adapter.get_all_saved_filters().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_saved_filter(name: String, query_json: String, state: tauri::State<'_, AppState>) -> Result<SavedFilter, String> {
    state.adapter.save_saved_filter(&name, &query_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_task_views(state: tauri::State<'_, AppState>) -> Result<Vec<TaskView>, String> {
    state.adapter.ensure_default_task_view().map_err(|e| e.to_string())?;
    state.adapter.get_all_task_views().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_task_view(name: String, query_json: String, view_type: String, group_by: String, is_default: bool, sort_order: i64, state: tauri::State<'_, AppState>) -> Result<TaskView, String> {
    state.adapter.save_task_view(&name, &query_json, &view_type, &group_by, is_default, sort_order).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_task_view(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.adapter.delete_task_view(&id).map_err(|e| e.to_string())
}
```

> 注意：`AppState` 和 `adapter` 字段名需与现有代码一致（实现时核实）。import 需引入 `BlockCard`, `SavedFilter`, `TaskView` 类型。

- [ ] **Step 2: 在 `lib.rs` 的 `invoke_handler` 中注册**

在 `generate_handler!` 列表末尾（`auto_reconnect` 之后）添加：

```rust
commands::get_block_cards,
commands::get_saved_filters,
commands::save_saved_filter,
commands::get_task_views,
commands::save_task_view,
commands::delete_task_view,
```

- [ ] **Step 3: 验证编译**

```powershell
cd D:\comind\comind; cargo check 2>&1 | Select-Object -Last 10
```

---

## Task 4: 前端类型 + 筛选引擎纯函数 + 单测

**Files:**
- Create: `src/types/blockCard.ts`
- Create: `src/types/blockQuery.ts`
- Create: `src/composables/useBlockQuery.ts`
- Create: `src/composables/useBlockQuery.test.ts`

- [ ] **Step 1: 创建 `src/types/blockCard.ts`**

```ts
export interface DateRefLite {
  kind: string
  iso: string
  date_day: string
  recurrence: string
  event_ts: number
}

export interface BlockCard {
  block_id: string
  page_id: string
  parent_id: string
  content_preview: string
  properties: Record<string, unknown>
  date_refs: DateRefLite[]
  updated_at: number
}
```

- [ ] **Step 2: 创建 `src/types/blockQuery.ts`**

```ts
export type BlockField =
  | { kind: 'property'; key: string }
  | { kind: 'content' }
  | { kind: 'dateRef'; ref: 'kind' | 'date' }

export type FilterOp = 'is' | 'isNot' | 'before' | 'after' | 'contains' | 'hasAny' | 'isEmpty'

export interface FilterCondition {
  field: BlockField
  op: FilterOp
  value: unknown
}

export interface SortRule {
  field: BlockField
  dir: 'asc' | 'desc'
}

export type GroupBy = 'status' | 'priority' | 'project' | 'area' | 'dateRefDate' | null

export type ViewType = 'table' | 'board' | 'calendar'

export interface BlockQuery {
  filters: FilterCondition[]
  sort: SortRule[]
  groupBy: GroupBy
}

export interface SavedFilter {
  id: string
  name: string
  query: BlockQuery
}

export interface TaskView {
  id: string
  name: string
  query: BlockQuery
  viewType: ViewType
  groupBy: GroupBy
  isDefault: boolean
}
```

- [ ] **Step 3: 实现 `src/composables/useBlockQuery.ts`**

```ts
import type { BlockCard } from '../types/blockCard'
import type { BlockQuery, BlockField, FilterCondition } from '../types/blockQuery'

/** 纯函数：输入全部卡片 + 规则，输出筛选 + 排序后的数组 */
export function applyQuery(cards: BlockCard[], q: BlockQuery): BlockCard[] {
  let result = cards

  // 筛选（AND）
  if (q.filters.length > 0) {
    result = result.filter(card => q.filters.every(cond => matchCondition(card, cond)))
  }

  // 排序
  if (q.sort.length > 0) {
    result = [...result].sort((a, b) => {
      for (const rule of q.sort) {
        const cmp = compareField(a, b, rule.field)
        if (cmp !== 0) return rule.dir === 'desc' ? -cmp : cmp
      }
      return 0
    })
  } else {
    // 默认排序：updated_at desc
    result = [...result].sort((a, b) => b.updated_at - a.updated_at)
  }

  return result
}

function getFieldValue(card: BlockCard, field: BlockField): unknown {
  switch (field.kind) {
    case 'property':
      return card.properties[field.key]
    case 'content':
      return card.content_preview
    case 'dateRef':
      if (field.ref === 'kind') return card.date_refs.map(d => d.kind)
      return card.date_refs.map(d => d.date_day)
  }
}

function matchCondition(card: BlockCard, cond: FilterCondition): boolean {
  const val = getFieldValue(card, cond.field)

  switch (cond.op) {
    case 'is':
      return val === cond.value
    case 'isNot':
      return val !== cond.value
    case 'contains':
      if (typeof val === 'string') return val.toLowerCase().includes(String(cond.value).toLowerCase())
      return false
    case 'before':
      return compareDates(val, cond.value) < 0
    case 'after':
      return compareDates(val, cond.value) > 0
    case 'hasAny':
      if (cond.field.kind === 'property') return val !== undefined && val !== null
      if (cond.field.kind === 'content') return typeof val === 'string' && val.length > 0
      if (cond.field.kind === 'dateRef' && cond.field.ref === 'kind')
        return Array.isArray(val) && (cond.value ? val.includes(cond.value) : val.length > 0)
      return Array.isArray(val) && val.length > 0
    case 'isEmpty':
      if (cond.field.kind === 'property') return val === undefined || val === null
      if (cond.field.kind === 'content') return typeof val !== 'string' || val.length === 0
      return !Array.isArray(val) || val.length === 0
  }
}

function compareField(a: BlockCard, b: BlockCard, field: BlockField): number {
  const va = getFieldValue(a, field)
  const vb = getFieldValue(b, field)
  if (typeof va === 'number' && typeof vb === 'number') return va - vb
  return String(va ?? '').localeCompare(String(vb ?? ''))
}

function compareDates(val: unknown, target: unknown): number {
  const valStr = Array.isArray(val) ? val[0] : String(val ?? '')
  const targetStr = String(target ?? '')
  return valStr.localeCompare(targetStr)
}
```

- [ ] **Step 4: 编写单测 `useBlockQuery.test.ts`**

覆盖：
- 各 op（is/isNot/before/after/contains/hasAny/isEmpty）
- 多条件 AND
- 多排序规则
- 默认排序（无 sort 时 updated_at desc）
- 空筛选（返回全部）

- [ ] **Step 5: 运行测试**

```powershell
cd D:\comind\comind; npx vitest run src/composables/useBlockQuery.test.ts 2>&1 | Select-Object -Last 20
```

---

## Task 5: 前端 Store — blockCard / savedFilter / taskView

**Files:**
- Create: `src/stores/blockCard.ts`
- Create: `src/stores/savedFilter.ts`
- Create: `src/stores/taskView.ts`

- [ ] **Step 1: 实现 `blockCard.ts`**

核心功能：
- `cards: Ref<BlockCard[]>` — 缓存
- `isLoaded: Ref<boolean>` — 加载状态
- `dirtyIds: Set<string>` + `isFullyDirty: boolean` — 脏标记
- `load()` — 调用 `client.getBlockCards()` 全量加载
- `invalidate(blockId?: string)` — 标记脏
- `getCards()` — 获取卡片（检查脏标记，必要时重拉）
- 在 `blocks.ts` 的 `updateBlockContent`、`property.ts` 的 `setProperty`、date-ref 变更处调用 `invalidate`

- [ ] **Step 2: 实现 `savedFilter.ts`**

核心功能：
- `filters: Ref<SavedFilter[]>`
- `load()` — 调用 `client.getSavedFilters()`
- `create(name, query)` — 调用 `client.saveSavedFilter()`
- `update(id, name, query)` — 调用 `client.updateSavedFilter()`
- `remove(id)` — 调用 `client.deleteSavedFilter()`

- [ ] **Step 3: 实现 `taskView.ts`**

核心功能：
- `views: Ref<TaskView[]>`
- `currentView: Ref<TaskView | null>`
- `load()` — 调用 `client.getTaskViews()`（后端自动初始化默认视图）
- `switchView(id)` — 切换当前视图
- `create(name, query, viewType, groupBy)` — 调用 `client.saveTaskView()`
- `update(id, ...)` — 调用 `client.updateTaskView()`
- `remove(id)` — 调用 `client.deleteTaskView()`
- `setDefault(id)` — 调用 `client.setDefaultTaskView()`

- [ ] **Step 4: 在 `client.ts` 中添加对应方法**

在 `TauriClient` 中新增（参照现有 `getProperties`/`queryDateRefs` 模式）：
```ts
async getBlockCards(): Promise<BlockCard[]>
async getSavedFilters(): Promise<SavedFilter[]>
async saveSavedFilter(name: string, queryJson: string): Promise<SavedFilter>
async updateSavedFilter(id: string, name: string, queryJson: string): Promise<void>
async deleteSavedFilter(id: string): Promise<void>
async getTaskViews(): Promise<TaskView[]>
async saveTaskView(name: string, queryJson: string, viewType: string, groupBy: string, isDefault: boolean, sortOrder: number): Promise<TaskView>
async updateTaskView(id: string, name: string, queryJson: string, viewType: string, groupBy: string): Promise<void>
async deleteTaskView(id: string): Promise<void>
```

- [ ] **Step 5: 验证类型检查**

```powershell
cd D:\comind\comind; npx vue-tsc -b --noEmit 2>&1 | Select-String "error TS" | Select-Object -First 10
```

---

## Task 6: 视图层 — TaskHub + TaskViewBar + TaskFilterBar

**Files:**
- Create: `src/components/TaskHub/TaskHub.vue`
- Create: `src/components/TaskHub/TaskViewBar.vue`
- Create: `src/components/TaskHub/TaskFilterBar.vue`

- [ ] **Step 1: 实现 `TaskHub.vue`**

核心逻辑：
- `onMounted` → `blockCardStore.load()` + `taskViewStore.load()`
- `computed` → `applyQuery(cards, currentView.query)` 得到筛选后卡片
- 根据 `currentView.viewType` 渲染 `<TableView>` / `<BoardView>` / `<CalendarView>`
- 空态：cards 为空时显示「暂无任务」
- 加载态：`isLoaded` 为 false 时显示 loading
- 错误态：加载失败显示「重试」按钮

- [ ] **Step 2: 实现 `TaskViewBar.vue`**

- 视图切换按钮组：`[表格] [看板] [日历]` → 更新 `currentView.viewType`
- 命名视图下拉：列出 `taskViewStore.views`，切换 `currentView`
- 操作按钮：`[筛选]`（toggle TaskFilterBar）、`[存为新视图]`、`[设为默认]`、`[重命名]`、`[删除]`（默认视图隐藏删除）

- [ ] **Step 3: 实现 `TaskFilterBar.vue`**

- 条件列表：每行 = 字段下拉 + 操作符下拉 + 值输入 + 删除按钮
- 字段下拉选项：内置属性（status/priority/project/area）+ 用户自定义属性 key（从 cards 推导）+ `content` + `dateRef.kind` / `dateRef.date`
- 操作符按字段类型动态给出（如 dateRef.date 只给 before/after/isEmpty）
- 值输入：枚举字段用 select（读 `BUILT_IN_PROPERTIES.closedValues`）；日期用 `DateTimePickerPanel`；文本用 input
- `[添加条件]` 按钮、`[应用]` 按钮、`[另存为筛选规则]` 按钮

- [ ] **Step 4: 验证类型检查**

```powershell
cd D:\comind\comind; npx vue-tsc -b --noEmit 2>&1 | Select-String "error TS" | Select-Object -First 10
```

---

## Task 7: 视图层 — TableView + BoardView + CalendarView

**Files:**
- Create: `src/components/TaskHub/TableView.vue`
- Create: `src/components/TaskHub/BoardView.vue`
- Create: `src/components/TaskHub/CalendarView.vue`

- [ ] **Step 1: 实现 `TableView.vue`**

- 列：`☑` / 内容 / 状态 / 优先级 / 项目 / 截止(dateRef) / 页面
- 表头点击排序 → 更新 `currentView.query.sort`
- 行内改 status：checkbox 勾选 → `setProperty(blockId, 'status', 'Done')` → 触发 `advanceDateRefInBlock`（仅 recurrence != 'none'）
- 行内改 priority：select 下拉 → `setProperty`
- 点行 → 路由跳转到源 page 并滚动到 block

- [ ] **Step 2: 实现 `BoardView.vue`**

- 按 status 分 4 列：Todo / Doing / Done / Canceled
- 卡片显示：content_preview + priority badge + deadline date
- 拖拽：onDrop → `setProperty(blockId, 'status', targetColumnStatus)` → Done 列触发周期推进
- 拖到 Done 时如有 recurrence，显示 toast「已推进至下一周期」

- [ ] **Step 3: 实现 `CalendarView.vue`**

- 月格视图（当月，可切换月份）
- 事件按 `date_refs[].date_day` 落格
- deadline 用红色标记（`var(--color-deadline)` / `#DC2626`），schedule 用蓝色（`var(--color-schedule)` / `#0EA5E9`）
- 点事件 → 跳转源 block

- [ ] **Step 4: 验证类型检查 + 构建**

```powershell
cd D:\comind\comind; npx vue-tsc -b --noEmit 2>&1 | Select-String "error TS" | Select-Object -First 10
```

---

## Task 8: 入口与导航 — 路由 + 侧栏 + 命令面板

**Files:**
- Modify: `src/router/routes.ts`
- Modify: `src/components/Sidebar/SidebarContainer.vue`

- [ ] **Step 1: 在 `routes.ts` 新增 /tasks 路由**

在 `routes` 数组中（`/trash` 之后）添加：
```ts
{
  path: '/tasks',
  name: 'tasks',
  component: () => import('../components/TaskHub/TaskHub.vue'),
  meta: { fullWidth: true, hideRightSidebarToggle: true },
},
```

- [ ] **Step 2: 在侧栏新增「✅ 任务」项**

在 `SidebarContainer.vue` 的 `<SidebarGraphItem />` 之后添加 `<SidebarTaskItem />`，或直接在 sidebar-content 中添加：

```vue
<RouterLink to="/tasks" class="sidebar-item task-entry">
  <Icon name="icon-check-square" :size="16" />
  <span>任务</span>
</RouterLink>
```

样式参照现有 `SidebarGraphItem`。

- [ ] **Step 3: 验证路由可访问**

```powershell
cd D:\comind\comind; npx vite build 2>&1 | Select-Object -Last 5
```

---

## Task 9: 集成测试与打磨

**Files:**
- Various test files

- [ ] **Step 1: 缓存失效集成验证**

在 `blocks.ts` 的 `updateBlockContent` 末尾添加 `blockCardStore?.invalidate(blockId)`（注意循环依赖，用 lazy import 或可选链）。
在 `property.ts` 的 `setProperty` 末尾同理。

- [ ] **Step 2: 组件测试**

为 `TableView` 和 `BoardView` 编写组件测试：
- 渲染筛选后的卡片
- 表头排序
- 拖拽改 status
- 勾选触发周期推进

- [ ] **Step 3: 持久化测试**

为 `savedFilter` 和 `taskView` store 编写 CRUD 测试 + 损坏回退测试。

- [ ] **Step 4: 端到端验证**

```powershell
cd D:\comind\comind; npx vitest run 2>&1 | Select-String "passed|failed" | Select-Object -Last 3
```

- [ ] **Step 5: 视觉打磨**

- 空态图标和文案
- 加载态骨架屏
- 错误态重试按钮
- 看板拖拽视觉反馈
- 日历配色与现有 token 一致

---

## 依赖关系

```
Task 1 (Rust 类型) ──→ Task 2 (SQLite CRUD) ──→ Task 3 (Tauri commands)
                                                        ↓
Task 4 (类型+引擎+单测) ──→ Task 5 (前端 Store) ──→ Task 6 (容器+工具栏)
                                                        ↓
                                                  Task 7 (三视图)
                                                        ↓
                                                  Task 8 (入口导航)
                                                        ↓
                                                  Task 9 (集成测试)
```

- Task 1→2→3 必须串行（Rust 编译依赖）
- Task 4 可与 Task 2/3 并行（纯前端，无 Rust 依赖）
- Task 5 依赖 Task 3+4（需要 client 方法和类型）
- Task 6→7→8→9 串行

> 每个 Task 完成后运行 `cargo check` / `vue-tsc` / `vitest` 验证，确保不破坏现有代码。
