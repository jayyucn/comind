# IdeasTodayPanel 未完成任务功能设计文档

> 日期：2026-08-07
> 状态：已确认，待实现

---

## 1. 目标

在 `IdeasTodayPanel.vue` 底部新增「任务」区域，展示所有历史 ideas 页面中未完成的任务 block（status 为 Todo/Doing），支持就地编辑和跳转到来源页面。

---

## 2. 任务定义

**B+C 并集**：所有 `status` property 为 `Todo` 或 `Doing` 的 block，无论是否有 DateRef。如果 block content 中包含 `schedule`（`@ISO 📅`）或 `deadline`（`@ISO ⏰`），则额外展示日期信息。

- 不限制于有 DateRef 的 block
- DateRef 信息从 block content 文本中解析，不依赖 DateRef 表查询

---

## 3. 数据来源

### 3.1 查询方式

直接查 Property 表中 `key='status'` 且 `value IN ('Todo','Doing')` 的记录，JOIN block 表和 page 表获取完整数据。

### 3.2 查询范围

只查 `page.type = 'ideas'` 的 block。数据层不限制 normal page 能否有 task，只在查询场景做过滤。

### 3.3 Rust 端命令

新增命令 `query_incomplete_tasks`：

```rust
#[tauri::command]
fn query_incomplete_tasks() -> Result<Vec<IncompleteTask>, String>
```

- status 值在 Rust 端硬编码为 `['Todo', 'Doing']`，不接受前端传参
- 不返回 DateRef 信息（前端从 block content 解析）

### 3.4 返回结构

```rust
#[derive(Serialize)]
struct IncompleteTask {
    // block 字段
    id: String,
    page_id: String,
    parent_id: Option<String>,
    pos: f64,
    content: String,
    format: String,
    r#type: String,
    created_at: i64,
    updated_at: i64,
    // 关联的 page 信息
    page_title: String,
    page_type: String,
}
```

前端一次调用拿到完整 block 数据 + page_title，直接渲染。

---

## 4. 展示位置

放在 `IdeasTodayPanel.vue` 内部、今日 block 列表的下方。不侵入 `IdeasHistoryList` 的按月加载逻辑，不新增第三个面板。

---

## 5. 排序规则

**deadline 优先级排序 + status 次要排序**：

1. Overdue deadline（已过期截止日期）— 最优先
2. 未到期 deadline
3. 有 schedule（计划日期）
4. 无 DateRef
5. 同组内 Doing > Todo

前端拿到 block 数据后，对每个 block 调用 `parseDateRefs(block.content)` 提取 schedule/deadline 信息进行排序。

---

## 6. 组件设计

### 6.1 组件清单

| 文件 | 类型 | 职责 |
|------|------|------|
| `src/components/Ideas/BlockTaskList.vue` | 新建 | 任务列表容器：数据加载、排序、空状态、滚动 |
| `src/components/Ideas/BlockTaskItem.vue` | 新建 | 单个任务 block 渲染+编辑，从 `Block/index.vue` 借鉴结构但去掉树耦合 |
| `src/components/Ideas/IdeasTodayPanel.vue` | 修改 | 底部嵌入 `BlockTaskList` |

### 6.2 BlockTaskList.vue

- 调用 `queryIncompleteTasks()` 获取任务列表
- 使用 `parseDateRefs(content)` 解析日期，按排序规则排序
- 标题栏：「任务」
- 空状态：隐藏整个区域
- 不截断，`max-height` + `overflow-y: auto` 滚动

### 6.3 BlockTaskItem.vue

**复用的逻辑（从 Block/index.vue 借鉴）：**

- `useBlockPropertySync` — 读取 status/priority
- `useBlockEditorLifecycle` — 编辑能力（拦截 split/indent/outdent/delete）
- handler 的 `editorComponent` / `renderComponent` — 渲染+编辑
- `PropertyInline` — status 图标（between-bullet-content 位置）
- `PropertyDisplay` — 属性展示

**不包含：**

- `BlockChildren`、`useBlockDragDrop`、`useBlockCollapse`
- `depth` prop、`node: TreeNode` prop
- `onDragEnd` inject、`crossBlockSelection` inject

**bullet 位置：** 复用 `PropertyInline position="between-bullet-content"`，自动渲染 Todo/Doing 图标，点击可切换状态。

---

## 7. 编辑能力

### 7.1 支持的操作

| 操作 | 支持 | 说明 |
|------|------|------|
| 修改 block content | ✅ | 文本编辑，通过 `blockStore.updateBlockContent(blockId, content)` |
| 标记 Done / Canceled | ✅ | 通过 `propertyStore.setProperty(blockId, 'status', ...)` |
| 改 schedule / deadline 日期 | ✅ | 通过 `useDateTimePickerPanel` 或直接改 content 中的 `@ISO` 语法 |
| 新增子 block | ❌ | 不支持，任务列表是消费视图不是编辑视图 |
| Backspace 删除 block | ❌ | 不支持，删除 block 需回到来源页面操作 |

### 7.2 Backspace 行为

