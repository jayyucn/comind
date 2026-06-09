# 模板系统 Plan 2：B 集成层 实施方案

> **面向智能体执行者：必须使用子技能**：通过 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
>
> **目标**：将 Plan 1 产出的核心引擎接入应用层——构建模板注册表（合并内置+用户）、将模板注册为斜杠命令、扩展 SlashCommandMenu 支持 `/template list` 子视图、构建用户模板 Pinia store。
> **架构**：useTemplateRegistry（合并层）→ useSlashCommands（注册命令）→ SlashCommandMenu（UI 调度）→ userTemplatesStore（CRUD）→ blocksStore.createBlock（写入）。
> **技术栈**：Vue 3 + TypeScript + Pinia + Vitest
>
> **前置依赖**：[Plan 1：A 核心引擎](docs/superpowers/plans/2026-06-05-template-system-plan-a.md) 全部完成
>
> **相关文件：**
> - `docs/superpowers/specs/2026-06-05-template-system-design.md` — 设计文档
> - `docs/superpowers/plans/2026-06-05-template-system-plan-c.md` — UI 层（依赖本方案产出）
> - `docs/superpowers/plans/2026-06-05-template-system-plan-d.md` — 验证

---

## 文件结构

```
src/composables/
├── useSlashCommands.ts                # 修改：导出 buildTemplateCommands 函数
└── useTemplateRegistry.ts             # 新建：合并内置+用户模板

src/composables/__tests__/
└── useTemplateRegistry.test.ts        # 新建

src/stores/
├── user-templates.ts                  # 新建：用户模板 CRUD（Pinia）
└── blocks.ts                          # 不修改（直接使用 createBlock 即可）

src/stores/__tests__/
└── user-templates.test.ts             # 新建

src/components/
└── SlashCommandMenu.vue               # 修改：支持 /template list 子视图 + 模板命令执行
```

---

## 任务 1：实现 `useTemplateRegistry` composable

**涉及文件：**
- 新建：`comind/src/composables/useTemplateRegistry.ts`
- 新建：`comind/src/composables/__tests__/useTemplateRegistry.test.ts`

- [ ] **步骤 1：编写失败测试**

新建 `comind/src/composables/__tests__/useTemplateRegistry.test.ts`：

```typescript
import { describe, test, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'

// 在引入 user-templates store 前 mock db
vi.mock('../../storage/db', () => ({
  db: {
    templates: {
      toArray: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }
  }
}))

import { useTemplateRegistry } from '../useTemplateRegistry'
import { useUserTemplatesStore } from '../../stores/user-templates'
import { BUILTIN_TEMPLATES } from '../../config/builtin-templates'
import type { UserTemplate } from '../../types/template'

describe('useTemplateRegistry', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('仅内置模板时返回 10 个归一化模板', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    const registry = useTemplateRegistry()
    const list = await registry.loadAll()
    expect(list.length).toBe(10)
    expect(list.every(t => t.source === 'builtin')).toBe(true)
  })

  test('内置 + 用户模板合并：用户优先', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = [{
      id: 'user-1',
      name: '我的会议',
      category: 'custom',
      sourcePageId: 'p1',
      blocks: [{ type: 'bullet', content: 'my variant' }],
      createdAt: 0,
      updatedAt: 0,
    }]
    const registry = useTemplateRegistry()
    const list = await registry.loadAll()
    expect(list.length).toBe(11)
    const userTpl = list.find(t => t.id === 'user:user-1')
    expect(userTpl).toBeDefined()
    expect(userTpl?.source).toBe('user')
    expect(userTpl?.blocks[0].content).toBe('my variant')
  })

  test('用户模板 ID 加 user: 前缀避免与内置冲突', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = [{
      id: 'abc',
      name: 'X',
      category: 'custom',
      sourcePageId: 'p',
      blocks: [],
      createdAt: 0, updatedAt: 0,
    }]
    const registry = useTemplateRegistry()
    const list = await registry.loadAll()
    const ids = list.map(t => t.id)
    expect(ids).toContain('user:abc')
    expect(ids).not.toContain('abc')  // 不与可能的内置 ID 冲突
  })

  test('getById 优先返回用户模板（若 ID 相同）', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = [{
      id: 'meeting-notes',  // 故意与内置同名
      name: '我的会议（覆盖内置）',
      category: 'custom',
      sourcePageId: 'p',
      blocks: [{ type: 'bullet', content: 'override' }],
      createdAt: 0, updatedAt: 0,
    }]
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const t = registry.getById('user:meeting-notes')
    expect(t).toBeDefined()
    expect(t?.source).toBe('user')
    expect(t?.blocks[0].content).toBe('override')
  })

  test('getById 找不到时返回 undefined', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    const registry = useTemplateRegistry()
    await registry.loadAll()
    expect(registry.getById('non-existent')).toBeUndefined()
  })

  test('searchByText 按 name + alias + description 匹配（大小写不敏感）', async () => {
    const userStore = useUserTemplatesStore()
    userStore.templates = []
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const results = registry.searchByText('MEETING')
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(t => t.id === 'meeting-notes')).toBe(true)
  })
})
```

