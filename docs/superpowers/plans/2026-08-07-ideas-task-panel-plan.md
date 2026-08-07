# 实现计划：IdeasTodayPanel 未完成任务功能

> 关联 spec: `docs/superpowers/specs/2026-08-07-ideas-task-panel-design.md`

---

## Task 1: Rust 端 — 新增 `query_incomplete_tasks` 命令

### 1.1 PropertyRepository 新增 `query_blocks_by_key_value` 方法

**文件**: `crates/comind-core/src/storage/repository.rs`

在 `PropertyRepository` trait 新增方法：

```rust
/// 查询 key=value 的所有 block_id（用于反查未完成任务）
fn query_block_ids_by_key_value(&self, key: &str, values: &[String]) -> Result<Vec<String>, Box<dyn Error>>;
```

### 1.2 SQLite 实现

**文件**: `crates/comind-core/src/storage/sqlite.rs`

在 `impl PropertyRepository for SqlitePropertyRepository` 中新增：

```rust
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
    let params: Vec<Box<dyn rusqlite::ToSql>> = std::iter::once(Box::new(key) as Box<dyn rusqlite::ToSql>)
        .chain(values.iter().map(|v| Box::new(v.clone()) as Box<dyn rusqlite::ToSql>))
        .collect();
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let ids = stmt.query_map(param_refs.as_slice(), |row| {
        row.get::<_, String>(0)
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(ids)
}
```

### 1.3 SqlJs 实现

**文件**: `crates/comind-core/src/storage/sqljs.rs`

同步实现 `query_block_ids_by_key_value`（逻辑相同，API 适配 sql.js）。

### 1.4 IncompleteTask 类型

**文件**: `crates/comind-core/src/types/block.rs` 或 `lib.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncompleteTask {
    pub id: String,
    pub page_id: String,
    pub parent_id: Option<String>,
    pub pos: f64,
    pub content: String,
    pub r#format: String,
    pub r#type: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub page_title: String,
    pub page_type: String,
}
```

确保在 `types/mod.rs` 或 `lib.rs` 中 re-export。

### 1.5 PropertyService 新增查询方法

**文件**: `crates/comind-core/src/services/property_service.rs`

```rust
pub fn query_block_ids_by_status(
    storage: &mut dyn StorageAdapter,
    key: &str,
    values: &[String],
) -> Result<Vec<String>, Box<dyn Error>> {
    storage.properties().query_block_ids_by_key_value(key, values)
}
```

### 1.6 新增 `query_incomplete_tasks` 命令

**文件**: `src-tauri/src/commands.rs`

```rust
#[tauri::command]
pub async fn query_incomplete_tasks(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<Vec<IncompleteTask>, String> {
    execute_with_adapter(db, |storage| {
        // 1. 查 status=Todo/Doing 的 block_ids
        let block_ids = PropertyService::query_block_ids_by_status(
            storage, "status", &["Todo".to_string(), "Doing".to_string()],
        )?;
        if block_ids.is_empty() {
            return Ok(Vec::new());
        }
        // 2. 批量获取 block
        let blocks = storage.blocks().get_by_ids(&block_ids)?;
        // 3. 过滤 page.type='ideas'，收集 page_id
        let page_ids: Vec<String> = blocks.iter().map(|b| b.page_id.clone()).collect();
        let pages = storage.pages().get_by_ids(&page_ids)?;
        let page_map: std::collections::HashMap<String, &Page> = pages.iter().map(|p| (p.id.clone(), p)).collect();
        // 4. 组装 IncompleteTask
        let tasks: Vec<IncompleteTask> = blocks.iter()
            .filter_map(|b| {
                let page = page_map.get(&b.page_id)?;
                if page.r#type != "ideas" { return None; }
                Some(IncompleteTask {
                    id: b.id.clone(),
                    page_id: b.page_id.clone(),
                    parent_id: b.parent_id.clone(),
                    pos: b.pos,
                    content: b.content.clone(),
                    r#format: b.format.clone(),
                    r#type: b.r#type.clone(),
                    created_at: b.created_at,
                    updated_at: b.updated_at,
                    page_title: page.title.clone(),
                    page_type: page.r#type.clone(),
                })
            })
            .collect();
        Ok(tasks)
    }).await
}
```

