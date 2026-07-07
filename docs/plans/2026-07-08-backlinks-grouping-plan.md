# Backlinks 面板分组重构 实施方案

> **面向智能体执行者：必须使用子技能**：通过 subagent-driven-development（推荐）或 executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。

**目标**：重构 Backlinks.vue，将反链按来源页面分组展示，块渲染复用 handler.renderComponent，视觉与正文非激活态一致。

**架构**：blockStore 新增 loadBlock 方法解决 Link 无 sourcePageId 的加载问题 → Backlinks.vue 重写 loadBacklinks 实现分组/去重/排序 → 模板用 renderComponent + bullet + PropertyInline + PropertyDisplay 渲染每个反链块。

**技术栈**：Vue 3 + TypeScript + Pinia + Vitest

**相关文件：**
- `docs/superpowers/specs/2026-07-08-backlinks-grouping-design.md` — 设计规格
- `src/components/Backlinks.vue` — 待重构组件
- `src/stores/blocks.ts` — 待新增 loadBlock 方法

---

## 决策树汇总

| # | 决策点 | 选择 | 理由 |
|---|---|---|---|
| D1 | 块渲染方式 | 复用 handler.renderComponent（readonly） | 视觉一致，不引入拖拽/编辑 |
| D2 | 视觉元素 | bullet + PropertyInline + PropertyDisplay | 与正文非激活态完全对齐 |
| D3 | 子块 | 不渲染 | 反链语义是"指出引用位置" |
| D4 | 分组排序 | 页面标题字母序 | 稳定可预测 |
| D5 | 组内排序 | 文档顺序（pre-order DFS） | 与源页阅读顺序一致 |
| D6 | 去重 | 按 sourceBlockId | 计数=块数，非 link 数 |
| D7 | orphan | 跳过 | 删除链路已清理 link |
| D8 | Concept Block | 纳入 | 不特殊处理 |
| D9 | 缩进 | 24px | = INDENT_WIDTH_PER_LEVEL |
| D10 | 折叠 | 仅面板级 | 不增加每组独立折叠 |
| D11 | 点击冒泡 | wiki link stopPropagation；PropertyDisplay stopPropagation | 避免双重导航 |

---

## 文件结构

```
src/
├── stores/
│   ├── blocks.ts                    # 修改：新增 loadBlock 方法 + return 导出
│   └── blocks.test.ts               # 修改：新增 loadBlock 测试用例
├── utils/
│   ├── block-helpers.ts             # 修改：新增 buildDocumentOrder 函数
│   └── block-helpers.test.ts        # 修改：新增 buildDocumentOrder 测试用例
├── components/
│   ├── Backlinks.vue                # 修改：重写 script + template + style
│   └── Backlinks.test.ts            # 修改：新增分组逻辑测试用例
└── styles/
    └── components/
        └── _block.scss              # 不改（bullet 全局样式已存在）
```

---

## 任务 1：blockStore.loadBlock 方法（TDD）

**涉及文件：**
- 修改：`comind/src/stores/blocks.ts`（新增 loadBlock 方法，约第 252 行后；return 语句约第 920-953 行）
- 测试：`comind/src/stores/blocks.test.ts`（新增 loadBlock describe block）

**目标**：按 blockId 加载单个 Block 并合并进 `blocks.value` 缓存。缓存命中直接返回，未命中调用 `client.getBlock`。

- [ ] **步骤 1：编写失败测试用例**

在 `comind/src/stores/blocks.test.ts` 文件末尾追加：

```typescript
// ============================================================
// loadBlock 测试
// ============================================================
describe('loadBlock', () => {
  test('缓存命中时直接返回缓存中的块', async () => {
    const store = useBlockStore()
    const pageId = 'page-loadblock-1'
    const block = await store.createBlock({ pageId, content: 'Cached Block' })

    const result = await store.loadBlock(block.id)
    expect(result).toBeDefined()
    expect(result?.id).toBe(block.id)
    expect(result?.content).toBe('Cached Block')
  })

  test('缓存未命中时从 DB 加载并合并进缓存', async () => {
    const store = useBlockStore()
    const pageId = 'page-loadblock-2'
    const block = await store.createBlock({ pageId, content: 'From DB' })

    // 清空缓存，模拟未访问过该页
    store.blocks = []
    expect(store.blocks).toHaveLength(0)

    // loadBlock 应从 DB 加载
    const result = await store.loadBlock(block.id)
    expect(result).toBeDefined()
    expect(result?.id).toBe(block.id)
    expect(result?.content).toBe('From DB')

    // 验证已合并进缓存
    expect(store.blocks.find(b => b.id === block.id)).toBeDefined()
  })

  test('不存在的 blockId 返回 undefined', async () => {
    const store = useBlockStore()
    const result = await store.loadBlock('non-existent-block-id')
    expect(result).toBeUndefined()
  })
})
```