- [ ] **步骤 2：运行测试，验证执行失败**

执行命令：`cd comind && npx vitest run src/composables/__tests__/useTemplateRegistry.test.ts`

预期结果：测试因 `Cannot find module '../useTemplateRegistry'` 失败。

- [ ] **步骤 3：先创建空的 user-templates store（占位）**

新建 `comind/src/stores/user-templates.ts`（先放最小可用的 store 骨架，Task 3 会扩展）：

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UserTemplate } from '../types/template'
import { db } from '../storage/db'

export const useUserTemplatesStore = defineStore('user-templates', () => {
  const templates = ref<UserTemplate[]>([])

  async function loadAll(): Promise<void> {
    templates.value = await db.templates.toArray()
  }

  return { templates, loadAll }
})
```

- [ ] **步骤 4：实现 `useTemplateRegistry.ts`**

新建 `comind/src/composables/useTemplateRegistry.ts`：

```typescript
import { computed, ref, type ComputedRef } from 'vue'
import { BUILTIN_TEMPLATES } from '../config/builtin-templates'
import type { NormalizedTemplate, BuiltinTemplate, UserTemplate } from '../types/template'
import { useUserTemplatesStore } from '../stores/user-templates'

/**
 * 模板注册表 composable
 *
 * 职责：
 * 1. 合并内置 + 用户模板为统一的 NormalizedTemplate[]
 * 2. 提供 getById / searchByText 查询接口
 * 3. 用户模板 ID 加 `user:` 前缀避免与内置冲突
 * 4. 同 ID 时用户模板优先（最新创建）
 */
export function useTemplateRegistry() {
  const userStore = useUserTemplatesStore()
  const all = ref<NormalizedTemplate[]>([])
  const loaded = ref(false)

  const builtinAsNormalized: NormalizedTemplate[] = BUILTIN_TEMPLATES.map((t: BuiltinTemplate) => ({
    id: t.id,
    name: t.name,
    aliases: t.aliases,
    category: t.category,
    description: t.description,
    icon: t.icon,
    source: 'builtin' as const,
    blocks: t.blocks,
  }))

  /**
   * 加载并合并所有模板。
   * 每次调用都重新计算（用户模板变化时需重调）。
   */
  async function loadAll(): Promise<NormalizedTemplate[]> {
    if (!userStore.templates || userStore.templates.length === 0) {
      // 仍然尝试从 db 加载（兜底）
      try {
        await userStore.loadAll()
      } catch {
        // 忽略
      }
    }

    const userAsNormalized: NormalizedTemplate[] = userStore.templates.map((t: UserTemplate) => ({
      id: `user:${t.id}`,
      name: t.name,
      aliases: undefined,
      category: t.category,
      description: t.description ?? '',
      icon: '📄',
      source: 'user' as const,
      blocks: t.blocks,
    }))

    // 用户模板排前，内置模板在后
    all.value = [...userAsNormalized, ...builtinAsNormalized]
    loaded.value = true
    return all.value
  }

  function getById(id: string): NormalizedTemplate | undefined {
    return all.value.find(t => t.id === id)
  }

  function searchByText(query: string): NormalizedTemplate[] {
    if (!query) return all.value
    const lower = query.toLowerCase()
    return all.value.filter(t => {
      if (t.name.toLowerCase().includes(lower)) return true
      if (t.description.toLowerCase().includes(lower)) return true
      if (t.aliases?.some(a => a.toLowerCase().includes(lower))) return true
      return false
    })
  }

  const isLoaded: ComputedRef<boolean> = computed(() => loaded.value)

  return { all, isLoaded, loadAll, getById, searchByText }
}
```

- [ ] **步骤 5：运行测试，验证执行通过**

执行命令：`cd comind && npx vitest run src/composables/__tests__/useTemplateRegistry.test.ts`

预期结果：所有测试通过。

- [ ] **步骤 6：提交代码**

```bash
cd comind
git add src/composables/useTemplateRegistry.ts src/composables/__tests__/useTemplateRegistry.test.ts src/stores/user-templates.ts
git commit -m "feat(template): add useTemplateRegistry composable with builtin+user merge"
```

---

## 任务 2：扩展 `useSlashCommands` 提供模板命令构建

**涉及文件：**
- 修改：`comind/src/composables/useSlashCommands.ts`

- [ ] **步骤 1：在 `useSlashCommands.ts` 末尾追加模板命令构建函数**

读取 `comind/src/composables/useSlashCommands.ts` 末尾（在第 468 行 `]` 之后），追加：

```typescript
// ─── 模板命令构建（Plan 2：模板系统集成） ─────────────────────
import { useTemplateRegistry } from './useTemplateRegistry'
import { TemplateRenderer } from '../services/template-renderer'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { generateUUID } from '../utils/id'