| 操作 | 行为 |
|------|------|
| content 非空时 Backspace | 正常删字符 |
| content 为空 + 有 status → Backspace | 清除 status（block 从任务列表消失，但仍存在于来源页面） |
| content 为空 + 无 status → Backspace | 无操作（不删除 block） |

---

## 8. 跳转行为

点击任务的**标题/日期标签**可跳转到右侧 `IdeasHistoryList` 中对应的来源 ideas 页面。

### 8.1 通信方案：Props/Emit

`IdeasList.vue` 作为 `IdeasTodayPanel`（含 `BlockTaskList`）和 `IdeasHistoryList` 的共同父组件，通过 props/emit 中转跳转信号。

**数据流：**

```
BlockTaskItem 点击标题/日期标签
  → BlockTaskList emit('navigate', pageId, pageTitle)
  → IdeasTodayPanel 透传 emit('navigate', pageId, pageTitle)
  → IdeasList.vue 接收，设置 targetPageId ref
  → 作为 prop 传给 IdeasHistoryList
  → IdeasHistoryList watch(targetPageId) → 切换月份 + scrollIntoView
```

**具体改动：**

| 组件 | 改动 |
|------|------|
| `BlockTaskList.vue` | emit `navigate(pageId: string, pageTitle: string)` |
| `IdeasTodayPanel.vue` | 透传 `navigate` emit（`BlockTaskList` → `IdeasList`） |
| `IdeasList.vue` | 新增 `targetPageId` ref + `handleTaskNavigate(pageId, pageTitle)` 事件处理函数 |
| `IdeasHistoryList.vue` | 新增 `targetPageId` prop + watch：从 pageTitle 解析月份，若与当前月份不同则调 `handleMonthChange`，`nextTick` 后 `scrollIntoView` |

**优点：**
- 不引入新 store / 新全局状态
- `IdeasHistoryList` 只需新增 1 个 prop + 1 个 watch，不重构现有 `selectedMonth` 逻辑
- 数据流显式可追踪（父→子）

---

## 9. 需要新增/修改的文件清单

### Rust 端

| 文件 | 操作 | 说明 |
|------|------|------|
| `comind-core/src/commands.rs` | 修改 | 新增 `query_incomplete_tasks` 命令 |
| `comind-core/src/services/` 或 `repositories/` | 修改 | 新增查询逻辑：JOIN property + block + page，过滤 `page.type='ideas'` + `property.key='status'` + `property.value IN ('Todo','Doing')` |

### 前端

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/wasm/types.ts` | 修改 | 新增 `IncompleteTask` 类型 |
| `src/wasm/tauri-client.ts` | 修改 | 新增 `tauriQueryIncompleteTasks()` |
| `src/wasm/client.ts` | 修改 | CoreClient 接口 + TauriClient 实现 |
| `src/components/Ideas/BlockTaskList.vue` | 新建 | 任务列表容器 |
| `src/components/Ideas/BlockTaskItem.vue` | 新建 | 单个任务 block 渲染+编辑 |
| `src/components/Ideas/IdeasTodayPanel.vue` | 修改 | 底部嵌入 `BlockTaskList`，透传 `navigate` emit 给 `IdeasList` |
| `src/components/Ideas/IdeasList.vue` | 修改 | 新增 `targetPageId` ref + `handleTaskNavigate` 事件处理函数，传 prop 给 `IdeasHistoryList` |
| `src/components/Ideas/IdeasHistoryList.vue` | 修改 | 新增 `targetPageId` prop + watch，支持外部驱动月份切换 + 滚动定位 |

---

## 10. 设计决策记录

| 决策项 | 结论 | 决策理由 |
|--------|------|----------|
| 任务定义 | B+C 并集 | 所有未完成任务，如有 DateRef 则额外展示日期 |
| 数据来源 | 查 Property 表 | 直接查 status=Todo/Doing，Rust 端硬编码 |
| 查询范围 | 只查 ideas page | normal page 允许有 task 但不在本功能展示 |
| Rust 返回 | 完整 block + page_title | 一次调用拿全数据，前端直接渲染 |
| 不返回 DateRef | 前端从 content 解析 | `parseDateRefs(block.content)` 已能满足排序需求 |
| 展示位置 | IdeasTodayPanel 底部 | 语义上是"今天需要关注的"，和历史列表分离 |
| 排序 | deadline 优先 + status 次要 | 过期任务最优先，Doing 优先于 Todo |
| 新建 BlockTaskItem | 不复用 Block/index.vue | 树耦合过深，拆分成本 > 新建成本 |
| 不支持新增子 block | 任务列表是消费视图 | 新建 block 应回来源页面操作 |
| 不支持删除 block | 跨页面删除是高危操作 | 用户可能意识不到 block 归属 |
| Backspace 清除 status | 保留 | 属于任务管理操作，清除后 block 自然从列表消失 |
| 跳转行为 | 点击标题/日期标签跳转 | 就地编辑满足大部分需求，跳转作为补充 |
| 通信方案 | Props/Emit（IdeasList 中转） | 不引入新 store，数据流显式，改动量最小 |
| normal page 可有 task | 数据层不限制 | block 是一等公民，属性不应被容器类型限制 |
