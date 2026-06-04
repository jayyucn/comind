# 删除 Block 时整理语义关系 实施方案

> **面向智能体执行者：必须使用子技能**：通过 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
>
> **目标**：删除 Block（单 block / 多选 Backspace）时自动整理被删 block 涉及到的反向 typed-link，避免悬空引用
> **架构**：新增 `useBlockRelationshipCleanup` composable，统一处理同页快照检查 + 跨页反向降级；同时被 `Block/index.vue` 和 `useCrossBlockSelection.deleteSelected` 调用
> **技术栈**：Vue 3 + TypeScript + Pinia + Vitest
>
> **相关文件：**
> - `docs/superpowers/specs/2026-06-04-block-delete-relationship-cleanup-design.md` — 设计文档

---

## 文件结构

```
src/composables/
├── useRelationshipSync.ts            # 修改：导出 applyRelationshipTypeToBlockContent
├── useBlockRelationshipCleanup.ts    # 新建：核心 composable
└── useBlockRelationshipCleanup.test.ts # 新建：单元测试

src/composables/
├── useCrossBlockSelection.ts         # 修改：deleteSelected 改用 cleanup
└── useCrossBlockSelection.test.ts    # 修改：补 cleanup 集成断言

src/components/Block/
├── index.vue                         # 修改：handleDelete 调 cleanup
└── index.test.ts                     # 修改：补 cleanup 集成断言
```

---

### Task 1：从 `useRelationshipSync` 导出 `applyRelationshipTypeToBlockContent`

**涉及文件：**
- 修改：`comind/src/composables/useRelationshipSync.ts:182‑217` — `export function applyRelationshipTypeToBlockContent`
- 修改：`comind/src/composables/useRelationshipSync.test.ts` — 追加 export 工具的单元测试

- [ ] **步骤 1：编写失败测试（验证导出）**

在 `comind/src/composables/useRelationshipSync.test.ts` 末尾追加：

```ts
import { applyRelationshipTypeToBlockContent } from './useRelationshipSync'

describe('applyRelationshipTypeToBlockContent（export）', () => {
  it('应能作为命名导出函数从模块顶层导入', () => {
    expect(typeof applyRelationshipTypeToBlockContent).toBe('function')
  })

  it('应能移除 [[Target]]^(type) 的类型后缀', () => {
    const content = 'see [[Target]]^(depends-on) for details'
    const result = applyRelationshipTypeToBlockContent(content, 'Target', null)
    expect(result).toBe('see [[Target]] for details')
  })

  it('应能替换 [[Target]]^(oldType) 为 [[Target]]^(newType)', () => {
    const content = 'see [[Target]]^(depends-on) for details'
    const result = applyRelationshipTypeToBlockContent(content, 'Target', 'related')
    expect(result).toBe('see [[Target]]^(related) for details')
  })

  it('应支持别名形式 [[Target|alias]]^(type)', () => {
    const content = 'see [[Target|display]]^(depends-on)'
    const result = applyRelationshipTypeToBlockContent(content, 'Target', null)
    expect(result).toBe('see [[Target|display]]')
  })

  it('不应影响指向其他目标的链接', () => {
    const content = '[[A]]^(depends-on) and [[B]]^(related)'
    const result = applyRelationshipTypeToBlockContent(content, 'A', null)
    expect(result).toBe('[[A]] and [[B]]^(related)')
  })
})
```

- [ ] **步骤 2：运行测试，验证执行失败**

执行命令：`cd comind && npx vitest run src/composables/useRelationshipSync.test.ts`

预期结果：测试因 `applyRelationshipTypeToBlockContent is not a function` 失败（命名导出不存在）。

- [ ] **步骤 3：导出该函数**

在 `comind/src/composables/useRelationshipSync.ts` 第 182 行附近，将 `function applyRelationshipTypeToBlockContent` 改为 `export function applyRelationshipTypeToBlockContent`：