/**
 * 触发模板插入的执行函数。
 * 由 SlashCommandMenu 的 executeCommand 在识别到 templateId 时调用。
 */
export async function executeTemplateCommand(
  blockId: string | undefined,
  templateId: string,
  editorInstance: Editor,
  range: { from: number; to: number }
): Promise<void> {
  if (!blockId) return

  const registry = useTemplateRegistry()
  if (!registry.isLoaded.value) {
    await registry.loadAll()
  }
  const template = registry.getById(templateId)
  if (!template) {
    console.warn(`[executeTemplateCommand] Template not found: ${templateId}`)
    return
  }

  const blockStore = useBlockStore()
  const editorStore = useEditorStore()
  const allBlocks = blockStore.blocks
  const anchor = allBlocks.find(b => b.id === blockId)
  if (!anchor) {
    console.warn(`[executeTemplateCommand] Anchor block not found: ${blockId}`)
    return
  }

  // 1. 清除斜杠命令文本
  const editor = editorInstance
  editor.chain()
    .deleteRange(range)
    .focus()
    .run()

  // 2. 构建上下文 + 渲染
  const pageTitle = anchor.pageId // 简化：实际可用 pageStore.getPage(anchor.pageId)?.title
  const context = await TemplateRenderer.buildContext(pageTitle)
  const drafts = TemplateRenderer.render(template, context, anchor)

  // 3. 写入 blocks（按 pos 倒序插入，保证递增）
  const sortedDrafts = [...drafts].sort((a, b) => b.pos - a.pos)
  const newIds: string[] = []
  for (const draft of sortedDrafts) {
    const created = await blockStore.createBlock({
      pageId: draft.pageId,
      parentId: draft.parentId,
      pos: draft.pos,
      content: draft.content,
      format: draft.format,
      type: draft.type,
      properties: draft.properties,
    })
    newIds.push(created.id)
  }

  // 4. 定位到第一个含 cursorMarker 的 Block（若有）
  const firstCursor = drafts.find(d => d.cursorMarker === '__CURSOR__')
  if (firstCursor) {
    const targetBlock = blockStore.blocks.find(b => b.pos === firstCursor.pos && b.pageId === firstCursor.pageId)
    if (targetBlock) {
      // 找 content 中 __CURSOR__ 的位置
      const markerIdx = targetBlock.content.indexOf('__CURSOR__')
      if (markerIdx >= 0) {
        // 聚焦并定位光标
        editorStore.setActiveBlock(targetBlock.id)
        // 简化：未来在 editorStore 增加 setCursorInBlock API
      } else {
        editorStore.setActiveBlock(targetBlock.id)
      }
    }
  } else {
    // 聚焦到第一个新 Block
    const firstNewBlockId = newIds[newIds.length - 1]  // 倒序插入后，最后 push 的是 pos 最小
    if (firstNewBlockId) {
      editorStore.setActiveBlock(firstNewBlockId)
    }
  }
}