### 1.7 注册命令

**文件**: `src-tauri/src/lib.rs`

在 `invoke_handler!` 中添加 `commands::query_incomplete_tasks`。

### 验证

```bash
cd D:\comind\comind && cargo check
```

---

## Task 2: 前端 — 类型 & 客户端

### 2.1 新增 `IncompleteTask` 类型

**文件**: `src/wasm/types.ts`

```typescript
export interface IncompleteTask {
  id: string
  page_id: string
  parent_id: string | null
  pos: number
  content: string
  format: string
  type: string
  created_at: number
  updated_at: number
  page_title: string
  page_type: string
}
```

### 2.2 新增 tauri-client 函数

**文件**: `src/wasm/tauri-client.ts`

```typescript
export async function tauriQueryIncompleteTasks(): Promise<IncompleteTask[]> {
  return invoke('query_incomplete_tasks')
}
```

### 2.3 CoreClient 接口 + TauriClient 实现

**文件**: `src/wasm/client.ts`

- 在 `CoreClient` interface 添加：`queryIncompleteTasks(): Promise<IncompleteTask[]>`
- 在 `TauriClient` class 添加实现
- 在 `WasmClient` class 添加 stub（返回空数组或抛错，视 WASM 支持情况）

### 验证

```bash
cd D:\comind\comind && npx vue-tsc --noEmit
```

---

## Task 3: 前端 — BlockTaskList.vue

**文件**: `src/components/Ideas/BlockTaskList.vue`（新建）

核心逻辑：
1. `onMounted` 调用 `client.queryIncompleteTasks()` 获取任务
2. 对每个 task 调用 `parseDateRefs(task.content)` 提取日期信息
3. 按排序规则排序：overdue deadline → 未到期 deadline → schedule → 无 DateRef → 同组 Doing > Todo
4. 空列表隐藏整个区域
5. emit `navigate(pageId, pageTitle)` 事件

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getClient } from '../../wasm/client'
import { parseDateRefs, formatIsoDisplay } from '../../utils/date-ref'
import { usePropertyStore } from '../../stores/property'
import type { IncompleteTask } from '../../wasm/types'
import BlockTaskItem from './BlockTaskItem.vue'

const emit = defineEmits<{
  navigate: [pageId: string, pageTitle: string]
}>()

const propertyStore = usePropertyStore()
const tasks = ref<IncompleteTask[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const client = getClient()
    tasks.value = await client.queryIncompleteTasks()
    // 预加载 property（status）用于排序
    await Promise.all(tasks.value.map(t => propertyStore.ensureProperties(t.id)))
  } catch (e) {
    console.error('[BlockTaskList] load failed:', e)
  } finally {
    loading.value = false
  }
})

// 排序
const sortedTasks = computed(() => {
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  
  return [...tasks.value].sort((a, b) => {
    const aRefs = parseDateRefs(a.content)
    const bRefs = parseDateRefs(b.content)
    const aDeadline = aRefs.find(r => r.kind === 'deadline')
    const bDeadline = bRefs.find(r => r.kind === 'deadline')
    const aSchedule = aRefs.find(r => r.kind === 'schedule')
    const bSchedule = bRefs.find(r => r.kind === 'schedule')
    
    // 1. Overdue deadline 最优先
    const aOverdue = aDeadline && aDeadline.iso < todayStr ? 1 : 0
    const bOverdue = bDeadline && bDeadline.iso < todayStr ? 1 : 0
    if (aOverdue !== bOverdue) return bOverdue - aOverdue
    
    // 2. 未到期 deadline
    if (aDeadline && !bDeadline) return -1
    if (!aDeadline && bDeadline) return 1
    if (aDeadline && bDeadline) return aDeadline.iso.localeCompare(bDeadline.iso)
    
    // 3. 有 schedule
    if (aSchedule && !bSchedule) return -1
    if (!aSchedule && bSchedule) return 1
    if (aSchedule && bSchedule) return aSchedule.iso.localeCompare(bSchedule.iso)
    
    // 4. 同组 Doing > Todo
    const aStatus = propertyStore.getBlockProperty(a.id, 'status')?.value || 'Todo'
    const bStatus = propertyStore.getBlockProperty(b.id, 'status')?.value || 'Todo'
    if (aStatus !== bStatus) return aStatus === 'Doing' ? -1 : 1
    
    // 5. 创建时间
    return a.created_at - b.created_at
  })
})