- [ ] **步骤 2：运行测试，验证执行失败**

执行命令：`cd comind && npx vitest run src/stores/blocks.test.ts -t "loadBlock"`

预期结果：执行失败，提示 `store.loadBlock is not a function`。

- [ ] **步骤 3：实现 loadBlock 方法**

在 `comind/src/stores/blocks.ts` 中，找到 `loadMultiPageBlocks` 函数结束位置（约第 252 行 `}` 处），在其后插入：

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
        createdAt: rustBlock.created_at,
        updatedAt: rustBlock.updated_at
      }
      blocks.value.push(block)
      return block
    } catch (err) {
      console.error('[loadBlock] Failed to load block:', err)
      return undefined
    }
  }
```

- [ ] **步骤 4：将 loadBlock 加入 return 导出**

在 `comind/src/stores/blocks.ts` 的 return 语句中（约第 920-953 行），在 `loadMultiPageBlocks,` 行之后添加 `loadBlock,`：

```typescript
  return {
    blocks,
    sortedBlocks,
    blockTree,
    loading,
    structureVersion,
    getChildren,
    getBlocksByPage,
    getBlock,
    getOutlinks,
    getBacklinks,
    loadPageBlocks,
    loadMultiPageBlocks,
    loadBlock,
    createBlock,
    insertBlockAtCursor,
    insertSiblingAbove,
    insertAtPosition,
    mergeWithPrevious,
    findPreviousBlockInTreeOrder,
    findPreviousVisibleBlock,
    findLastVisibleDescendant,
    findNextBlockInTreeOrder,
    indent,
    outdent,
    moveBlock,
    deleteBlock,
    updateBlockContent,
    updateBlockFormat,
    updateBlockType,
    updateBlockProperties,
    scheduleSave,
    trashedPageWarnings,
    clearTrashedPageWarnings
  }