/**
 * 为所有 NormalizedTemplate 构建对应的 Command[]。
 * 调用方在 useSlashCommands().commands 中 spread 引入。
 */
export function buildTemplateCommands(): Command[] {
  const registry = useTemplateRegistry()
  // 注意：调用方需先 await registry.loadAll()，否则 templates 为空
  return registry.all.value.map((t): Command => ({
    id: `template:${t.id}`,
    name: t.name,
    alias: ['template', 'tpl', ...(t.aliases ?? []), t.id.replace('user:', '')],
    group: '模板',
    icon: t.icon,
    action: ({ editor, range, blockId }) => {
      void executeTemplateCommand(blockId, t.id, editor, range)
    },
  }))
}
```

同时在文件顶部 import 区域追加 `import type { Editor } from '@tiptap/vue-3'`（如果还未导入）。

- [ ] **步骤 2：运行 TypeScript 编译验证**

执行命令：`cd comind && npx vue-tsc --noEmit`

预期结果：编译通过，无类型错误。

- [ ] **步骤 3：运行 lint 验证**

执行命令：`cd comind && npm run lint -- src/composables/useSlashCommands.ts`

预期结果：无 lint 错误。

- [ ] **步骤 4：提交代码**

```bash
cd comind
git add src/composables/useSlashCommands.ts
git commit -m "feat(template): add executeTemplateCommand and buildTemplateCommands to useSlashCommands"
```

---

## 任务 3：扩展 user-templates store 增加 CRUD

**涉及文件：**
- 修改：`comind/src/stores/user-templates.ts`

- [ ] **步骤 1：扩展 store 增加 create / remove / rename 方法**

替换 `comind/src/stores/user-templates.ts` 全文为：

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UserTemplate } from '../types/template'
import { db } from '../storage/db'
import { generateUUID } from '../utils/id'

export interface CreateTemplateInput {
  name: string
  description?: string
  category?: string
  sourcePageId: string
  blocks: UserTemplate['blocks']
}

export const useUserTemplatesStore = defineStore('user-templates', () => {
  const templates = ref<UserTemplate[]>([])

  async function loadAll(): Promise<void> {
    templates.value = await db.templates.toArray()
  }

  async function create(input: CreateTemplateInput): Promise<UserTemplate> {
    const now = Date.now()
    const record: UserTemplate = {
      id: generateUUID(),
      name: input.name,
      description: input.description,
      category: input.category ?? 'custom',
      sourcePageId: input.sourcePageId,
      blocks: input.blocks,
      createdAt: now,
      updatedAt: now,
    }
    await db.templates.put(record)
    templates.value = [...templates.value, record]
    return record
  }

  async function remove(id: string): Promise<void> {
    await db.templates.delete(id)
    templates.value = templates.value.filter(t => t.id !== id)
  }

  async function rename(id: string, newName: string): Promise<void> {
    const idx = templates.value.findIndex(t => t.id === id)
    if (idx === -1) return
    const updated = { ...templates.value[idx], name: newName, updatedAt: Date.now() }
    await db.templates.put(updated)
    templates.value.splice(idx, 1, updated)
  }

  async function update(id: string, patch: Partial<Omit<UserTemplate, 'id' | 'createdAt'>>): Promise<void> {
    const idx = templates.value.findIndex(t => t.id === id)
    if (idx === -1) return
    const updated = { ...templates.value[idx], ...patch, updatedAt: Date.now() }
    await db.templates.put(updated)
    templates.value.splice(idx, 1, updated)
  }

  return { templates, loadAll, create, remove, rename, update }
})
```

- [ ] **步骤 2：编写 store CRUD 单元测试**

新建 `comind/src/stores/__tests__/user-templates.test.ts`：