const isEmpty = computed(() => !loading.value && sortedTasks.value.length === 0)

function handleNavigate(pageId: string, pageTitle: string) {
  emit('navigate', pageId, pageTitle)
}
</script>

<template>
  <div v-if="!isEmpty" class="block-task-list">
    <div class="task-list-header">任务</div>
    <div class="task-list-body">
      <BlockTaskItem
        v-for="task in sortedTasks"
        :key="task.id"
        :task="task"
        @navigate="handleNavigate"
      />
    </div>
  </div>
</template>
```

### 验证

```bash
npx vue-tsc --noEmit
```

---

## Task 4: 前端 — BlockTaskItem.vue

**文件**: `src/components/Ideas/BlockTaskItem.vue`（新建）

核心逻辑：
- 渲染 block content（渲染态/编辑态切换）
- 复用 `useBlockPropertySync`、`useBlockEditorLifecycle`
- 复用 `PropertyInline`（status 图标）
- 点击标题/日期标签 → emit `navigate`
- Backspace 空内容时清除 status

借鉴 `Block/index.vue` 但去掉：TreeNode、depth、BlockChildren、拖拽、折叠、多选。

具体实现要点：
1. props: `task: IncompleteTask`
2. emits: `navigate: [pageId: string, pageTitle: string]`
3. 使用 `useBlockEditorLifecycle`，拦截：
   - `split` → 返回 false（不拆分）
   - `indent` / `outdent` → 返回 false（不缩进）
   - `delete` → Backspace 逻辑：空内容+有 status → 清除 status；否则不删除
4. 渲染：bullet + `PropertyInline` + content（render/edit 模式）
5. 点击 content 区域 → 进入编辑态
6. 点击 page_title 或日期标签 → emit navigate

---

## Task 5: 前端 — IdeasTodayPanel.vue 修改

**文件**: `src/components/Ideas/IdeasTodayPanel.vue`

改动：
1. import `BlockTaskList`
2. 模板中 `BlockList` 下方添加 `<BlockTaskList @navigate="..." />`
3. 新增 emit `navigate: [pageId: string, pageTitle: string]`，透传给 `IdeasList`

---

## Task 6: 前端 — IdeasList.vue + IdeasHistoryList.vue 跳转

### 6.1 IdeasList.vue

**文件**: `src/components/Ideas/IdeasList.vue`

改动：
1. 新增 `targetPageId` ref
2. 新增 `handleTaskNavigate(pageId, pageTitle)` 函数：设置 `targetPageId.value = pageId`
3. `<IdeasTodayPanel>` 添加 `@navigate="handleTaskNavigate"`
4. `<IdeasHistoryList>` 添加 `:target-page-id="targetPageId"` prop

### 6.2 IdeasHistoryList.vue

**文件**: `src/components/Ideas/IdeasHistoryList.vue`

改动：
1. 新增 prop: `targetPageId?: string`
2. 新增 watch `targetPageId`：
   - 从 page_title 解析月份（`yyyy-MM` 格式，取前 7 位）
   - 如果月份 ≠ `selectedMonth` → 调 `handleMonthChange(月份)`
   - `nextTick` 后 `scrollIntoView` 到对应 `IdeasHistoryItem`
3. IdeasHistoryItem 的 DOM 需要加 `:data-page-id="pageId"` 属性，便于 querySelector 定位

---

## Task 7: 集成测试 & 类型检查

```bash
# Rust 编译
cd D:\comind\comind && cargo check

# 前端类型检查
npx vue-tsc --noEmit

# 前端构建
npx vite build

# 运行已有测试
npx vitest run
```

---

## 执行顺序

```
Task 1 (Rust) → Task 2 (类型/client) → Task 3 (BlockTaskList) → Task 4 (BlockTaskItem) → Task 5 (IdeasTodayPanel) → Task 6 (跳转) → Task 7 (验证)
```

Task 3 和 Task 4 可以并行（Task 3 import Task 4 但可以先写骨架）。