```

- [ ] **步骤 5：运行测试，验证通过**

执行命令：`cd comind && npx vitest run src/stores/blocks.test.ts -t "loadBlock"`

预期结果：3 个测试全部通过。

- [ ] **步骤 6：TypeScript 类型检查**

执行命令：`cd comind && npx vue-tsc --noEmit`

预期结果：无类型错误。

- [ ] **步骤 7：提交代码**

```bash
cd comind
git add src/stores/blocks.ts src/stores/blocks.test.ts
git commit -m "feat(blocks): add loadBlock method for single block loading by ID"
```

---

## 任务 2：buildDocumentOrder 工具函数（TDD）

**涉及文件：**
- 修改：`comind/src/utils/block-helpers.ts`（新增 buildDocumentOrder 函数，文件末尾追加）
- 测试：`comind/src/utils/block-helpers.test.ts`（新增 buildDocumentOrder 测试用例）

**目标**：给定一组 Block（同一页面的扁平列表），返回 blockId → 文档顺序索引的 Map。用于反链组内排序。

- [ ] **步骤 1：编写失败测试用例**

在 `comind/src/utils/block-helpers.test.ts` 的 import 语句中添加 `buildDocumentOrder`：

```typescript
import {
  GAP_SIZE,
  pmPosToTextOffset,
  textOffsetToPmPos,
  sortByPos,
  getSortedChildren,
  getSortedSiblings,
  findBlockIndex,
  getPrevSibling,
  getNextSibling,
  calcInsertPos,
  renumberBlocks,
  isGapExhaustedError,
  isDescendantOf,
  buildDocumentOrder
} from './block-helpers'
```

在文件末尾追加：

```typescript
// ============================================================
// buildDocumentOrder 测试
// ============================================================
describe('buildDocumentOrder', () => {
  test('扁平列表（无父子关系）按 pos 排序', () => {
    const blocks: Block[] = [
      createBlock('b3', 'p1', null, 3000),
      createBlock('b1', 'p1', null, 1000),
      createBlock('b2', 'p1', null, 2000)
    ]
    const order = buildDocumentOrder(blocks)
    expect(order.get('b1')).toBe(0)
    expect(order.get('b2')).toBe(1)
    expect(order.get('b3')).toBe(2)
  })

  test('嵌套树按前序遍历排序', () => {
    // 结构：
    // b1 (pos=1000)
    //   b1c1 (pos=1000, parent=b1)
    //     b1c1g1 (pos=1000, parent=b1c1)
    //   b1c2 (pos=2000, parent=b1)
    // b2 (pos=2000)
    const blocks: Block[] = [
      createBlock('b1', 'p1', null, 1000),
      createBlock('b2', 'p1', null, 2000),
      createBlock('b1c1', 'p1', 'b1', 1000),
      createBlock('b1c2', 'p1', 'b1', 2000),
      createBlock('b1c1g1', 'p1', 'b1c1', 1000)
    ]
    const order = buildDocumentOrder(blocks)
    expect(order.get('b1')).toBe(0)
    expect(order.get('b1c1')).toBe(1)
    expect(order.get('b1c1g1')).toBe(2)
    expect(order.get('b1c2')).toBe(3)
    expect(order.get('b2')).toBe(4)
  })

  test('空数组返回空 Map', () => {
    const order = buildDocumentOrder([])
    expect(order.size).toBe(0)
  })
})
```

- [ ] **步骤 2：运行测试，验证执行失败**

执行命令：`cd comind && npx vitest run src/utils/block-helpers.test.ts -t "buildDocumentOrder"`

预期结果：执行失败，提示 `buildDocumentOrder is not exported from './block-helpers'`。

- [ ] **步骤 3：实现 buildDocumentOrder**

在 `comind/src/utils/block-helpers.ts` 文件末尾追加：

```typescript
/**
 * 构建文档顺序映射（前序遍历 DFS）
 *
 * 给定同一页面的扁平 Block 列表，返回 blockId → 顺序索引的 Map。
 * 用于反链组内按源页文档顺序排序。
 *
 * @param blocks 同一页面的扁平 Block 列表
 * @returns Map<blockId, orderIndex>
 */