```ts
/**
 * 在 Block 内容中，对所有指向 targetTitle 的链接应用新的关系类型。
 * - 若 newRelationshipType 为 null：移除 ^(...) 部分
 * - 若 newRelationshipType 不为 null：若链接已有关系类型则替换，否则追加
 */
export function applyRelationshipTypeToBlockContent(
  content: string,
  targetTitle: string,
  newRelationshipType: string | null
): string {
  const escapedTitle = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 匹配 [[target]] 或 [[target|alias]]，可选带 ^(relationType)
  const withTypeRegex = new RegExp(
    `\\[\\[(${escapedTitle})(?:\\|[^\\]]+?)?\\]\\]\\^?\\(([^)]+)\\)`,
    'g'
  )
  const plainLinkRegex = new RegExp(
    `\\[\\[(${escapedTitle})(?:\\|[^\\]]+?)?\\]\\](?!\\^\\()`,
    'g'
  )

  // 第一步：替换已带关系类型的链接
  let result = content.replace(withTypeRegex, (match) => {
    const baseMatch = match.match(/^\[\[[^\]]+?\]\]/)
    if (!baseMatch) return match
    if (newRelationshipType === null) return baseMatch[0]
    return `${baseMatch[0]}^(${newRelationshipType})`
  })

  // 第二步：仅当需要添加新类型时，处理不带关系类型的链接
  if (newRelationshipType !== null) {
    result = result.replace(plainLinkRegex, (match) => {
      return `${match}^(${newRelationshipType})`
    })
  }

  return result
}
```

- [ ] **步骤 4：运行测试，验证执行通过**

执行命令：`cd comind && npx vitest run src/composables/useRelationshipSync.test.ts`

预期结果：5 个新测试全部通过，已有测试无回归。

- [ ] **步骤 5：提交代码**

```bash
git add comind/src/composables/useRelationshipSync.ts comind/src/composables/useRelationshipSync.test.ts
git commit -m "refactor(relationship-sync): export applyRelationshipTypeToBlockContent for cross-page cleanup reuse"
```

---

### Task 2：创建 `useBlockRelationshipCleanup` composable（RED 阶段）

**涉及文件：**
- 新建：`comind/src/composables/useBlockRelationshipCleanup.test.ts`

- [ ] **步骤 1：编写测试文件头部 + 全部失败测试**

新建文件 `comind/src/composables/useBlockRelationshipCleanup.test.ts`：

```ts
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from '../stores/blocks'
import { usePageStore } from '../stores/pages'
import { useBlockRelationshipCleanup } from './useBlockRelationshipCleanup'

vi.mock('../storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn(),
    deleteBlock: vi.fn(),
    deleteBlockCascade: vi.fn(),
    updateBlock: vi.fn(),
    getBlockTree: vi.fn().mockResolvedValue([])
  }
}))

beforeEach(() => {
  setActivePinia(createPinia())
})

/**
 * 测试夹具：创建两个有 title 的 page（"P" 和 "X"），分别作为「本页面」和「目标页面」。
 * 返回真实的 pageId 供后续 block 创建。
 */
async function createPagesWithTitles() {
  const pageStore = usePageStore()
  await pageStore.createPage('P', 'normal')
  const ourPage = pageStore.pages[pageStore.pages.length - 1]
  await pageStore.createPage('X', 'normal')
  const targetPage = pageStore.pages[pageStore.pages.length - 1]
  return { ourPage, targetPage }
}

describe('useBlockRelationshipCleanup', () => {
  let blockStore: ReturnType<typeof useBlockStore>

  beforeEach(() => {
    blockStore = useBlockStore()
  })

  describe('cleanupAfterDelete', () => {
    test('空 deletedBlockIds 时应立即返回且不调 deleteBlock', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage } = await createPagesWithTitles()

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [])

      expect(result.modifiedCrossPageBlocks).toEqual([])
      expect(result.orphanedTargets).toEqual([])
      expect(blockStore.blocks.length).toBe(0)
    })

    test('被删 block 无 typed-link 时不应触发跨页清理', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 主页 block：纯 [[X]] 链接
      const block = await blockStore.createBlock({ pageId: ourPage.id, content: 'see [[X]]' })
      // 目标页 block：含反向 typed-link
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'reverse [[P]]^(required-by)'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.orphanedTargets).toEqual([])
      // 目标页 block 不应被修改
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('reverse [[P]]^(required-by)')
    })

    test('被删 block 仅含单向 ^(depends-on)（无 inverse）时不应触发跨页清理', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 主页 block：单向 depends-on（inverseRelationshipType 为 null）
      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on)'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'reverse [[P]]^(required-by)'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.orphanedTargets).toEqual([])
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('reverse [[P]]^(required-by)')
    })

    test('被删 block 含双向 ^(depends-on<->required-by) 时应跨页降级反向引用', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 主页 block：双向 typed-link
      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      // 目标页 block：含反向 required-by typed-link
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.orphanedTargets).toEqual([
        { targetTitle: 'X', inverseType: 'required-by' }
      ])
      // 目标页 block 应被降级
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]')
    })

    test('被删 block 含 auto-inverse ^(depends-on!) 时也应跨页降级', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on!)'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]')
    })

    test('同页 SURVIVING block 仍含 typed-link 到目标 X 时不应触发跨页清理', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 主页：两个 block 都引用 X，第一个被删
      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'also see [[X]]^(depends-on<->required-by)'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block1.id])

      expect(result.orphanedTargets).toEqual([])
      // 目标页 block 不应被修改（因为本页还有 typed-link 维持）
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]^(required-by)')
    })

    test('同页 SURVIVING block 仅含纯 [[X]]（无 ^(...)）时应触发跨页清理', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 主页：一个 typed block 被删，一个纯 [[X]] block 存活
      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      await blockStore.createBlock({ pageId: ourPage.id, content: 'plain [[X]]' })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      await cleanup.cleanupAfterDelete(ourPage.id, [block1.id])

      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]')
    })

    test('目标页有多个 block 含反向引用时应全部降级', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      const targetBlock1 = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })
      const targetBlock2 = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'also see [[P]]^(required-by) and more'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.modifiedCrossPageBlocks.length).toBe(2)
      const after1 = blockStore.blocks.find(b => b.id === targetBlock1.id)
      const after2 = blockStore.blocks.find(b => b.id === targetBlock2.id)
      expect(after1?.content).toBe('see [[P]]')
      expect(after2?.content).toBe('also see [[P]] and more')
    })

    test('目标页无反向引用时应返回空 modifiedCrossPageBlocks', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'plain text without any link'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(result.orphanedTargets.length).toBe(1)
      expect(result.modifiedCrossPageBlocks).toEqual([])
    })

    test('应通过 updateBlockContent 持久化被修改的跨页 block', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      const block = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      const updateSpy = vi.spyOn(blockStore, 'updateBlockContent')
      await cleanup.cleanupAfterDelete(ourPage.id, [block.id])

      expect(updateSpy).toHaveBeenCalledWith(targetBlock.id, 'see [[P]]')
    })

    test('多选删除多个 block 时应去重目标集合', async () => {
      const cleanup = useBlockRelationshipCleanup()
      const { ourPage, targetPage } = await createPagesWithTitles()

      // 两个被删 block 都引用同一目标 X
      const block1 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'see [[X]]^(depends-on<->required-by)'
      })
      const block2 = await blockStore.createBlock({
        pageId: ourPage.id,
        content: 'also see [[X]]^(depends-on<->required-by)'
      })
      const targetBlock = await blockStore.createBlock({
        pageId: targetPage.id,
        content: 'see [[P]]^(required-by)'
      })

      const result = await cleanup.cleanupAfterDelete(ourPage.id, [block1.id, block2.id])

      // 目标去重：只有 1 个
      expect(result.orphanedTargets.length).toBe(1)
      // 目标页 block 应被降级
      const after = blockStore.blocks.find(b => b.id === targetBlock.id)
      expect(after?.content).toBe('see [[P]]')
    })
  })
})
```

- [ ] **步骤 2：运行测试，验证执行失败**

执行命令：`cd comind && npx vitest run src/composables/useBlockRelationshipCleanup.test.ts`

预期结果：测试因模块 `useBlockRelationshipCleanup` 找不到或 `cleanupAfterDelete is not a function` 失败。

---

### Task 3：实现 `useBlockRelationshipCleanup`（GREEN 阶段）

**涉及文件：**
- 新建：`comind/src/composables/useBlockRelationshipCleanup.ts`

- [ ] **步骤 1：实现 composable**

新建文件 `comind/src/composables/useBlockRelationshipCleanup.ts`：

```ts
import { useBlockStore } from '../stores/blocks'
import { usePageStore } from '../stores/pages'
import { parseBlockLinks } from '../utils/parser'
import { applyRelationshipTypeToBlockContent } from './useRelationshipSync'

export interface OrphanedTarget {
  targetTitle: string
  inverseType: string
}

export interface CleanupResult {
  /** 被修改的跨页 block 列表（已持久化） */
  modifiedCrossPageBlocks: Array<{ id: string; pageId: string; content: string }>
  /** 被识别为需要跨页清理的目标集合（去重） */
  orphanedTargets: OrphanedTarget[]
}

/**
 * Block 删除后的语义关系整理 composable
 *
 * 职责：在一组 Block 被删除后，处理它们涉及到的反向 typed-link，
 * 避免出现"源端已删、目标端还挂着 typed 类型"的悬空引用。
 *
 * 流程：
 * 1. 解析被删 blocks 中带 inverse 的 typed-link 目标
 * 2. 调 blockStore.deleteBlock 删除（级联清理 link 表的出向 link + properties）
 * 3. 对每个目标：若本页 SURVIVING blocks 已无 typed-link 维持，跨页降级反向引用
 *
 * 边界：
 * - 仅处理带 inverseRelationshipType 的 link（单向 ^(depends-on) 不参与）
 * - 同页其他 block 仍含 typed-link 到目标 → 跳过
 * - 跨页降级保留 [[link]] 本身，只移除 ^(...) 部分
 */
export function useBlockRelationshipCleanup() {
  const blockStore = useBlockStore()
  const pageStore = usePageStore()

  /**
   * 在一组 Block 被删除后，整理它们涉及到的语义关系。
   *
   * @param pageId 被删 block 所属页的 pageId
   * @param deletedBlockIds 被删除的 block ID 集合
   */
  async function cleanupAfterDelete(
    pageId: string,
    deletedBlockIds: string[]
  ): Promise<CleanupResult> {
    const result: CleanupResult = {
      modifiedCrossPageBlocks: [],
      orphanedTargets: []
    }

    if (deletedBlockIds.length === 0) return result

    // 1. 收集被删 blocks 中带 inverse 的 typed-link 目标（去重）
    // targetTitle -> inverseType
    const targetSet = new Map<string, string>()
    for (const id of deletedBlockIds) {
      const block = blockStore.blocks.find(b => b.id === id)
      if (!block) continue
      const links = parseBlockLinks(block.content)
      for (const link of links) {
        if (link.isExternal) continue
        if (link.relationshipType === null) continue
        if (link.inverseRelationshipType === null) continue
        targetSet.set(link.targetTitle, link.inverseRelationshipType)
      }
    }

    // 2. 调 blockStore.deleteBlock 删除（级联）— 无论是否能解析 page title，都要先删
    for (const id of deletedBlockIds) {
      await blockStore.deleteBlock(id)
    }

    // 3. 跨页清理：解析当前 pageId 对应的 title，定位反向引用
    const ourPageTitle = pageStore.pages.find(p => p.id === pageId)?.title ?? null
    if (!ourPageTitle) return result

    // 4. 对每个目标：检查本页 SURVIVING blocks 是否仍有 typed-link 维持
    for (const [targetTitle, inverseType] of targetSet) {
      const stillHasTypedLink = blockStore.blocks.some(b => {
        if (b.pageId !== pageId) return false
        if (deletedBlockIds.includes(b.id)) return false
        const links = parseBlockLinks(b.content)
        return links.some(l =>
          !l.isExternal &&
          l.targetTitle === targetTitle &&
          l.relationshipType !== null
        )
      })

      if (stillHasTypedLink) continue

      // 跨页降级：扫描目标页面所有 blocks，移除 [[ourPageTitle]]^(...) 类型后缀
      result.orphanedTargets.push({ targetTitle, inverseType })

      const targetPageId = pageStore.pages.find(p => p.title === targetTitle)?.id
      if (!targetPageId) continue

      const targetBlocks = blockStore.blocks.filter(b => b.pageId === targetPageId)
      for (const tb of targetBlocks) {
        const newContent = applyRelationshipTypeToBlockContent(tb.content, ourPageTitle, null)
        if (newContent !== tb.content) {
          await blockStore.updateBlockContent(tb.id, newContent)
          result.modifiedCrossPageBlocks.push({ id: tb.id, pageId: tb.pageId, content: newContent })
        }
      }
    }

    return result
  }

  return { cleanupAfterDelete }
}
```

- [ ] **步骤 2：运行测试，验证执行通过**

执行命令：`cd comind && npx vitest run src/composables/useBlockRelationshipCleanup.test.ts`

预期结果：所有 12 个测试通过。

- [ ] **步骤 3：提交代码**

```bash
git add comind/src/composables/useBlockRelationshipCleanup.ts comind/src/composables/useBlockRelationshipCleanup.test.ts
git commit -m "feat(cleanup): add useBlockRelationshipCleanup composable for cross-page typed-link demotion"
```

---

### Task 4：集成到 `Block/index.vue` 的 `handleDelete`

**涉及文件：**
- 修改：`comind/src/components/Block/index.vue:1‑30`（script setup imports + 引入 composable）
- 修改：`comind/src/components/Block/index.vue:400‑416`（handleDelete 调 cleanup）

- [ ] **步骤 1：在 script setup 中引入 composable**

打开 `comind/src/components/Block/index.vue`，找到 imports 区域（一般在 `<script setup>` 第一行），追加：

```ts
import { useBlockRelationshipCleanup } from '../../composables/useBlockRelationshipCleanup'
```

在 `useEditorStore()` 初始化之后（约第 30 行附近），添加：

```ts
const relationshipCleanup = useBlockRelationshipCleanup()
```

- [ ] **步骤 2：修改 `handleDelete` 调用 cleanup**

找到 `handleDelete` 函数（约第 400 行）：

```ts
async function handleDelete() {
  const prevBlock = blockStore.findPreviousBlockInTreeOrder(blockId.value)
  const prevId = prevBlock?.id

  if (!prevId) {
    if (editorRef.value) editorRef.value.markSaved()
    await blockStore.updateBlockContent(blockId.value, '')
    return
  }

  if (editorRef.value) editorRef.value.markSaved()
  editorStore.deactivateBlock()
  await blockStore.deleteBlock(blockId.value)
  if (prevId) {
    editorStore.activateBlock(prevId)
  }
}
```

替换为：

```ts
async function handleDelete() {
  const prevBlock = blockStore.findPreviousBlockInTreeOrder(blockId.value)
  const prevId = prevBlock?.id

  if (!prevId) {
    if (editorRef.value) editorRef.value.markSaved()
    await blockStore.updateBlockContent(blockId.value, '')
    return
  }

  if (editorRef.value) editorRef.value.markSaved()
  editorStore.deactivateBlock()
  await relationshipCleanup.cleanupAfterDelete(props.pageId, [blockId.value])
  if (prevId) {
    editorStore.activateBlock(prevId)
  }
}
```

- [ ] **步骤 3：运行类型检查**

执行命令：`cd comind && npx vue-tsc -b`

预期结果：类型检查通过。

- [ ] **步骤 4：运行 Block 单元测试**

执行命令：`cd comind && npx vitest run src/components/Block/index.test.ts`

预期结果：已有测试全部通过（handleDelete 行为对外可观察，cleanupAfterDelete 是 mock 友好的）。

- [ ] **步骤 5：提交代码**

```bash
git add comind/src/components/Block/index.vue
git commit -m "feat(block-delete): integrate relationship cleanup into single-block delete"
```

---

### Task 5：集成到 `useCrossBlockSelection.deleteSelected`

**涉及文件：**
- 修改：`comind/src/composables/useCrossBlockSelection.ts:1‑12`（imports + 引入 composable）
- 修改：`comind/src/composables/useCrossBlockSelection.ts:185‑191`（deleteSelected 改用 cleanup）

- [ ] **步骤 1：引入 composable**

打开 `comind/src/composables/useCrossBlockSelection.ts`，在第 10 行附近追加 import：

```ts
import { useBlockRelationshipCleanup } from './useBlockRelationshipCleanup'
```

在函数体内（约第 13 行 `useBlockStore()` 之后）添加：

```ts
const relationshipCleanup = useBlockRelationshipCleanup()
```

- [ ] **步骤 2：修改 `deleteSelected`**

找到当前的 `deleteSelected`：

```ts
async function deleteSelected() {
  if (anchorIds.size === 0) return
  for (const id of anchorIds) {
    await blockStore.deleteBlock(id)
  }
  anchorIds.clear()
}
```

替换为：

```ts
async function deleteSelected() {
  if (anchorIds.size === 0) return
  const toDelete = [...anchorIds]
  anchorIds.clear()

  // 推导被删 block 所属 pageId 唯一集合（按页分别 cleanup）
  const pageIds = new Set<string>()
  for (const id of toDelete) {
    const b = blockStore.blocks.find(x => x.id === id)
    if (b) pageIds.add(b.pageId)
  }

  for (const pageId of pageIds) {
    await relationshipCleanup.cleanupAfterDelete(pageId, toDelete)
  }
}
```

- [ ] **步骤 3：运行类型检查**

执行命令：`cd comind && npx vue-tsc -b`

预期结果：类型检查通过。

- [ ] **步骤 4：运行 useCrossBlockSelection 单元测试**

执行命令：`cd comind && npx vitest run src/composables/useCrossBlockSelection.test.ts`

预期结果：已有 33 个测试全部通过（deleteSelected 行为变更在已有测试覆盖范围内，因为 anchorIds 清空和 blocks 数量减少的断言仍成立）。

- [ ] **步骤 5：提交代码**

```bash
git add comind/src/composables/useCrossBlockSelection.ts
git commit -m "feat(cleanup): route multi-select delete through relationship cleanup composable"
```

---

### Task 6：补集成测试

**涉及文件：**
- 修改：`comind/src/composables/useCrossBlockSelection.test.ts` — 增 cleanup 集成断言
- 修改：`comind/src/components/Block/index.test.ts` — 增 cleanup 集成断言

- [ ] **步骤 1：在 useCrossBlockSelection.test.ts 中增 cleanup 调用断言**

打开 `comind/src/composables/useCrossBlockSelection.test.ts`，在文件头部 import 区域追加：

```ts
import { usePageStore } from '../stores/pages'
```

找到 `describe('deleteSelected', ...)` 块（已有但只含「应删除 anchorIds 中所有块」等基础测试），在末尾追加：

```ts
test('被删 block 含 typed-link 时应触发跨页反向降级', async () => {
  const pageStore = usePageStore()
  await pageStore.createPage('P', 'normal')
  const ourPage = pageStore.pages[pageStore.pages.length - 1]
  await pageStore.createPage('X', 'normal')
  const targetPage = pageStore.pages[pageStore.pages.length - 1]

  const selection = useCrossBlockSelection()

  // 主页 block：双向 typed-link
  const block1 = await blockStore.createBlock({
    pageId: ourPage.id,
    content: 'see [[X]]^(depends-on<->required-by)'
  })
  // 目标页 block：含反向引用
  const targetBlock = await blockStore.createBlock({
    pageId: targetPage.id,
    content: 'reverse [[P]]^(required-by)'
  })

  selection.anchorIds.add(block1.id)
  await selection.deleteSelected()

  // 目标页 block 应被降级
  const after = blockStore.blocks.find(b => b.id === targetBlock.id)
  expect(after?.content).toBe('reverse [[P]]')
  // 选区应被清空
  expect(selection.anchorIds.size).toBe(0)
})
```

- [ ] **步骤 2：运行测试，验证新增断言通过**

执行命令：`cd comind && npx vitest run src/composables/useCrossBlockSelection.test.ts`

预期结果：新增的 1 个测试通过，已有 33 个测试无回归。

- [ ] **步骤 3：在 Block/index.test.ts 中增 cleanup 集成断言**

打开 `comind/src/components/Block/index.test.ts`，在 `describe('Block - rel-type-label click handling', ...)` 之后追加新的 describe 块：

```ts
describe('Block - handleDelete 关系清理集成', () => {
  let blockStore: ReturnType<typeof useBlockStore>
  let pageStore: ReturnType<typeof usePageStore>
  const PAGE_TITLE = 'P'  // 本页面 title，匹配 block 中 [[P]]
  const TARGET_TITLE = 'X' // 目标页面 title，匹配 block 中 [[X]]

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    blockStore = useBlockStore()
    pageStore = usePageStore()
    // 创建本页面（P）和目标页面（X）
    await pageStore.createPage(PAGE_TITLE, 'normal')
    const ourPage = pageStore.pages[pageStore.pages.length - 1]
    await pageStore.createPage(TARGET_TITLE, 'normal')
    const targetPage = pageStore.pages[pageStore.pages.length - 1]

    // 注入主页 block
    blockStore.blocks.push({
      id: 'block-del',
      pageId: ourPage.id,
      parentId: null,
      pos: 1000,
      content: 'see [[X]]^(depends-on<->required-by)',
      format: {},
      type: 'bullet',
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    // 注入目标页 block（含反向引用）
    blockStore.blocks.push({
      id: 'block-target',
      pageId: targetPage.id,
      parentId: null,
      pos: 1000,
      content: 'reverse [[P]]^(required-by)',
      format: {},
      type: 'bullet',
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
  })

  it('删除带 typed-link 的 block 后应触发跨页反向降级', async () => {
    const targetBlockBefore = blockStore.blocks.find(b => b.id === 'block-target')!
    const wrapper = mount(Block, {
      props: {
        node: {
          id: 'block-del',
          block: blockStore.blocks.find(b => b.id === 'block-del')!,
          children: []
        },
        pageId: targetBlockBefore.pageId, // 实际是 ourPage.id
        depth: 0
      },
      global: {
        stubs: { BulletRender: StubBulletRender }
      }
    })
    await flushPromises()

    // 直接调用暴露的 handleDelete 方法
    await (wrapper.vm as any).handleDelete()

    // 主页 block 应被删除
    expect(blockStore.blocks.find(b => b.id === 'block-del')).toBeUndefined()
    // 目标页 block 应被降级
    const after = blockStore.blocks.find(b => b.id === 'block-target')
    expect(after?.content).toBe('reverse [[P]]')

    wrapper.unmount()
  })
})
```

- [ ] **步骤 4：运行测试，验证新增断言通过**

执行命令：`cd comind && npx vitest run src/components/Block/index.test.ts`

预期结果：新增的 1 个集成测试通过，已有 3 个测试无回归。

- [ ] **步骤 5：提交代码**

```bash
git add comind/src/composables/useCrossBlockSelection.test.ts comind/src/components/Block/index.test.ts
git commit -m "test(cleanup): add integration assertions for handleDelete and deleteSelected"
```

---

### Task 7：编译检查与全量回归

- [ ] **步骤 1：运行 TypeScript 类型检查**

执行命令：`cd comind && npx vue-tsc -b`

预期结果：无类型错误。

- [ ] **步骤 2：运行 Vite 构建**

执行命令：`cd comind && npm run build`

预期结果：构建成功，无错误。

- [ ] **步骤 3：运行全量单元测试**

执行命令：`cd comind && npx vitest run`

预期结果：本次修改相关的测试（useBlockRelationshipCleanup、useRelationshipSync、useCrossBlockSelection、Block/index、Block/handlers/*）全部通过。仓库中预存的失败（indexedDB.test.ts、useRecent.test.ts 等）与本方案无关，不应新增。

- [ ] **步骤 4：提交收尾（如有遗漏）**

```bash
git status
# 如有未提交文件，单独 commit
```

---

## 自查记录

| 检查项 | 状态 |
|--------|------|
| 规范覆盖性 — 跨页反向降级 ✓ | Task 3 |
| 规范覆盖性 — 同页快照检查（仍含 typed-link → 跳过）✓ | Task 3 步骤 1 stillHasTypedLink 分支 |
| 规范覆盖性 — 单向 ^(depends-on) 不参与清理 ✓ | Task 3 步骤 1 inverseRelationshipType === null 跳过 |
| 规范覆盖性 — 目标去重 ✓ | Task 3 步骤 1 targetSet Map |
| 规范覆盖性 — 工具函数 export 复用 ✓ | Task 1 |
| 集成点 1：Block/index.vue handleDelete ✓ | Task 4 |
| 集成点 2：useCrossBlockSelection.deleteSelected ✓ | Task 5 |
| 集成测试覆盖 ✓ | Task 6 |
| 编译检查（vue-tsc + vite build）✓ | Task 7 |
| 无占位内容 ✓ | — |
| 类型一致性 ✓ | `OrphanedTarget` / `CleanupResult` 在两处使用一致；`applyRelationshipTypeToBlockContent` 签名不变 |

## 执行交接

方案已完成，保存至 `docs/superpowers/plans/2026-06-04-block-delete-relationship-cleanup.md`。启动子智能体驱动执行。