```typescript
import { describe, test, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { useUserTemplatesStore } from '../user-templates'
import { db } from '../../storage/db'
import type { UserTemplate } from '../../types/template'

describe('user-templates store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.delete()
    await db.open()
  })

  test('create 写入 db 并更新内存', async () => {
    const store = useUserTemplatesStore()
    const t = await store.create({
      name: 'Test',
      sourcePageId: 'p1',
      blocks: [{ type: 'bullet', content: 'hi' }],
    })
    expect(t.id).toBeTruthy()
    expect(t.category).toBe('custom')
    expect(store.templates.length).toBe(1)
    const fromDb = await db.templates.get(t.id)
    expect(fromDb).toBeDefined()
  })

  test('loadAll 从 db 加载', async () => {
    const seed: UserTemplate = {
      id: 't1', name: 'A', category: 'work', sourcePageId: 'p',
      blocks: [], createdAt: 0, updatedAt: 0,
    }
    await db.templates.put(seed)
    const store = useUserTemplatesStore()
    await store.loadAll()
    expect(store.templates.length).toBe(1)
    expect(store.templates[0].id).toBe('t1')
  })

  test('remove 从 db 与内存同时删除', async () => {
    const store = useUserTemplatesStore()
    const t = await store.create({ name: 'X', sourcePageId: 'p', blocks: [] })
    await store.remove(t.id)
    expect(store.templates.length).toBe(0)
    const fromDb = await db.templates.get(t.id)
    expect(fromDb).toBeUndefined()
  })

  test('rename 修改 name 并更新 updatedAt', async () => {
    const store = useUserTemplatesStore()
    const t = await store.create({ name: 'Old', sourcePageId: 'p', blocks: [] })
    await new Promise(r => setTimeout(r, 5))
    await store.rename(t.id, 'New')
    const after = store.templates.find(x => x.id === t.id)
    expect(after?.name).toBe('New')
    expect(after?.updatedAt).toBeGreaterThan(t.createdAt)
  })

  test('update 部分字段', async () => {
    const store = useUserTemplatesStore()
    const t = await store.create({
      name: 'A', sourcePageId: 'p',
      blocks: [{ type: 'bullet', content: 'x' }],
    })
    await store.update(t.id, { description: 'new desc', category: 'work' })
    const after = store.templates.find(x => x.id === t.id)
    expect(after?.description).toBe('new desc')
    expect(after?.category).toBe('work')
    expect(after?.blocks[0].content).toBe('x')  // 未改
  })

  test('rename 不存在的 ID 不报错', async () => {
    const store = useUserTemplatesStore()
    await store.rename('non-existent', 'New')
    expect(store.templates.length).toBe(0)
  })
})
```

- [ ] **步骤 3：运行测试，验证执行通过**

执行命令：`cd comind && npx vitest run src/stores/__tests__/user-templates.test.ts`

预期结果：所有测试通过。

- [ ] **步骤 4：运行 Task 1 的 registry 测试，确保未破坏**

执行命令：`cd comind && npx vitest run src/composables/__tests__/useTemplateRegistry.test.ts`

预期结果：仍全部通过（Task 3 扩展 store 不会影响 registry 行为）。

- [ ] **步骤 5：提交代码**

```bash
cd comind
git add src/stores/user-templates.ts src/stores/__tests__/user-templates.test.ts
git commit -m "feat(template): add CRUD operations to user-templates store"
```

---

## 任务 4：在 `SlashCommandMenu.vue` 中注册模板命令 + 支持子视图

**涉及文件：**
- 修改：`comind/src/components/SlashCommandMenu.vue`

- [ ] **步骤 1：修改 import 与 setup 部分**

在 `comind/src/components/SlashCommandMenu.vue` 顶部 `<script setup>` 中，修改 import 行：

原：
```ts
import { useSlashCommands, filterCommands, groupCommands, parseCommandInput } from '../composables/useSlashCommands'
```

改为：
```ts
import { useSlashCommands, filterCommands, groupCommands, parseCommandInput, buildTemplateCommands, executeTemplateCommand } from '../composables/useSlashCommands'
import { useTemplateRegistry } from '../composables/useTemplateRegistry'
```

- [ ] **步骤 2：在 setup 中添加 registry 实例 + 模板命令列表**