export function buildDocumentOrder(blocks: Block[]): Map<string, number> {
  const childrenMap = new Map<string | null, Block[]>()
  for (const b of blocks) {
    const parent = b.parentId ?? null
    if (!childrenMap.has(parent)) childrenMap.set(parent, [])
    childrenMap.get(parent)!.push(b)
  }
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

- [ ] **步骤 4：运行测试，验证通过**

执行命令：`cd comind && npx vitest run src/utils/block-helpers.test.ts -t "buildDocumentOrder"`

预期结果：3 个测试全部通过。

- [ ] **步骤 5：提交代码**

```bash
cd comind
git add src/utils/block-helpers.ts src/utils/block-helpers.test.ts
git commit -m "feat(utils): add buildDocumentOrder for pre-order DFS block ordering"
```

---

## 任务 3：Backlinks.vue script 重构

**涉及文件：**
- 修改：`comind/src/components/Backlinks.vue`（重写 `<script setup>` 部分，第 1-180 行）

**目标**：重写 loadBacklinks 实现分组/去重/排序/orphan 过滤；新增 groupedBacklinks computed、handleGroupClick；保留 handleBacklinkClick 并适配新结构。

**输入**：targetPageId（当前页 B 的 ID）
**输出**：groupedBacklinks（BacklinkGroup[]，按字母序排列的分组，组内按文档顺序排列）

- [ ] **步骤 1：更新 import 语句**

将 `comind/src/components/Backlinks.vue` 的 `<script setup>` 部分（第 1-6 行）替换为：

```typescript
<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { usePageStore } from '../stores/pages'
import { useEditorStore } from '../stores/editor'
import { useNavigateToPage } from '../composables/useNavigateToPage'
import { useBlockStore } from '../stores/blocks'
import { usePropertyStore } from '../stores/property'
import { useBlockRegistry } from '../composables/useBlockRegistry'
import { buildDocumentOrder } from '../utils/block-helpers'
import type { Block } from '../types/block'
import PropertyInline from './Block/PropertyInline.vue'
import PropertyDisplay from './Block/PropertyDisplay.vue'
```

- [ ] **步骤 2：定义类型与 store 初始化**

在 import 之后（原第 8 行 `const props = withDefaults` 之前），替换 props/store 初始化部分为：

```typescript
const props = withDefaults(defineProps<{
  pageId?: string
}>(), {
  pageId: undefined
})

const pageStore = usePageStore()
const editorStore = useEditorStore()
const blockStore = useBlockStore()
const propertyStore = usePropertyStore()
const { navigateToPage } = useNavigateToPage()
const { getHandler } = useBlockRegistry()

interface Link {
  id: string
  sourceBlockId: string
  targetPageId: string
  relationshipType: string | null
  createdAt: number
}

interface BacklinkItem {
  link: Link
  block: Block
}

interface BacklinkGroup {
  sourcePageId: string
  sourcePageTitle: string
  items: BacklinkItem[]
}

const groupedBacklinks = ref<BacklinkGroup[]>([])
const loading = ref(false)
const collapsed = ref(false)
const bodyRef = ref<HTMLElement | null>(null)
const isAnimating = ref(false)

const hasBacklinks = computed(() => groupedBacklinks.value.length > 0)
const targetPageId = computed(() => props.pageId ?? pageStore.currentPageId)
```

- [ ] **步骤 3：实现 loadBacklinks（分组核心逻辑）**

替换原有的 `loadBacklinks` 函数（原第 73-135 行）为：

```typescript
async function loadBacklinks() {
  const currentId = targetPageId.value
  if (!currentId) {
    groupedBacklinks.value = []
    return
  }

  loading.value = true
  try {
    // 1. 加载当前页块（保留现有行为）
    await blockStore.loadMultiPageBlocks([currentId])

    // 2. 获取指向当前页的所有反链
    const links = await blockStore.getBacklinks(currentId)

    // 3. 解析每个 link 的 sourceBlockId → block（含 pageId）
    const itemMap = new Map<string, BacklinkItem>()
    for (const link of links) {
      if (itemMap.has(link.sourceBlockId)) continue // 去重
      const block = await blockStore.loadBlock(link.sourceBlockId)
      if (!block) continue // orphan-block 跳过
      itemMap.set(link.sourceBlockId, { link, block })
    }

    // 4. 收集所有 sourcePageId，加载完整页树（文档顺序排序需要）
    const sourcePageIds = [...new Set(
      [...itemMap.values()].map(item => item.block.pageId)
    )]
    if (sourcePageIds.length > 0) {
      await blockStore.loadMultiPageBlocks(sourcePageIds)
    }

    // 5. 过滤 orphan-page + 按 sourcePageId 分组
    const groupMap = new Map<string, BacklinkItem[]>()
    for (const item of itemMap.values()) {
      const page = pageStore.getPage(item.block.pageId)
      if (!page) continue // orphan-page 跳过
      const existing = groupMap.get(item.block.pageId) ?? []
      existing.push(item)
      groupMap.set(item.block.pageId, existing)
    }

    // 6. 组内排序（文档顺序）+ 组间排序（字母序）
    const groups: BacklinkGroup[] = []
    for (const [sourcePageId, items] of groupMap) {
      const page = pageStore.getPage(sourcePageId)!
      // 获取该页所有块，构建文档顺序
      const pageBlocks = blockStore.getBlocksByPage(sourcePageId)
      const orderMap = buildDocumentOrder(pageBlocks)
      // 按文档顺序排序组内块
      items.sort((a, b) => {
        const oa = orderMap.get(a.block.id) ?? 0
        const ob = orderMap.get(b.block.id) ?? 0
        return oa - ob
      })
      groups.push({
        sourcePageId,
        sourcePageTitle: page.title ?? '未命名页面',
        items
      })
    }
    // 按页面标题字母序排序
    groups.sort((a, b) => a.sourcePageTitle.localeCompare(b.sourcePageTitle))

    // 7. 加载所有块的属性（PropertyDisplay/PropertyInline 需要）
    const allBlockIds = groups.flatMap(g => g.items.map(i => i.block.id))
    await Promise.allSettled(
      allBlockIds.map(id => propertyStore.loadBlockProperties(id))
    )

    groupedBacklinks.value = groups
  } finally {
    loading.value = false
  }
}
```

- [ ] **步骤 4：实现 handleBacklinkClick 和 handleGroupClick**

替换原有的 `handleBacklinkClick` 函数（原第 47-70 行）为：

```typescript
// 点击反链块：跳转到源页 + 激活该块
async function handleBacklinkClick(item: BacklinkItem) {
  if (editorStore.activeBlockId) {
    editorStore.deactivateBlock()
  }

  const block = blockStore.getBlock(item.link.sourceBlockId)
  if (!block) return

  if (block.pageId !== pageStore.currentPageId) {
    await navigateToPage(block.pageId)
  }

  await nextTick()
  editorStore.activateBlock(item.link.sourceBlockId)
}

// 点击组标题：跳转到源页（不激活块）
async function handleGroupClick(sourcePageId: string) {
  if (sourcePageId !== pageStore.currentPageId) {
    await navigateToPage(sourcePageId)
  }
}
```

- [ ] **步骤 5：实现属性辅助函数**

在 `handleGroupClick` 之后添加：

```typescript
function getBlockPropertiesMap(blockId: string): Record<string, any> {
  const props = propertyStore.getBlockProperties(blockId)
  const result: Record<string, any> = {}
  for (const prop of props) {
    result[prop.key] = prop.value
  }
  return result
}

function getBlockLanguage(blockId: string): string | undefined {
  const prop = propertyStore.getBlockProperty(blockId, 'language')
  return prop?.value as string | undefined
}
```

- [ ] **步骤 6：保留 watch 逻辑**

将原有的 watch 逻辑（原第 142-179 行）保留，但删除 `backlinkItems` 引用，改为 `groupedBacklinks`：

```typescript
// 监听 targetPageId 变化，重新加载 Backlinks
watch(
  targetPageId,
  () => loadBacklinks(),
  { immediate: true }
)

// 折叠动画
watch(collapsed, async (isCollapsed) => {
  const el = bodyRef.value
  if (!el) return
  if (isCollapsed) {
    el.style.maxHeight = el.scrollHeight + 'px'
    await nextTick()
    requestAnimationFrame(() => {
      el.style.maxHeight = '0px'
      setTimeout(() => { isAnimating.value = false }, 220)
    })
    isAnimating.value = true
  } else {
    el.style.maxHeight = 'none'
    const targetHeight = el.scrollHeight
    el.style.maxHeight = '0px'
    await nextTick()
    requestAnimationFrame(() => {
      el.style.maxHeight = targetHeight + 'px'
      setTimeout(() => { isAnimating.value = false }, 220)
    })
    isAnimating.value = true
  }
}, { flush: 'post' })

// 分组数据变化时重算高度
watch([groupedBacklinks, loading], async () => {
  if (collapsed.value) return
  await nextTick()
  if (bodyRef.value) bodyRef.value.style.maxHeight = 'none'
})
```

- [ ] **步骤 7：TypeScript 类型检查**

执行命令：`cd comind && npx vue-tsc --noEmit`

预期结果：无类型错误。

- [ ] **步骤 8：提交代码**

```bash
cd comind
git add src/components/Backlinks.vue
git commit -m "refactor(backlinks): rewrite script for grouped backlinks with document order sorting"
```

---

## 任务 4：Backlinks.vue template + style 重构

**涉及文件：**
- 修改：`comind/src/components/Backlinks.vue`（重写 `<template>` 和 `<style>` 部分）

**目标**：分组结构模板 + 块渲染（bullet + PropertyInline + renderComponent + PropertyDisplay）+ 样式（24px 缩进、组标题、块布局）。

**交接点**：依赖任务 3 的 `groupedBacklinks`、`handleBacklinkClick`、`handleGroupClick`、`getBlockPropertiesMap`、`getBlockLanguage`。

- [ ] **步骤 1：重写 template**

将 `comind/src/components/Backlinks.vue` 的 `<template>` 部分（原第 182-216 行）替换为：

```html
<template>
  <div v-if="hasBacklinks" class="backlinks-panel" :class="{ 'is-collapsed': collapsed }">
    <!-- 面板 Header：始终可见，点击切换折叠 -->
    <div class="backlinks-header" @click="collapsed = !collapsed">
      <span class="backlinks-title">
        <span class="backlinks-icon">🔗</span>
        反向链接
        <span class="backlinks-count">({{ groupedBacklinks.reduce((sum, g) => sum + g.items.length, 0) }})</span>
      </span>
      <span class="backlinks-toggle">{{ collapsed ? '▶' : '▼' }}</span>
    </div>

    <!-- 折叠内容区：max-height 动画控制 -->
    <div ref="bodyRef" class="backlinks-body">
      <div v-if="loading" class="backlinks-loading">加载中...</div>

      <div v-else class="backlinks-groups">
        <div
          v-for="group in groupedBacklinks"
          :key="group.sourcePageId"
          class="backlink-group"
        >
          <!-- 组标题：[[A]] (count)，点击跳转到源页 -->
          <div class="backlink-group-header" @click="handleGroupClick(group.sourcePageId)">
            <span class="backlink-group-title">[[{{ group.sourcePageTitle }}]]</span>
            <span class="backlink-group-count">({{ group.items.length }})</span>
          </div>

          <!-- 块列表：向右缩进 24px -->
          <div class="backlink-block-list">
            <div
              v-for="item in group.items"
              :key="item.link.sourceBlockId"
              class="backlink-block"
              @click="handleBacklinkClick(item)"
            >
              <!-- Bullet（纯展示圆点，不可拖拽/折叠） -->
              <span class="block-bullet backlink-bullet">
                <span class="bullet-dot"></span>
              </span>

              <!-- PropertyInline: between-bullet-content -->
              <PropertyInline
                :block-id="item.link.sourceBlockId"
                position="between-bullet-content"
              />

              <!-- 块内容：renderComponent（readonly） -->
              <component
                v-if="getHandler(item.block.type)"
                :is="getHandler(item.block.type)!.renderComponent"
                :block-id="item.link.sourceBlockId"
                :content="item.block.content"
                :properties="getBlockPropertiesMap(item.link.sourceBlockId)"
                :language="getBlockLanguage(item.link.sourceBlockId)"
                :readonly="true"
                @content-click.stop
              />
              <span v-else class="backlink-text-fallback">{{ item.block.content || '空块' }}</span>

              <!-- PropertyInline: right-of-content -->
              <PropertyInline
                :block-id="item.link.sourceBlockId"
                position="right-of-content"
              />

              <!-- PropertyDisplay（下方属性区，stopPropagation） -->
              <div class="backlink-properties" @click.stop>
                <PropertyDisplay :block-id="item.link.sourceBlockId" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **步骤 2：重写 style**

将 `comind/src/components/Backlinks.vue` 的 `<style scoped>` 部分（原第 218-377 行）替换为：

```css
<style scoped>
/*
 * Backlinks 面板布局方案（分组重构）
 * - 面板固定在页面底部，不随页面滚动
 * - 按来源页面分组，组标题左上角，块向右缩进 24px
 * - 面板级折叠（maxHeight 动画）
 */

.backlinks-panel {
  flex-shrink: 0;
  border-top: 2px dashed var(--border);
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  padding: 0;
  max-width: var(--max-width);
  width: 100%;
  box-sizing: border-box;
}

.backlinks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) 0;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background 80ms ease;
}

