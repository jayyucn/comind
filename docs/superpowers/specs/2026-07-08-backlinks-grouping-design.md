# Backlinks 面板分组重构

## 概述

重构 `Backlinks.vue` 组件，将反链按来源页面分组展示。当页面 A 包含 n 个对页面 B 的引用时，在 B 的 Backlinks 面板中以"A 为标题、A 中引用 B 的块为内容"的分组形式展示，块渲染格式与正文非激活态一致。

## 现状与问题

当前 `Backlinks.vue`（[src/components/Backlinks.vue](file:///d:/comind/comind/src/components/Backlinks.vue)）以扁平列表展示反链，每条反链显示为一行纯文本：

- 每条反链独立一行，包含 `sourceContent`（纯文本）+ `sourcePageTitle`
- 同一来源页面的多条反链重复显示页面标题，信息冗余
- 块内容以 `{{ item.sourceContent }}` 纯文本展示，不渲染 markdown、不显示 bullet、不显示属性
- `loadMultiPageBlocks([currentId])` 只加载当前页 B 的块，源页 A 的块靠 `blocks.value` 跨页缓存命中，无显式加载保证

## 需求

1. 按来源页面 `sourcePageId` 分组展示反链
2. 每组标题显示 `[[A]] (count)`，位于该组左上角，count 为该页面引用 B 的**块数**（非 link 数）
3. 标题可点击，跳转到来源页面 A（`navigateToPage(A)`），不激活任何块
4. 标题下方展示该页面中所有引用 B 的 block，块渲染格式与正文非激活态一致
5. 块整体向右缩进 24px 以区分层级
6. 块可点击，跳转到来源页面 + 激活该块（保留现有 `handleBacklinkClick` 行为）

## 设计决策

### D1. 块渲染方式：复用 `handler.renderComponent`

不使用完整 `<Block>` 组件（避免引入拖拽、编辑激活、递归子块）。改为直接使用 `useBlockRegistry().getHandler(block.type).renderComponent`，传 `:readonly="true"`，与正文非激活态渲染路径一致（参考 [Block/index.vue:860-872](file:///d:/comind/comind/src/components/Block/index.vue#L860-L872)）。

### D2. 视觉元素：与正文非激活态完全对齐

每个反链块渲染以下元素，顺序与正文一致：

1. bullet 圆点（纯展示，不绑拖拽/折叠事件，无 chevron，始终显示圆点）
2. `PropertyInline`（position="between-bullet-content"）
3. `handler.renderComponent`（内容，readonly）
4. `PropertyInline`（position="right-of-content"）
5. `PropertyDisplay`（下方属区）

不保留源页深度缩进，统一 depth=0，所有反链块左对齐。

### D3. 不渲染子块

只渲染引用块本身，不递归渲染其子树。反链语义是"指出哪里引用了 B"，子块通常与 B 无关。

### D4. 分组排序：按页面标题字母序

多个来源页面之间按标题字母序（中文按 Unicode 序）排列。稳定可预测，便于用户定位。

### D5. 组内排序：文档顺序（pre-order DFS）

同一页面内的多个引用块，按其在源页面中的文档顺序（前序遍历）排列。实现：加载源页全部块 → 依据 `parentId`/`pos` 重建树 → 前序遍历得 blockId 顺序表 → 按此顺序排序组内块。与用户跳转到源页后的视觉顺序一致。

### D6. 去重：按 sourceBlockId

同一块内多次引用 B（如内容含多个 `[[B]]`）只显示一次。计数 `[[A]] (3)` 表示 3 个块，非 3 条 link。实现：分组时用 `Map<sourceBlockId, Block>` 去重，或在 `getBacklinks` 返回后按 `sourceBlockId` 去重。

### D7. orphan 跳过

源块已删除或源页已删除的反链条目不显示。删除链路已确认清理完整：

- 删块（[commands.rs:377-390](file:///d:/comind/comind/src-tauri/src/commands.rs#L377-L390)）：`links().delete_by_source_block_id` 清理该块作为源的所有 link
- 删页（[commands.rs:213-228](file:///d:/comind/comind/src-tauri/src/commands.rs#L213-L228)）：先删每个块的 properties + outlinks，再删指向该页的 backlinks，再删块，再删页

正常操作下 orphan 不会产生。保留跳过逻辑作为防御性处理。

### D8. Concept Block 纳入

Concept Block 作为普通块参与分组和排序，不做特殊处理。它在源页文档顺序中排第一（固定顶部），组内排序时自然排第一。

### D9. 缩进：24px

块容器 `padding-left: 24px`（= `INDENT_WIDTH_PER_LEVEL`，见 [Block/index.vue:156](file:///d:/comind/comind/src/components/Block/index.vue#L156)），与正文一级缩进对齐。

### D10. 折叠：仅面板级

保留现有面板级折叠（`collapsed` ref + maxHeight 动画），不增加每组独立折叠。

### D11. 点击行为与事件冒泡

| 点击目标 | 行为 |
|---------|------|
| 块内 wiki link（如 `[[C]]`） | 导航到 C，`stopPropagation` 阻止冒泡 |
| 块其他区域（bullet / 纯文本 / PropertyInline） | 触发 `handleBacklinkClick`：`navigateToPage(sourcePage)` + `activateBlock(sourceBlockId)` |
| PropertyDisplay | `stopPropagation`，不触发反链跳转 |
| 组标题 `[[A]] (count)` | `navigateToPage(A)`，不激活块 |

实现：外层块容器 `@click="handleBacklinkClick"`；renderComponent 内部 wiki link 的点击由其自身处理并 `stopPropagation`（需确认 renderComponent 是否已 stopPropagation，若无则在外层包一层 `@click.stop`）；PropertyDisplay 区域加 `@click.stop`。

## 架构

### 组件结构

```
Backlinks.vue（重构）
  │
  ├─ <backlinks-panel>（面板容器，v-if="hasBacklinks"）
  │   ├─ <backlinks-header>（面板级标题，点击切换折叠，保持现状）
  │   └─ <backlinks-body>（maxHeight 动画容器，保持现状）
  │       └─ <backlink-group v-for group>（新增：每组）
  │           ├─ <backlink-group-header>（新增：[[A]] (count)，点击跳转 A）
  │           └─ <backlink-block-list>（新增：块列表，padding-left: 24px）
  │               └─ <backlink-block v-for block>（新增：单个反链块）
  │                   ├─ bullet 圆点
  │                   ├─ PropertyInline (between-bullet-content)
  │                   ├─ <component :is="handler.renderComponent" :readonly="true" />
  │                   ├─ PropertyInline (right-of-content)
  │                   └─ PropertyDisplay（@click.stop）
  │
  └─ 逻辑
      ├─ loadBacklinks()（重构：加载所有源页块 + 分组 + 排序 + 去重）
      ├─ groupedBacklinks（computed：Map<sourcePageId, BacklinkItem[]>）
      └─ handleBacklinkClick(link)（保留）/ handleGroupClick(pageId)（新增）
```

### 数据流

> **关键问题**：Link 结构（[crates/comind-core/src/types/link.rs:5-13](file:///d:/comind/comind/crates/comind-core/src/types/link.rs#L5-L13)）只含 `source_block_id` + `target_page_id`，**不含 `source_page_id`**。`getBacklinks` 的 SQL（[sqlite.rs:512-530](file:///d:/comind/comind/crates/comind-core/src/storage/sqlite.rs#L512-L530)）也不 JOIN Block 表。当前代码靠 `blocks.value` 跨页缓存命中源块——若用户从未访问过源页，`getBlock` 返回 undefined，反链会被误判为 orphan。新方案必须显式加载源块。

```
targetPageId 变化
  │
  └─► loadBacklinks()
        │
        ├─ 1. blockStore.loadMultiPageBlocks([currentId])
        │     先加载当前页块（保留现有行为，确保 B 页块在缓存）
        │
        ├─ 2. blockStore.getBacklinks(currentId)
        │     拿到所有指向 B 的 links（含 sourceBlockId，不含 sourcePageId）
        │
        ├─ 3. 解析 sourcePageId（两步）：
        │     a. 对每个 link.sourceBlockId，调用 blockStore.loadBlock(id)
        │        （新增方法：缓存命中直接返回，未命中调用 client.getBlock 加载并合并进缓存）
        │     b. 从返回的 block.pageId 收集所有 sourcePageId 集合
        │     ⚠️ 此步骤修复了现有代码的潜在 orphan 误判 bug
        │
        ├─ 4. blockStore.loadMultiPageBlocks(allSourcePageIds)
        │     显式加载所有源页的完整块树，确保文档顺序排序有完整树数据
        │
        ├─ 5. 去重：按 sourceBlockId 去重（Map<sourceBlockId, Block>）
        │
        ├─ 6. 过滤 orphan：跳过 blockExists=false 或 pageExists=false 的条目
        │
        ├─ 7. 按 sourcePageId 分组
        │
        ├─ 8. 组内排序：对每个组，按源页文档顺序（pre-order DFS）排序块
        │     重建源页树 → 前序遍历 → 按 blockId 在顺序表中的 index 排序
        │
        ├─ 9. 组间排序：按页面标题字母序
        │
        └─ 10. 写入 groupedBacklinks（ref）
              │
              └─► 模板渲染分组 + 块
                    │
                    └─► 每个块 onMounted → propertyStore.loadBlockProperties(blockId)
```

**性能说明**：步骤 3b 对每个缓存未命中的 sourceBlockId 发一次 `get_block` 调用（N 次）。典型反链数在十几个以内，可接受。若后续反链量大，可考虑扩展 Rust 端 `get_backlinks` 加 JOIN Block 返回 sourcePageId，消除 N+1 查询——但不在本次范围内。

### 职责边界

| 单元 | 职责 |
|------|------|
| `Backlinks.vue` | 反链面板整体：加载、分组、排序、渲染、折叠 |
| `blockStore` | 提供 `loadMultiPageBlocks`、`getBlock`、`getBacklinks`（已有）；**新增 `loadBlock(blockId)`**：按 ID 加载单个块并合并进 `blocks.value` 缓存（用于反链场景解析 sourcePageId） |
| `pageStore` | 提供 `getPage`（已有，不改） |
| `propertyStore` | 提供 `loadBlockProperties`、`getBlockProperty`（已有，不改） |
| `useBlockRegistry` | 提供 `getHandler(block.type)` 获取 renderComponent（已有，不改） |
| `useNavigateToPage` | 提供 `navigateToPage`（已有，不改） |

### blockStore.loadBlock 新增方法

```typescript
/** 按 ID 加载单个 Block 并合并进缓存（若已存在则直接返回缓存） */
async function loadBlock(blockId: string): Promise<Block | undefined> {
  const existing = blocks.value.find(b => b.id === blockId)
  if (existing) return existing
  const client = await getClient()
  try {
    const rustBlock = await client.getBlock(blockId)
    const block: Block = {
      id: rustBlock.id,
      pageId: rustBlock.page_id,
      parentId: rustBlock.parent_id,
      pos: rustBlock.pos,
      content: rustBlock.content,
      format: JSON.parse(rustBlock.format || '{}'),
      type: rustBlock.type as Block['type'],
      properties: {},
      createdAt: rustBlock.created_at,
      updatedAt: rustBlock.updated_at
    }
    blocks.value.push(block)
    return block
  } catch (err) {
    console.error('[loadBlock] Failed:', err)
    return undefined
  }
}
```

理由：Link 结构不含 `sourcePageId`，需通过 block 查 pageId。`loadMultiPageBlocks` 按 pageId 加载，但此处恰恰需要先拿到 pageId——鸡生蛋问题。`loadBlock` 按 blockId 加载，绕过该循环。`client.getBlock`（[src/wasm/client.ts:60](file:///d:/comind/comind/src/wasm/client.ts#L60)）已存在，调用 Rust `get_block` 命令（[commands.rs:41-46](file:///d:/comind/comind/src-tauri/src/commands.rs#L41-L46)）。

## 关键实现细节

### 组内文档顺序排序

```typescript
// 重建源页树并前序遍历，返回 blockId -> orderIndex 映射
function buildDocumentOrder(blocks: Block[]): Map<string, number> {
  const childrenMap = new Map<string | null, Block[]>()
  for (const b of blocks) {
    const parent = b.parentId ?? null
    if (!childrenMap.has(parent)) childrenMap.set(parent, [])
    childrenMap.get(parent)!.push(b)
  }
  // 每层按 pos 排序
  for (const siblings of childrenMap.values()) {
    siblings.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
  }
  const order = new Map<string, number>()
  let index = 0
  function dfs(parentId: string | null) {
    const children = childrenMap.get(parentId) ?? []
    for (const child of children) {
      order.set(child.id, index++)
      dfs(child.id)
    }
  }
  dfs(null)
  return order
}
```

### 分组数据结构

```typescript
interface BacklinkGroup {
  sourcePageId: string
  sourcePageTitle: string
  items: BacklinkItem[]  // 已按文档顺序排序
}

interface BacklinkItem {
  link: Link
  block: Block           // 完整 Block 记录（供 renderComponent 使用）
}
```

### 块渲染模板（关键部分）

```vue
<div
  v-for="item in group.items"
  :key="item.link.sourceBlockId"
  class="backlink-block"
  @click="handleBacklinkClick(item.link)"
>
  <span class="block-bullet"><span class="bullet-dot"></span></span>
  <PropertyInline :block-id="item.link.sourceBlockId" position="between-bullet-content" />
  <component
    v-if="getHandler(item.block.type)"
    :is="getHandler(item.block.type)!.renderComponent"
    :block-id="item.link.sourceBlockId"
    :content="item.block.content"
    :properties="getBlockPropertiesMap(item.link.sourceBlockId)"
    :language="getBlockProperty(item.link.sourceBlockId, 'language')"
    :readonly="true"
    @content-click.stop
  />
  <PropertyInline :block-id="item.link.sourceBlockId" position="right-of-content" />
  <div class="block-properties" @click.stop>
    <PropertyDisplay :block-id="item.link.sourceBlockId" />
  </div>
</div>
```

## 不变项

- 空面板行为：`v-if="hasBacklinks"`，无反链时整个面板不显示
- 加载态：面板内 "加载中..." 文案
- 面板级折叠动画：现有 maxHeight 逻辑保留
- 面板固定在页面底部、宽度 `var(--max-width)`、`flex-shrink: 0`

## 测试要点

1. **分组正确性**：页面 A 有 3 个块引用 B，B 的反链面板应显示一组，标题 `[[A]] (3)`，组内 3 个块按文档顺序排列
2. **去重**：一个块内含两个 `[[B]]`，只显示一次，计数为 1
3. **跨页加载（orphan 误判修复）**：从未访问过的页面 C 引用 B（C 的块不在缓存中），打开 B 时反链面板能通过 `loadBlock` 正确加载 C 的块并渲染，**不误判为 orphan**
4. **点击跳转**：点击块 → 跳转到源页 + 激活块；点击标题 → 跳转到源页不激活块
5. **事件冒泡**：块内 `[[C]]` 点击只导航到 C，不触发反链跳转
6. **orphan 跳过**：手动删除 link 的 source block（模拟数据不一致），该条目不显示
7. **Concept Block**：源页 Concept Block 引用 B，应作为第一条显示在组内
8. **blockStore.loadBlock**：缓存命中时直接返回不重复请求；缓存未命中时调用 `client.getBlock` 并合并进 `blocks.value`
9. **编译检查**：`npm run build` 通过（TypeScript 类型检查 + Vite 构建）