在 `const { commands } = useSlashCommands()` 行**之后**追加：

```ts
const templateRegistry = useTemplateRegistry()
const templateCommands = ref<Command[]>([])

onMounted(async () => {
  await templateRegistry.loadAll()
  templateCommands.value = buildTemplateCommands()
})

// 合并基础命令 + 模板命令
const allCommands = computed(() => [...commands.value, ...templateCommands.value])

// 替换原 filteredCommands / flatCommands 引用
// 注：原代码用 commands 而非 allCommands，下一步会改
```

- [ ] **步骤 3：替换 `filteredCommands` 和 `flatCommands` 的引用**

将 `filteredCommands` computed 中的 `commands` 改为 `allCommands`：

```ts
const filteredCommands = computed(() => {
  return filterCommands(query.value, allCommands.value)
})
```

将 `flatCommands` 改为：
```ts
const flatCommands = computed(() => filteredCommands.value)
```
（已如此，保留即可）

- [ ] **步骤 4：在 `executeCommand` 中识别模板命令并执行**

在 `executeCommand` 函数开头（`const editor = editorStore.activeEditor` 之前）追加：

```ts
// 模板命令特殊处理
if (command.id.startsWith('template:')) {
  const templateId = command.id.slice('template:'.length)
  await executeTemplateCommand(blockId ?? undefined, templateId, editor, range.value ?? { from: 0, to: 0 })
  close()
  return
}
```

- [ ] **步骤 5：添加 `/template list` 子视图状态**

在 setup 顶部 import `ref` 已经存在（确认）。在本地状态区添加：

```ts
const isTemplateListView = ref(false)
const templateListData = computed(() => {
  if (!isTemplateListView.value) return []
  return templateRegistry.all.value
})
```

- [ ] **步骤 6：在 `updateQuery` 中检测 `template list`**

在 `updateQuery` 函数末尾追加：

```ts
// 检测 /template list
if (query.value.trim() === 'template list') {
  isTemplateListView.value = true
}
```

- [ ] **步骤 7：修改 `close` 函数重置子视图**

```ts
function close() {
  visible.value = false
  query.value = ''
  selectedIndex.value = 0
  range.value = null
  isTemplateListView.value = false
}
```

- [ ] **步骤 8：模板 `<template>` 中根据 `isTemplateListView` 切换渲染**

在 `<div class="slash-command-list" ref="listRef">` 内部，原有 `<template v-for="[group, cmds] in groupedCommands">` 之前**插入**：

```vue
<template v-if="isTemplateListView">
  <div class="slash-command-group">
    <div class="slash-command-group-title">我的模板（点击使用）</div>
    <div
      v-for="t in templateListData"
      :key="t.id"
      class="slash-command-item template-item"
      :class="{ selected: selectedIndex === templateListData.indexOf(t) }"
      @click="useTemplateFromList(t.id)"
      @mouseenter="selectedIndex = templateListData.indexOf(t)"
    >
      <span class="template-icon">{{ t.icon }}</span>
      <span class="template-name">{{ t.name }}</span>
      <span class="template-source">[{{ t.source === 'builtin' ? '内置' : '我的' }}]</span>
      <button class="template-delete" @click.stop="deleteTemplateFromList(t.id)">×</button>
    </div>
  </div>
</template>
<template v-else>
  <!-- 原 groupedCommands 渲染块 -->
  <template v-for="[group, cmds] in groupedCommands" :key="group">
    <!-- ...原内容保持不变... -->
  </template>
</template>
```

- [ ] **步骤 9：添加 useTemplateFromList / deleteTemplateFromList 函数**

在 setup 中追加：

```ts
import { useUserTemplatesStore } from '../stores/user-templates'

const userTemplatesStore = useUserTemplatesStore()

async function useTemplateFromList(templateId: string) {
  const blockId = editorStore.activeBlockId
  const editor = editorStore.activeEditor
  const range = range.value ?? { from: 0, to: 0 }
  if (!editor) return
  await executeTemplateCommand(blockId ?? undefined, templateId, editor, range)
  close()
}

async function deleteTemplateFromList(templateId: string) {
  // 仅 user 模板可删除
  if (!templateId.startsWith('user:')) {
    alert('内置模板不可删除')
    return
  }
  const id = templateId.slice('user:'.length)
  if (!confirm('确定删除该模板？')) return
  await userTemplatesStore.remove(id)
  await templateRegistry.loadAll()  // 刷新
}
```