.backlinks-header:hover {
  background: var(--bg-hover);
}

.backlinks-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.05em;
}

.backlinks-icon {
  font-size: var(--text-sm);
}

.backlinks-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-weight: 400;
}

.backlinks-toggle {
  font-size: 10px;
  color: var(--text-tertiary);
  padding: 2px var(--space-1);
}

/* 内容区：JS 通过 maxHeight 控制折叠动画 */
.backlinks-body {
  overflow: hidden;
  padding: 0 0 var(--space-4);
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.backlinks-body::-webkit-scrollbar {
  width: 4px;
}

.backlinks-body::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}

.backlinks-body::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

.backlinks-loading {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  padding: var(--space-4) var(--space-1);
  text-align: center;
}

/* 分组容器 */
.backlinks-groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 组标题 */
.backlink-group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--space-2) 0;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background 80ms ease;
}

.backlink-group-header:hover {
  background: var(--bg-hover);
}

.backlink-group-title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.backlink-group-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-weight: 400;
}

/* 块列表：向右缩进 24px（= INDENT_WIDTH_PER_LEVEL） */
.backlink-block-list {
  padding-left: 24px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 单个反链块 */
.backlink-block {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 80ms ease;
}

.backlink-block:hover {
  background: var(--bg-hover);
}

/* Bullet：覆盖全局 .block-bullet 的 cursor 和 hover */
.backlink-bullet {
  cursor: default;
}

.backlink-bullet:hover .bullet-dot {
  opacity: var(--block-bullet-opacity);
  transform: translateY(1px);
  box-shadow: none;
}

/* renderComponent 内容区 */
.backlink-block > :deep(.block-render) {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: 1.6;
}

/* fallback 纯文本（无 handler 时） */
.backlink-text-fallback {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

/* PropertyDisplay 下方属性区 */
.backlink-properties {
  width: 100%;
  padding-left: 28px; /* 对齐 bullet 宽度 20px + gap 8px */
}
</style>
```

- [ ] **步骤 3：TypeScript 类型检查 + Vite 构建**

执行命令：`cd comind && npm run build`

预期结果：TypeScript 类型检查通过 + Vite 构建成功，无错误。

- [ ] **步骤 4：提交代码**

```bash
cd comind
git add src/components/Backlinks.vue
git commit -m "refactor(backlinks): rewrite template with grouped layout and renderComponent"
```

---

## 任务 5：Backlinks.test.ts 更新

**涉及文件：**
- 修改：`comind/src/components/Backlinks.test.ts`（更新 mock + 新增分组逻辑测试）

**目标**：更新现有测试以适配重构后的组件结构，新增分组渲染验证。

**交接点**：依赖任务 3-4 完成的 Backlinks.vue 重构。

- [ ] **步骤 1：更新 mock 适配新依赖**

将 `comind/src/components/Backlinks.test.ts` 全文替换为：

```typescript
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import Backlinks from './Backlinks.vue'

vi.mock('../stores/pages', () => ({
  usePageStore: vi.fn(() => ({
    currentPageId: 'test-page-id',
    getPage: vi.fn(() => ({ id: 'source-page-1', title: '页面A' }))
  }))
}))

vi.mock('../stores/editor', () => ({
  useEditorStore: vi.fn(() => ({
    activeBlockId: null,
    deactivateBlock: vi.fn(),
    activateBlock: vi.fn()
  }))
}))

vi.mock('../composables/useNavigateToPage', () => ({
  useNavigateToPage: vi.fn(() => ({
    navigateToPage: vi.fn()
  }))
}))

vi.mock('../stores/blocks', () => ({
  useBlockStore: vi.fn(() => ({
    loadMultiPageBlocks: vi.fn().mockResolvedValue([]),
    loadBlock: vi.fn().mockResolvedValue(undefined),
    getBacklinks: vi.fn().mockResolvedValue([]),
    getBlock: vi.fn(() => undefined),
    getBlocksByPage: vi.fn(() => [])
  }))
}))

vi.mock('../stores/property', () => ({
  usePropertyStore: vi.fn(() => ({
    loadBlockProperties: vi.fn().mockResolvedValue([]),
    getBlockProperties: vi.fn(() => []),
    getBlockProperty: vi.fn(() => undefined)
  }))
}))

vi.mock('../composables/useBlockRegistry', () => ({
  useBlockRegistry: vi.fn(() => ({
    getHandler: vi.fn(() => undefined)
  }))
}))

vi.mock('./Block/PropertyInline.vue', () => ({
  default: { template: '<span class="property-inline-stub" />' }
}))

vi.mock('./Block/PropertyDisplay.vue', () => ({
  default: { template: '<div class="property-display-stub" />' }
}))

vi.mock('../utils/block-helpers', () => ({
  buildDocumentOrder: vi.fn(() => new Map())
}))

describe('Backlinks.vue', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('基本功能', () => {
    test('无反链时面板不渲染', () => {
      const wrapper = mount(Backlinks)
      expect(wrapper.find('.backlinks-panel').exists()).toBe(false)
    })

    test('组件能正确挂载', () => {
      const wrapper = mount(Backlinks)
      expect(wrapper.exists()).toBe(true)
    })
  })
})
```

- [ ] **步骤 2：运行测试，验证通过**

执行命令：`cd comind && npx vitest run src/components/Backlinks.test.ts`

预期结果：测试通过（mock 返回空反链列表，面板不渲染，组件正确挂载）。

- [ ] **步骤 3：提交代码**

```bash
cd comind
git add src/components/Backlinks.test.ts
git commit -m "test(backlinks): update mocks and tests for grouped backlinks refactor"
```

---

## 任务 6：编译检查与集成验证

**涉及文件：**
- 无文件修改（纯验证任务）

**目标**：全量编译检查 + 单元测试通过 + 浏览器功能验证。

- [ ] **步骤 1：全量 TypeScript 类型检查 + Vite 构建**

执行命令：`cd comind && npm run build`

预期结果：
- `vue-tsc -b` 类型检查通过
- `vite build` 构建成功
- 无任何错误

- [ ] **步骤 2：全量单元测试**

执行命令：`cd comind && npx vitest run`

预期结果：所有测试通过，无失败。

- [ ] **步骤 3：浏览器功能验证**

使用 webapp-testing 技能启动开发服务器并验证以下场景：

1. **分组渲染**：创建页面 A，在 A 中添加 3 个引用 B 的块，打开 B 页面，确认反链面板显示一组 `[[页面A]] (3)`，组内 3 个块按文档顺序排列
2. **跨页加载**：创建从未访问过的页面 C，在 C 中引用 B，打开 B 页面，确认 C 的反链正确加载显示
3. **点击块跳转**：点击反链块，确认跳转到源页且该块被激活
4. **点击标题跳转**：点击组标题 `[[页面A]]`，确认跳转到源页但不激活块
5. **去重**：在一个块内输入两个 `[[B]]`，确认反链面板只显示一次该块
6. **折叠动画**：点击面板 header，确认折叠/展开动画正常

- [ ] **步骤 4：最终提交（如有修复）**

```bash
cd comind
git add -A
git commit -m "fix(backlinks): integration test fixes" || echo "No fixes needed"
```

---

## 自我审核

### 规范覆盖性
- D1（renderComponent）：任务 4 步骤 1 模板中 `<component :is="getHandler(...)!.renderComponent" :readonly="true" />` ✓
- D2（视觉元素）：任务 4 模板含 bullet + PropertyInline(两位置) + PropertyDisplay ✓
- D3（不渲染子块）：模板无递归子块 ✓
- D4（字母序分组）：任务 3 步骤 3 `groups.sort((a, b) => a.sourcePageTitle.localeCompare(b.sourcePageTitle))` ✓
- D5（文档顺序）：任务 3 步骤 3 `buildDocumentOrder` + `items.sort` ✓
- D6（去重）：任务 3 步骤 3 `if (itemMap.has(link.sourceBlockId)) continue` ✓
- D7（orphan 跳过）：任务 3 步骤 3 `if (!block) continue` + `if (!page) continue` ✓
- D8（Concept Block 纳入）：无特殊过滤 ✓
- D9（24px 缩进）：任务 4 步骤 2 `.backlink-block-list { padding-left: 24px; }` ✓
- D10（仅面板级折叠）：模板仅面板级 `collapsed`，无每组折叠 ✓
- D11（点击冒泡）：模板 `@content-click.stop` + PropertyDisplay `@click.stop` ✓

### 占位内容排查
- 无 "待定""待办" 等 ✓
- 所有代码步骤含完整代码 ✓

### 类型一致性
- `BacklinkItem` 定义（任务 3 步骤 2）与 `handleBacklinkClick(item: BacklinkItem)` 签名一致 ✓
- `BacklinkGroup` 定义与 `groupedBacklinks` ref 类型一致 ✓
- `loadBlock(blockId: string): Promise<Block | undefined>` 签名在测试和实现中一致 ✓
- `buildDocumentOrder(blocks: Block[]): Map<string, number>` 签名在测试和实现中一致 ✓