- [ ] **步骤 10：运行 TypeScript 编译验证**

执行命令：`cd comind && npx vue-tsc -b`

预期结果：编译通过。

- [ ] **步骤 11：运行 lint 验证**

执行命令：`cd comind && npm run lint -- src/components/SlashCommandMenu.vue`

预期结果：无 lint 错误（可能需要修复 `confirm`/`alert` 的类型，替换为 `window.confirm`/`window.alert`）。

- [ ] **步骤 12：运行全量测试**

执行命令：`cd comind && npm run test`

预期结果：所有测试通过。

- [ ] **步骤 13：提交代码**

```bash
cd comind
git add src/components/SlashCommandMenu.vue
git commit -m "feat(template): integrate template commands into SlashCommandMenu with sub-view"
```

---

## 任务 5：端到端验证（Plan 2 收尾）

- [ ] **步骤 1：运行全量单元测试**

执行命令：`cd comind && npm run test`

预期结果：所有测试通过（5 个新测试文件 + 已有测试）。

- [ ] **步骤 2：运行 TypeScript 编译**

执行命令：`cd comind && npx vue-tsc -b`

预期结果：编译通过。

- [ ] **步骤 3：运行 lint**

执行命令：`cd comind && npm run lint`

预期结果：无 lint 错误。

- [ ] **步骤 4：手动 smoke test（在浏览器中）**

执行命令：`cd comind && npm run dev`

打开浏览器：
1. 进入任一 Page
2. 输入 `/template` → 应出现"模板"分组，含 10 个内置模板
3. 选择"会议记录" → 应在当前 Block 下方插入模板结构
4. 输入 `/template list` → 应切换到"我的模板"视图
5. 验证：内嵌 5 个预定义变量应已替换为实际值

- [ ] **步骤 5：Plan 2 收尾提交（如有未提交文件）**

```bash
cd comind
git status
```

---

## 验收清单

- [ ] `useTemplateRegistry` 正确合并内置 + 用户模板，用户 ID 加 `user:` 前缀
- [ ] `executeTemplateCommand` 能成功插入 BlockDraft[] 到 blocksStore
- [ ] `buildTemplateCommands` 生成的 Command 可被 `filterCommands` 正常检索
- [ ] `/template list` 切换到子视图，能列出/删除用户模板
- [ ] `userTemplatesStore` 的 CRUD 操作均通过测试
- [ ] `npm run test` + `npx vue-tsc -b` + `npm run lint` 全绿
- [ ] 浏览器中 `/template` 触发后菜单在 100ms 内显示

---

## 风险与注意

1. **`executeTemplateCommand` 中的 `setActiveBlock` 简化**：当前实现用 `editorStore.setActiveBlock`，未实际定位到 `__CURSOR__` 标记的文本位置。光标会落在 Block 开头而非 `__CURSOR__` 处。后续迭代可增强。
2. **`buildTemplateCommands` 在 onMounted 同步执行**：若用户模板在 App 启动后才从 db 加载完，菜单可能暂时不显示用户模板。`useTemplateRegistry` 通过 `await loadAll()` 等待，可在 `onMounted` 中确保顺序。
3. **`alert` / `confirm` 是浏览器原生**：替换为项目的 `useConfirm` composable（如已存在）或保留浏览器原生（低摩擦）。本方案先用浏览器原生。
4. **空 Block 树触发 `/template`**：anchor 是空 Block 时，模板插入后是空 Block → 模板的兄弟节点。无问题。

---

## 下一步

本方案产出物供 Plan 3（C UI 层）使用：
- `userTemplatesStore.create` / `remove` / `rename` / `update`
- `useTemplateRegistry` 的搜索/列表 API
- `SlashCommandMenu` 已支持 `/template list` 视图

执行完本方案后，继续 [Plan 3：C UI 层](docs/superpowers/plans/2026-06-05-template-system-plan-c.md)。
