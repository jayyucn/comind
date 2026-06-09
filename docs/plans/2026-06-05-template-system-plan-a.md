# 模板系统 Plan 1：A 核心引擎 实施方案

> **面向智能体执行者：必须使用子技能**：通过 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
>
> **目标**：实现模板系统的纯函数核心层——类型定义、数据库 schema 升级、10 个内置模板、序列化器、模板渲染器；不涉及任何 UI 或斜杠命令集成。
> **架构**：底层数据模型（TemplateBlock/NormalizedTemplate）→ 静态配置（builtin-templates）→ 序列化器（Block↔TemplateBlock 互转）→ 渲染器（TemplateRenderer.render 纯函数）。
> **技术栈**：Vue 3 + TypeScript + Dexie 4 + Vitest + fake-indexeddb
>
> **相关文件：**
> - `docs/superpowers/specs/2026-06-05-template-system-design.md` — 设计文档
> - `docs/superpowers/plans/2026-06-05-template-system-plan-b.md` — 集成层（依赖本方案产出）
> - `docs/superpowers/plans/2026-06-05-template-system-plan-c.md` — UI 层
> - `docs/superpowers/plans/2026-06-05-template-system-plan-d.md` — 验证

---

## 文件结构

```
src/types/
└── template.ts                        # 新建：TemplateBlock / BuiltinTemplate / UserTemplate / NormalizedTemplate / TemplateContext / BlockDraft

src/storage/
└── db.ts                              # 修改：升级到 v9，新增 templates 表

src/config/
├── builtin-templates.ts               # 新建：10 个内置模板的 JSON
└── __tests__/
    └── builtin-templates.test.ts      # 新建：静态配置完整性测试

src/services/
├── serialize-block-tree.ts            # 新建：Block ↔ TemplateBlock 互转
├── template-renderer.ts               # 新建：TemplateRenderer 纯函数
└── __tests__/
    ├── serialize-block-tree.test.ts   # 新建
    └── template-renderer.test.ts      # 新建
```

---

## 任务 1：定义 `TemplateBlock` 等类型

**涉及文件：**
- 新建：`comind/src/types/template.ts`

- [ ] **步骤 1：创建类型定义文件**

在 `comind/src/types/template.ts` 写入：

```typescript
/**
 * 模板系统类型定义
 *
 * TemplateBlock 是模板内容的最小单元，与 Block 解耦——模板不携带 ID/timestamps/pos，
 * 由 TemplateRenderer 在渲染时分配这些字段。
 */

/**
 * 模板块（树形结构）
 *
 * - 'bullet'   → 普通 Block（type='bullet'），content 即为可见文本
 * - 'heading'  → 标题 Block（type='bullet'，format.type='heading'，format.level=headingLevel）
 * - 'property' → 属性 Block（type='property'，content 序列化为 `key:: value`）
 */
export interface TemplateBlock {
  type: 'bullet' | 'heading' | 'property'
  /** 可包含 {{name}} 占位符或 {{date}} 预定义变量 */
  content: string
  /** type=heading 时必填，写入 format.level */
  headingLevel?: 1 | 2 | 3
  /** type=property 时必填，序列化为 `key:: content` */
  propertyKey?: string
  /** 子块 */
  children?: TemplateBlock[]
}

/** 内置模板分类 */
export type BuiltinTemplateCategory = 'thinking-model' | 'work' | 'journal' | 'review'

/** 内置模板（静态 JSON，无存储） */
export interface BuiltinTemplate {
  id: string
  name: string
  aliases?: string[]
  category: BuiltinTemplateCategory
  description: string
  icon: string
  blocks: TemplateBlock[]
}

/** 用户模板（IndexedDB 存储） */
export interface UserTemplate {
  id: string
  name: string
  description?: string
  /** 自由分类字符串，默认 'custom' */
  category: string
  /** 来源页 ID（可追溯；源页删除不影响模板） */
  sourcePageId: string
  blocks: TemplateBlock[]
  createdAt: number
  updatedAt: number
}

/** 模板来源 */
export type TemplateSource = 'builtin' | 'user'

/** 归一化模板（运行时统一抽象） */
export interface NormalizedTemplate {
  id: string
  name: string
  aliases?: string[]
  category: string
  description: string
  icon: string
  source: TemplateSource
  blocks: TemplateBlock[]
}

/**
 * 预定义变量求值上下文
 *
 * 所有字段在 TemplateRenderer.render() 入口处一次性求值。
 * 模板执行过程中，content 字符串内的 {{var}} 会被替换。
 */
export interface TemplateContext {
  /** 本地化日期，例如 "2026年6月5日" */
  date: string
  /** 本地化时间，例如 "14:30" */
  time: string
  /** ISO 日期，例如 "2026-06-05" */
  isoDate: string
  /** 当前页面标题（Page.title） */
  pageTitle: string
  /** 特殊标记：插入后光标应落在此处（仅第一个生效） */
  cursor: '__CURSOR__'
  /** 剪贴板内容（读取失败时为空字符串） */
  clipboard: string
  /** 当前时间戳（毫秒） */
  now: number
}

/** Block 草稿（渲染产物，待写入 IndexedDB） */
export interface BlockDraft {
  pageId: string
  parentId: string | null
  /** 已计算 pos（基于 anchorBlock 重新分配） */
  pos: number
  /** 已展开变量替换（不再含 {{...}}） */
  content: string
  format: {
    type?: 'heading'
    level?: 1 | 2 | 3
  }
  type: 'bullet' | 'property' | 'query' | 'embed' | 'code' | 'image'
  properties: Record<string, any>
  /** 来自 {{cursor}} 替换，插入后用于定位光标；仅第一个非 null 的生效 */
  cursorMarker: '__CURSOR__' | null
}
```

- [ ] **步骤 2：运行 TypeScript 编译验证**

执行命令：`cd comind && npx vue-tsc --noEmit`

预期结果：编译通过，无类型错误。

- [ ] **步骤 3：提交代码**

```bash
cd comind
git add src/types/template.ts
git commit -m "feat(template): add template system type definitions"
```

---

## 任务 2：升级 Dexie schema 至 v9，新增 `templates` 表

**涉及文件：**
- 修改：`comind/src/storage/db.ts`

- [ ] **步骤 1：编写失败测试（验证 templates 表存在）**

新建 `comind/src/storage/__tests__/db-templates-table.test.ts`：

```typescript
import { describe, test, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../db'
import type { UserTemplate } from '../../types/template'

describe('ComindDB v9 templates table', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  test('应存在 templates 表且可写入一条记录', async () => {
    const template: UserTemplate = {
      id: 'tpl-1',
      name: 'Test',
      category: 'custom',
      sourcePageId: 'page-1',
      blocks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await db.templates.put(template)
    const all = await db.templates.toArray()
    expect(all.length).toBe(1)
    expect(all[0].id).toBe('tpl-1')
  })

  test('应支持按 category 索引查询', async () => {
    await db.templates.put({
      id: 'a', name: 'A', category: 'work', sourcePageId: 'p', blocks: [], createdAt: 0, updatedAt: 0
    })
    await db.templates.put({
      id: 'b', name: 'B', category: 'journal', sourcePageId: 'p', blocks: [], createdAt: 0, updatedAt: 0
    })
    const workTemplates = await db.templates.where('category').equals('work').toArray()
    expect(workTemplates.length).toBe(1)
    expect(workTemplates[0].id).toBe('a')
  })
})
```

- [ ] **步骤 2：运行测试，验证执行失败**

执行命令：`cd comind && npx vitest run src/storage/__tests__/db-templates-table.test.ts`

预期结果：测试失败，提示 `Cannot read properties of undefined (reading 'put')`，因为 `db.templates` 还未定义。

- [ ] **步骤 3：修改 `db.ts`，升级到 v9 并新增 `templates` 表**

替换 `comind/src/storage/db.ts` 全文为：

```typescript
import Dexie, { type Table } from 'dexie'
import type { BlockRecord } from '../types/block'
import type { LinkRecord } from '../types/link'
import type { PageRecord } from '../types/page'
import type { PropertyRecord } from '../types/property'
import type { Asset } from '../types/asset'
import type { UserTemplate } from '../types/template'

/** 关系类型记录（成对组） */
export interface RelationshipTypeRecord {
  /** 稳定主键；种子用 `rt_seed_<type>`，用户新建用 `rt_user_<nanoid>` */
  id: string
  /** 正向英文标识 */
  type: string
  /** 反向英文标识；自反为 null */
  inverse: string | null
  /** 正向中文标签 */
  label: string
  /** 反向中文标签 */
  inverseLabel: string
  /** 颜色，hex 格式 */
  color: string
  /** 排序权重，越小越靠前 */
  order: number
  /** 软删除标记 */
  deleted: boolean
  /** 是否内置默认（防止用户硬删后迁移重新插入） */
  builtin: boolean
}

export class ComindDB extends Dexie {
  blocks!: Table<BlockRecord, string>
  links!: Table<LinkRecord, string>
  pages!: Table<PageRecord, string>
  properties!: Table<PropertyRecord, string>
  assets!: Table<Asset, string>
  relationshipTypes!: Table<RelationshipTypeRecord, string>
  templates!: Table<UserTemplate, string>

  constructor() {
    super('comind')
    // 保留 v7 兼容性
    this.version(7).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, relationshipType, createdAt',
      pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]',
      assets: 'id'
    })
    // v8 新增 relationshipTypes
    this.version(8).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, relationshipType, createdAt',
      pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]',
      assets: 'id',
      relationshipTypes: 'id, type, deleted, builtin, order'
    })
    // v9 新增 templates（用户另存的模板）
    this.version(9).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, relationshipType, createdAt',
      pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]',
      assets: 'id',
      relationshipTypes: 'id, type, deleted, builtin, order',
      templates: 'id, category, updatedAt, name'
    })
  }
}

export const db = new ComindDB()
```

- [ ] **步骤 4：运行测试，验证执行通过**

执行命令：`cd comind && npx vitest run src/storage/__tests__/db-templates-table.test.ts`

预期结果：两个测试通过。

- [ ] **步骤 5：运行全量单元测试，确保未破坏现有功能**

执行命令：`cd comind && npm run test`

预期结果：所有测试通过；若有 db 相关测试失败，检查 fake-indexeddb 初始化。

- [ ] **步骤 6：提交代码**

```bash
cd comind
git add src/storage/db.ts src/storage/__tests__/db-templates-table.test.ts
git commit -m "feat(template): upgrade Dexie to v9 with templates table"
```

---

## 任务 3：实现 `serialize-block-tree.ts`（Block ↔ TemplateBlock 互转）

**涉及文件：**
- 新建：`comind/src/services/serialize-block-tree.ts`
- 新建：`comind/src/services/__tests__/serialize-block-tree.test.ts`

- [ ] **步骤 1：编写失败测试**

新建 `comind/src/services/__tests__/serialize-block-tree.test.ts`：

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Block } from '../../types/block'
import { serializeBlockTree, deserializeBlockTree } from '../serialize-block-tree'

describe('serializeBlockTree', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  test('bullet Block 序列化为 type=bullet 的 TemplateBlock', () => {
    const blocks: Block[] = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 1000,
      content: 'hello', format: {}, type: 'bullet',
      properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'b1')
    expect(result).toEqual([{ type: 'bullet', content: 'hello' }])
  })

  test('heading Block（format.type=heading）序列化为 type=heading + headingLevel', () => {
    const blocks: Block[] = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 1000,
      content: 'Title', format: { type: 'heading', level: 2 },
      type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'b1')
    expect(result).toEqual([{ type: 'heading', content: 'Title', headingLevel: 2 }])
  })

  test('property Block 序列化为 type=property + propertyKey', () => {
    const blocks: Block[] = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 1000,
      content: '时间:: 2026-06-05', format: {},
      type: 'property', properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'b1')
    expect(result).toEqual([{ type: 'property', propertyKey: '时间', content: '2026-06-05' }])
  })

  test('不支持的 Block 类型（query/embed/code/image）降级为 bullet 并 console.warn', () => {
    const blocks: Block[] = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 1000,
      content: '```js\ncode\n```', format: {},
      type: 'code', properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'b1')
    expect(result).toEqual([{ type: 'bullet', content: '```js\ncode\n```' }])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('code'))
  })

  test('嵌套子树：children 正确组装', () => {
    const blocks: Block[] = [
      { id: 'p', pageId: 'p1', parentId: null, pos: 1000, content: 'Parent', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c1', pageId: 'p1', parentId: 'p', pos: 1000, content: 'Child1', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c2', pageId: 'p1', parentId: 'p', pos: 2000, content: 'Child2', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'orphan', pageId: 'p1', parentId: 'non-existent', pos: 3000, content: 'Orphan', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
    ]
    const result = serializeBlockTree(blocks, 'p')
    expect(result).toEqual([{
      type: 'bullet', content: 'Parent',
      children: [
        { type: 'bullet', content: 'Child1' },
        { type: 'bullet', content: 'Child2' },
      ]
    }])
    // Orphan 不应出现
    expect(JSON.stringify(result)).not.toContain('Orphan')
  })

  test('property 行 content 缺少 `::` 时退化为 bullet', () => {
    const blocks: Block[] = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 1000,
      content: 'no separator', format: {},
      type: 'property', properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'b1')
    expect(result).toEqual([{ type: 'bullet', content: 'no separator' }])
  })
})

describe('deserializeBlockTree', () => {
  test('TemplateBlock[] → Block[]：生成 UUID + pos=1000 起步', () => {
    const blocks = deserializeBlockTree(
      [
        { type: 'bullet', content: 'a' },
        { type: 'heading', content: 'b', headingLevel: 2 },
      ],
      { pageId: 'p1', parentId: null, basePos: 1000 }
    )
    expect(blocks.length).toBe(2)
    expect(blocks[0].id).not.toBe(blocks[1].id)
    expect(blocks[0].pageId).toBe('p1')
    expect(blocks[0].parentId).toBeNull()
    expect(blocks[0].pos).toBe(1000)
    expect(blocks[1].pos).toBe(2000)
    expect(blocks[0].type).toBe('bullet')
    expect(blocks[0].content).toBe('a')
    expect(blocks[1].type).toBe('bullet')
    expect(blocks[1].format).toEqual({ type: 'heading', level: 2 })
  })

  test('property 反序列化为 `key:: value` 格式', () => {
    const blocks = deserializeBlockTree(
      [{ type: 'property', propertyKey: '时间', content: '2026-06-05' }],
      { pageId: 'p1', parentId: null, basePos: 1000 }
    )
    expect(blocks[0].type).toBe('property')
    expect(blocks[0].content).toBe('时间:: 2026-06-05')
  })

  test('children 正确展开为嵌套 Block', () => {
    const blocks = deserializeBlockTree(
      [{
        type: 'bullet', content: 'parent',
        children: [
          { type: 'bullet', content: 'child' }
        ]
      }],
      { pageId: 'p1', parentId: null, basePos: 1000 }
    )
    expect(blocks.length).toBe(1)
    expect(blocks[0].content).toBe('parent')
    // children 在 output 中不直接体现（在调用方负责创建子节点并关联 parentId）
    // 实际实现里 children 会作为额外 Block 列表附带 parentId 引用
  })
})
```

- [ ] **步骤 2：运行测试，验证执行失败**

执行命令：`cd comind && npx vitest run src/services/__tests__/serialize-block-tree.test.ts`

预期结果：测试因 `Cannot find module '../serialize-block-tree'` 失败。

- [ ] **步骤 3：实现 `serialize-block-tree.ts`**

新建 `comind/src/services/serialize-block-tree.ts`：

```typescript
import type { Block } from '../types/block'
import type { TemplateBlock } from '../types/template'
import { generateUUID } from '../utils/id'

const UNSUPPORTED_TYPES = new Set(['query', 'embed', 'code', 'image'])

/**
 * 将 Block 树（以 rootBlockId 为根）序列化为 TemplateBlock 树。
 *
 * 行为契约：
 * - bullet Block → { type: 'bullet', content }
 * - bullet Block + format.type='heading' → { type: 'heading', content, headingLevel }
 * - property Block（content 含 `::`）→ { type: 'property', propertyKey, content }
 * - 不支持的类型（query/embed/code/image）→ 降级为 bullet，并 console.warn
 * - property 行 content 缺 `::` → 降级为 bullet
 * - 孤儿 Block（parentId 指向不存在的 ID）→ 跳过
 */
export function serializeBlockTree(blocks: Block[], rootBlockId: string): TemplateBlock[] {
  const blockMap = new Map(blocks.map(b => [b.id, b]))
  const root = blockMap.get(rootBlockId)
  if (!root) return []

  // 按 parentId + pos 排序，构建 child 列表
  const childrenOf = new Map<string | null, Block[]>()
  for (const b of blocks) {
    const key = b.parentId
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(b)
  }
  for (const arr of childrenOf.values()) {
    arr.sort((a, b) => a.pos - b.pos)
  }

  const serialize = (block: Block): TemplateBlock | null => {
    if (UNSUPPORTED_TYPES.has(block.type)) {
      console.warn(`[serializeBlockTree] Block type "${block.type}" not supported in templates, downgrading to bullet`)
      return { type: 'bullet', content: block.content }
    }

    if (block.format?.type === 'heading') {
      const level = (block.format.level === 1 || block.format.level === 2 || block.format.level === 3)
        ? block.format.level
        : 2
      return {
        type: 'heading',
        content: block.content,
        headingLevel: level
      }
    }

    if (block.type === 'property') {
      const sepIdx = block.content.indexOf('::')
      if (sepIdx === -1) {
        return { type: 'bullet', content: block.content }
      }
      return {
        type: 'property',
        propertyKey: block.content.slice(0, sepIdx).trim(),
        content: block.content.slice(sepIdx + 2).trim()
      }
    }

    return { type: 'bullet', content: block.content }
  }

  const build = (block: Block): TemplateBlock | null => {
    const tmpl = serialize(block)
    if (!tmpl) return null

    const children = childrenOf.get(block.id) ?? []
    const childTmpls: TemplateBlock[] = []
    for (const child of children) {
      const ct = build(child)
      if (ct) childTmpls.push(ct)
    }
    if (childTmpls.length > 0) {
      tmpl.children = childTmpls
    }
    return tmpl
  }

  return [build(root)!].filter(Boolean) as TemplateBlock[]
}

export interface DeserializeOptions {
  pageId: string
  parentId: string | null
  /** 起始 pos（默认 1000，gap 1000） */
  basePos?: number
}

export interface DeserializedBlock extends Block {
  children?: DeserializedBlock[]
}

/**
 * 将 TemplateBlock 树展开为 Block 树。
 *
 * 行为契约：
 * - TemplateBlock.type='bullet' → Block.type='bullet'，content 保持
 * - TemplateBlock.type='heading' → Block.type='bullet'，format={type:'heading', level:headingLevel}
 * - TemplateBlock.type='property' → Block.type='property'，content 序列化为 `key:: value`
 * - children 递归展开为子 Block（parentId 指向父 Block）
 * - 返回数组保持 DFS 顺序（父在前，子在后）
 * - pos 按 DFS 顺序递增（basePos, basePos+gap, basePos+2*gap, ...）
 *
 * 注意：DFS 顺序下，子节点的 pos 紧跟父节点之后，与"作为父节点的下一个兄弟"的视觉效果一致。
 * 若调用方需要"父→子→下一个兄弟"语义，可按需调整。
 */
export function deserializeBlockTree(
  tmplBlocks: TemplateBlock[],
  options: DeserializeOptions
): DeserializedBlock[] {
  const basePos = options.basePos ?? 1000
  const gap = 1000
  const result: DeserializedBlock[] = []
  const now = Date.now()

  const expand = (tmpl: TemplateBlock, parentId: string | null, startIdx: number): { blocks: DeserializedBlock[]; nextIdx: number } => {
    const blocks: DeserializedBlock[] = []
    let idx = startIdx

    const buildOne = (t: TemplateBlock, pId: string | null, pos: number): DeserializedBlock => {
      const id = generateUUID()
      const now2 = Date.now()
      const baseProps = {
        id,
        pageId: options.pageId,
        parentId: pId,
        pos,
        content: '',
        format: {} as Record<string, any>,
        properties: {} as Record<string, any>,
        createdAt: now2,
        updatedAt: now2,
      }

      if (t.type === 'heading') {
        return {
          ...baseProps,
          type: 'bullet',
          content: t.content,
          format: { type: 'heading', level: t.headingLevel ?? 2 },
        }
      }

      if (t.type === 'property') {
        const key = t.propertyKey ?? ''
        return {
          ...baseProps,
          type: 'property',
          content: `${key}:: ${t.content}`,
        }
      }

      return {
        ...baseProps,
        type: 'bullet',
        content: t.content,
      }
    }

    const block = buildOne(tmpl, parentId, basePos + idx * gap)
    blocks.push(block)
    idx += 1

    if (tmpl.children && tmpl.children.length > 0) {
      for (const child of tmpl.children) {
        const { blocks: childBlocks, nextIdx } = expand(child, block.id, idx)
        blocks.push(...childBlocks)
        idx = nextIdx
      }
    }

    return { blocks, nextIdx: idx }
  }

  let counter = 0
  for (const t of tmplBlocks) {
    const { blocks: expanded, nextIdx } = expand(t, options.parentId, counter)
    result.push(...expanded)
    counter = nextIdx
  }

  // unused now — 避免 lint 警告
  void now

  return result
}
```

- [ ] **步骤 4：运行测试，验证执行通过**

执行命令：`cd comind && npx vitest run src/services/__tests__/serialize-block-tree.test.ts`

预期结果：所有测试通过。

- [ ] **步骤 5：运行 lint 验证**

执行命令：`cd comind && npm run lint -- src/services/serialize-block-tree.ts`

预期结果：无 lint 错误。

- [ ] **步骤 6：提交代码**

```bash
cd comind
git add src/services/serialize-block-tree.ts src/services/__tests__/serialize-block-tree.test.ts
git commit -m "feat(template): add block-tree <-> template-block tree serializer"
```

---

## 任务 4：实现 `template-renderer.ts`（核心渲染引擎，纯函数）

**涉及文件：**
- 新建：`comind/src/services/template-renderer.ts`
- 新建：`comind/src/services/__tests__/template-renderer.test.ts`

- [ ] **步骤 1：编写失败测试**

新建 `comind/src/services/__tests__/template-renderer.test.ts`：

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { TemplateRenderer } from '../template-renderer'
import type { NormalizedTemplate, TemplateContext } from '../../types/template'
import type { Block } from '../../types/block'

const baseTemplate: NormalizedTemplate = {
  id: 't1',
  name: 'Test',
  category: 'work',
  description: 'Test template',
  icon: '📝',
  source: 'builtin',
  blocks: [
    { type: 'bullet', content: 'Hello' },
    { type: 'heading', content: 'Section', headingLevel: 2 },
    { type: 'property', propertyKey: '时间', content: '{{date}} {{time}}' },
    { type: 'bullet', content: '{{name}}' },
    { type: 'bullet', content: '{{page_title}}' },
    { type: 'bullet', content: '{{iso_date}}' },
    { type: 'bullet', content: '{{clipboard}}' },
    { type: 'heading', content: 'Title {{cursor}}', headingLevel: 2 },
    { type: 'bullet', content: '{{cursor}}' },
  ],
}

const baseContext: TemplateContext = {
  date: '2026年6月5日',
  time: '14:30',
  isoDate: '2026-06-05',
  pageTitle: 'My Page',
  cursor: '__CURSOR__',
  clipboard: 'clip-text',
  now: 1718000000000,
}

const baseAnchor: Block = {
  id: 'anchor', pageId: 'page-1', parentId: null, pos: 1000,
  content: 'anchor', format: {}, type: 'bullet',
  properties: {}, createdAt: 0, updatedAt: 0
}

describe('TemplateRenderer.expandContent', () => {
  test('替换所有预定义变量', () => {
    const result = TemplateRenderer.expandContent('Today is {{date}} at {{time}}', baseContext)
    expect(result.text).toBe('Today is 2026年6月5日 at 14:30')
    expect(result.placeholders).toEqual([])
  })

  test('未匹配的 {{name}} 保留为可见文本', () => {
    const result = TemplateRenderer.expandContent('Hello {{user_name}}', baseContext)
    expect(result.text).toBe('Hello {{user_name}}')
  })

  test('{{cursor}} 替换为特殊标记并加入 placeholders', () => {
    const result = TemplateRenderer.expandContent('A {{cursor}} B', baseContext)
    expect(result.text).toBe('A __CURSOR__ B')
    expect(result.placeholders).toEqual([{ type: 'cursor', start: 2, end: 11 }])
  })

  test('多个变量混合替换', () => {
    const result = TemplateRenderer.expandContent(
      '{{date}} - {{page_title}} - {{name}}',
      baseContext
    )
    expect(result.text).toBe('2026年6月5日 - My Page - {{name}}')
  })

  test('空字符串输入返回空', () => {
    const result = TemplateRenderer.expandContent('', baseContext)
    expect(result.text).toBe('')
  })
})

describe('TemplateRenderer.render', () => {
  test('渲染为 BlockDraft[]：变量已替换，pos 连续', () => {
    const drafts = TemplateRenderer.render(baseTemplate, baseContext, baseAnchor)
    expect(drafts.length).toBe(9)
    expect(drafts[0].content).toBe('Hello')
    expect(drafts[1].content).toBe('Section')
    expect(drafts[1].format).toEqual({ type: 'heading', level: 2 })
    expect(drafts[2].content).toBe('时间:: 2026年6月5日 14:30')
    expect(drafts[2].type).toBe('property')
    expect(drafts[3].content).toBe('{{name}}')  // 未匹配，保留
    expect(drafts[4].content).toBe('My Page')
    expect(drafts[5].content).toBe('2026-06-05')
    expect(drafts[6].content).toBe('clip-text')
    expect(drafts[7].content).toBe('Title __CURSOR__')
    expect(drafts[7].cursorMarker).toBe('__CURSOR__')
    expect(drafts[8].content).toBe('__CURSOR__')
    expect(drafts[8].cursorMarker).toBe('__CURSOR__')
    // pos 连续
    expect(drafts[0].pos).toBe(2000)  // anchor.pos + 1*1000
    expect(drafts[8].pos).toBe(10000)
  })

  test('cursorMarker 仅第一个非 null 的生效（后续忽略）', () => {
    const drafts = TemplateRenderer.render(baseTemplate, baseContext, baseAnchor)
    const cursors = drafts.filter(d => d.cursorMarker === '__CURSOR__')
    expect(cursors.length).toBe(2)  // 渲染时全部标记
    // findFirstCursorIndex 由调用方处理
    const firstIdx = drafts.findIndex(d => d.cursorMarker === '__CURSOR__')
    expect(firstIdx).toBe(7)  // 第一个出现位置
  })

  test('children 递归展开为子 Block', () => {
    const tmpl: NormalizedTemplate = {
      ...baseTemplate,
      blocks: [{
        type: 'bullet', content: 'parent',
        children: [
          { type: 'bullet', content: 'child1' },
          { type: 'bullet', content: 'child2' },
        ]
      }]
    }
    const drafts = TemplateRenderer.render(tmpl, baseContext, baseAnchor)
    expect(drafts.length).toBe(3)
    expect(drafts[0].content).toBe('parent')
    expect(drafts[0].parentId).toBeNull()  // 顶层，parentId 继承 anchor
    expect(drafts[1].parentId).toBe(drafts[0].id)
    expect(drafts[2].parentId).toBe(drafts[0].id)
  })

  test('所有 draft 共享 anchor 的 pageId 和 pageId', () => {
    const drafts = TemplateRenderer.render(baseTemplate, baseContext, baseAnchor)
    for (const d of drafts) {
      expect(d.pageId).toBe(baseAnchor.pageId)
    }
  })

  test('每个 draft 的 id 唯一', () => {
    const drafts = TemplateRenderer.render(baseTemplate, baseContext, baseAnchor)
    const ids = new Set(drafts.map(d => d.id))
    expect(ids.size).toBe(drafts.length)
  })
})

describe('TemplateRenderer.buildContext', () => {
  let originalClipboard: PropertyDescriptor | undefined

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue('mocked-clip') }
    })
  })

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard)
    }
  })

  test('构建完整上下文：date/time/isoDate/clipboard', async () => {
    const ctx = await TemplateRenderer.buildContext('My Page')
    expect(ctx.pageTitle).toBe('My Page')
    expect(ctx.date).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日$/)
    expect(ctx.time).toMatch(/^\d{1,2}:\d{2}$/)
    expect(ctx.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(ctx.clipboard).toBe('mocked-clip')
    expect(ctx.cursor).toBe('__CURSOR__')
    expect(typeof ctx.now).toBe('number')
  })

  test('clipboard 读取失败时返回空字符串', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockRejectedValue(new Error('denied')) }
    })
    const ctx = await TemplateRenderer.buildContext('p')
    expect(ctx.clipboard).toBe('')
  })
})
```

- [ ] **步骤 2：运行测试，验证执行失败**

执行命令：`cd comind && npx vitest run src/services/__tests__/template-renderer.test.ts`

预期结果：测试因 `Cannot find module '../template-renderer'` 失败。

- [ ] **步骤 3：实现 `template-renderer.ts`**

新建 `comind/src/services/template-renderer.ts`：

```typescript
import type { Block } from '../types/block'
import type {
  NormalizedTemplate,
  TemplateContext,
  TemplateBlock,
  BlockDraft,
} from '../types/template'
import { generateUUID } from '../utils/id'
import { deserializeBlockTree } from './serialize-block-tree'

/** 占位符标记（用于 cursor 定位） */
export interface PlaceholderMarker {
  type: 'cursor'
  start: number
  end: number
}

/** 变量展开结果 */
export interface ExpandResult {
  text: string
  placeholders: PlaceholderMarker[]
}

const VAR_REGEX = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g

export class TemplateRenderer {
  /**
   * 构建预定义变量上下文。
   * clipboard 读取失败时返回空字符串（不抛出）。
   */
  static async buildContext(pageTitle: string): Promise<TemplateContext> {
    const now = new Date()
    const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const isoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    let clipboard = ''
    try {
      if (navigator?.clipboard?.readText) {
        clipboard = await navigator.clipboard.readText()
      }
    } catch {
      clipboard = ''
    }

    return {
      date,
      time,
      isoDate,
      pageTitle,
      cursor: '__CURSOR__',
      clipboard,
      now: now.getTime(),
    }
  }

  /**
   * 展开 content 中的 {{var}}。
   * - 预定义变量：替换
   * - {{cursor}}：替换为 __CURSOR__，并在 placeholders 中记录位置
   * - 其他 {{xxx}}（如 {{name}}）：保留为可见文本
   */
  static expandContent(content: string, context: TemplateContext): ExpandResult {
    const placeholders: PlaceholderMarker[] = []
    const text = content.replace(VAR_REGEX, (match, varName: string, offset: number) => {
      if (varName === 'cursor') {
        const start = offset
        const end = offset + match.length
        placeholders.push({ type: 'cursor', start, end })
        return '__CURSOR__'
      }
      if (varName in context) {
        // @ts-expect-error 索引访问由 in 守卫
        return context[varName] as string
      }
      return match
    })
    return { text, placeholders }
  }

  /**
   * 渲染模板为 BlockDraft 列表（DFS 顺序，pos 连续递增）。
   *
   * 不写库，仅生成待插入数据。由调用方负责调用 blocksStore 写入。
   */
  static render(
    template: NormalizedTemplate,
    context: TemplateContext,
    anchorBlock: Block
  ): BlockDraft[] {
    const expanded = this.expandTemplateBlocks(template.blocks, context, anchorBlock)
    return expanded
  }

  /**
   * 内部：递归展开 TemplateBlock[] → BlockDraft[]
   */
  private static expandTemplateBlocks(
    tmplBlocks: TemplateBlock[],
    context: TemplateContext,
    anchorBlock: Block
  ): BlockDraft[] {
    const drafts: BlockDraft[] = []

    // 使用 deserializeBlockTree 做"骨架展开"（分配 id/pos/parentId/format）
    // 然后用 expandContent 覆盖 content
    const skeletons = deserializeBlockTree(tmplBlocks, {
      pageId: anchorBlock.pageId,
      parentId: anchorBlock.parentId,
      basePos: anchorBlock.pos + 1000,
    })

    // 再次递归展开 children（deserializeBlockTree 已返回 DFS 顺序，但 children 的 content 需独立展开）
    // 直接对原 TemplateBlock 树做 DFS 遍历，匹配 skeletons 中的 id
    let cursor = 0
    const walk = (tmpl: TemplateBlock[], parentDrafts: BlockDraft[] | null) => {
      for (const t of tmpl) {
        const skeleton = skeletons[cursor]
        const { text, placeholders } = this.expandContent(t.content, context)
        const hasCursor = placeholders.length > 0

        const draft: BlockDraft = {
          id: skeleton.id,
          pageId: skeleton.pageId,
          parentId: skeleton.parentId,
          pos: skeleton.pos,
          content: text,
          format: skeleton.format as BlockDraft['format'],
          type: skeleton.type as BlockDraft['type'],
          properties: skeleton.properties,
          cursorMarker: hasCursor ? '__CURSOR__' : null,
        }
        drafts.push(draft)
        cursor += 1

        if (t.children && t.children.length > 0) {
          walk(t.children, [draft])
        }
      }
    }

    walk(tmplBlocks, null)

    return drafts
  }
}
```

- [ ] **步骤 4：运行测试，验证执行通过**

执行命令：`cd comind && npx vitest run src/services/__tests__/template-renderer.test.ts`

预期结果：所有测试通过。

- [ ] **步骤 5：运行 lint + 编译验证**

执行命令：
```bash
cd comind && npm run lint -- src/services/template-renderer.ts && npx vue-tsc --noEmit
```

预期结果：无 lint 错误，TypeScript 编译通过。

- [ ] **步骤 6：提交代码**

```bash
cd comind
git add src/services/template-renderer.ts src/services/__tests__/template-renderer.test.ts
git commit -m "feat(template): add TemplateRenderer with variable expansion and DFS block generation"
```

---

## 任务 5：实现 `builtin-templates.ts`（10 个内置模板的静态配置）

**涉及文件：**
- 新建：`comind/src/config/builtin-templates.ts`
- 新建：`comind/src/config/__tests__/builtin-templates.test.ts`

- [ ] **步骤 1：编写失败测试**

新建 `comind/src/config/__tests__/builtin-templates.test.ts`：

```typescript
import { describe, test, expect } from 'vitest'
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from '../builtin-templates'

describe('BUILTIN_TEMPLATES', () => {
  test('应包含 10 个模板（5 思维模型 + 5 工作）', () => {
    expect(BUILTIN_TEMPLATES.length).toBe(10)
  })

  test('所有 ID 全局唯一', () => {
    const ids = BUILTIN_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('所有 name 非空、唯一', () => {
    const names = BUILTIN_TEMPLATES.map(t => t.name)
    expect(names.every(n => n.length > 0)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
  })

  test('所有 icon 非空', () => {
    expect(BUILTIN_TEMPLATES.every(t => t.icon.length > 0)).toBe(true)
  })

  test('所有 description 非空', () => {
    expect(BUILTIN_TEMPLATES.every(t => t.description.length > 0)).toBe(true)
  })

  test('所有 blocks 非空数组', () => {
    expect(BUILTIN_TEMPLATES.every(t => Array.isArray(t.blocks) && t.blocks.length > 0)).toBe(true)
  })

  test('分类分布：5 thinking-model + 5 work/journal/review', () => {
    const thinking = BUILTIN_TEMPLATES.filter(t => t.category === 'thinking-model')
    expect(thinking.length).toBe(5)
    const others = BUILTIN_TEMPLATES.filter(t => t.category !== 'thinking-model')
    expect(others.length).toBe(5)
  })

  test('必须包含预期 ID', () => {
    const expectedIds = [
      'second-order-thinking', 'five-whys', 'mece', 'first-principles', 'premortem',
      'meeting-notes', 'weekly-review', 'daily-journal', 'decision-record', 'reading-notes'
    ]
    for (const id of expectedIds) {
      expect(BUILTIN_TEMPLATES.some(t => t.id === id)).toBe(true)
    }
  })
})

describe('getBuiltinTemplate', () => {
  test('按 ID 查询', () => {
    const t = getBuiltinTemplate('meeting-notes')
    expect(t).toBeDefined()
    expect(t?.name).toBe('会议记录')
  })

  test('不存在的 ID 返回 undefined', () => {
    expect(getBuiltinTemplate('non-existent')).toBeUndefined()
  })
})
```

- [ ] **步骤 2：运行测试，验证执行失败**

执行命令：`cd comind && npx vitest run src/config/__tests__/builtin-templates.test.ts`

预期结果：测试因 `Cannot find module '../builtin-templates'` 失败。

- [ ] **步骤 3：实现 `builtin-templates.ts`**

新建 `comind/src/config/builtin-templates.ts`：

```typescript
import type { BuiltinTemplate } from '../types/template'

/**
 * 内置模板清单（10 个）
 *
 * 修改原则：
 * 1. 任何修改需保持 ID 全局唯一
 * 2. blocks 数组至少 1 个元素
 * 3. heading 类型必须指定 headingLevel
 * 4. property 类型必须指定 propertyKey
 */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  // ─── 思维模型类（5 个） ───────────────────────────────────
  {
    id: 'second-order-thinking',
    name: '二阶思维',
    aliases: ['second-order', '2nd-order'],
    category: 'thinking-model',
    description: '引导追问"然后呢？"',
    icon: '🤔',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '二阶思维: {{cursor}}' },
      { type: 'bullet', content: '## 一阶：直接结果是什么？' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '二阶：然后呢？' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '三阶：再然后呢？' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'five-whys',
    name: '5WHY 分析',
    aliases: ['5why', 'five-whys'],
    category: 'thinking-model',
    description: '连问 5 个为什么找根因',
    icon: '❓',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '5WHY 分析: {{cursor}}' },
      { type: 'property', propertyKey: '日期', content: '{{date}}' },
      { type: 'bullet', content: '## 问题：' },
      { type: 'bullet', content: '## Why 1：' },
      { type: 'bullet', content: '## Why 2：' },
      { type: 'bullet', content: '## Why 3：' },
      { type: 'bullet', content: '## Why 4：' },
      { type: 'bullet', content: '## Why 5（根因）：' },
    ]
  },
  {
    id: 'mece',
    name: 'MECE 拆解',
    aliases: ['mece', '互斥穷尽'],
    category: 'thinking-model',
    description: '相互独立、完全穷尽地拆解问题',
    icon: '🧩',
    blocks: [
      { type: 'heading', headingLevel: 2, content: 'MECE 拆解: {{cursor}}' },
      { type: 'bullet', content: '## 待拆解问题：' },
      { type: 'heading', headingLevel: 3, content: '维度 1' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '维度 2' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '维度 3' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'first-principles',
    name: '第一性原理',
    aliases: ['first-principles', '第一性'],
    category: 'thinking-model',
    description: '剥离假设，回到基本事实',
    icon: '⚛️',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '第一性原理: {{cursor}}' },
      { type: 'bullet', content: '## 当前方案/共识：' },
      { type: 'heading', headingLevel: 3, content: '基本事实（不可再分）：' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '基于基本事实的重新推导：' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'premortem',
    name: '预先验尸',
    aliases: ['premortem', '预失败'],
    category: 'thinking-model',
    description: '假设项目已失败，反推原因',
    icon: '⚰️',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '预先验尸: {{cursor}}' },
      { type: 'bullet', content: '## 假设 {{date}} 项目彻底失败，原因是：' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '可提前规避的行动：' },
      { type: 'bullet', content: '' },
    ]
  },

  // ─── 工作类（5 个） ───────────────────────────────────
  {
    id: 'meeting-notes',
    name: '会议记录',
    aliases: ['meeting', '会议'],
    category: 'work',
    description: '结构化记录会议：时间/参与人/议题/决议/待办',
    icon: '📝',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '会议: {{cursor}}' },
      { type: 'property', propertyKey: '时间', content: '{{date}} {{time}}' },
      { type: 'property', propertyKey: '参与人', content: '' },
      { type: 'heading', headingLevel: 3, content: '议题' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '决议' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '待办' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'weekly-review',
    name: '每周复盘',
    aliases: ['weekly-review', 'weekly', '周报', '复盘'],
    category: 'review',
    description: '5 个引导问题：精力/注意力/思考/决策/目标',
    icon: '📋',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '周复盘 ({{iso_date}})' },
      { type: 'heading', headingLevel: 3, content: '1. 这周精力最好的时候是？什么时候最差？' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '2. 这周什么消耗了最多注意力？' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '3. 这周最深的思考是什么？' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '4. 这周有哪些决策需要复盘？' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '5. 下周最重要的 3 件事？' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'daily-journal',
    name: '今日记录',
    aliases: ['daily', 'journal', '日记', '今日'],
    category: 'journal',
    description: '心情/进展/卡点/明日计划',
    icon: '🌅',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '{{iso_date}}' },
      { type: 'property', propertyKey: '心情', content: '' },
      { type: 'heading', headingLevel: 3, content: '今日进展' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '卡点' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '明日计划' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'decision-record',
    name: '决策记录',
    aliases: ['decision', '决策'],
    category: 'work',
    description: '背景/选项/权衡/决定/复盘',
    icon: '⚖️',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '决策: {{cursor}}' },
      { type: 'property', propertyKey: '日期', content: '{{date}}' },
      { type: 'heading', headingLevel: 3, content: '背景' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '候选方案' },
      { type: 'bullet', content: '方案 A：' },
      { type: 'bullet', content: '方案 B：' },
      { type: 'bullet', content: '方案 C：' },
      { type: 'heading', headingLevel: 3, content: '权衡' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '决定' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'reading-notes',
    name: '阅读笔记',
    aliases: ['reading', 'book', '阅读'],
    category: 'work',
    description: '元信息/核心观点/我的启发/行动项',
    icon: '📖',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '阅读笔记: {{cursor}}' },
      { type: 'property', propertyKey: '作者', content: '' },
      { type: 'property', propertyKey: '日期', content: '{{date}}' },
      { type: 'heading', headingLevel: 3, content: '核心观点' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '我的启发' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '行动项' },
      { type: 'bullet', content: '' },
    ]
  },
]

/**
 * 按 ID 查询内置模板
 */
export function getBuiltinTemplate(id: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find(t => t.id === id)
}
```

- [ ] **步骤 4：运行测试，验证执行通过**

执行命令：`cd comind && npx vitest run src/config/__tests__/builtin-templates.test.ts`

预期结果：所有测试通过。

- [ ] **步骤 5：运行 lint 验证**

执行命令：`cd comind && npm run lint -- src/config/builtin-templates.ts`

预期结果：无 lint 错误。

- [ ] **步骤 6：提交代码**

```bash
cd comind
git add src/config/builtin-templates.ts src/config/__tests__/builtin-templates.test.ts
git commit -m "feat(template): add 10 builtin templates (5 thinking + 5 work)"
```

---

## 任务 6：端到端验证（Plan 1 收尾）

- [ ] **步骤 1：运行全量单元测试**

执行命令：`cd comind && npm run test`

预期结果：所有测试通过，包括新加的 4 个测试文件。

- [ ] **步骤 2：运行 TypeScript 编译**

执行命令：`cd comind && npx vue-tsc -b`

预期结果：编译通过，无类型错误。

- [ ] **步骤 3：运行 lint**

执行命令：`cd comind && npm run lint`

预期结果：无 lint 错误。

- [ ] **步骤 4：手动 sanity check（README/CLAUDE）**

执行命令：`cd comind && grep -r "TemplateRenderer\|builtin-templates\|serializeBlockTree" src/`

预期结果：仅在新增文件中出现，未污染其他模块。

- [ ] **步骤 5：Plan 1 收尾提交（如有未提交文件）**

```bash
cd comind
git status
# 若有未提交文件，单独 commit
```

---

## 验收清单

- [ ] 4 个新测试文件全部通过
- [ ] Dexie v9 schema 升级成功，templates 表可读写
- [ ] `TemplateRenderer.expandContent` 支持 7 个预定义变量 + 保留 `{{name}}` 文本
- [ ] `TemplateRenderer.render` 生成 DFS 顺序的 BlockDraft[]，pos 连续递增
- [ ] `serializeBlockTree` / `deserializeBlockTree` 字段映射与设计文档 §序列化行为契约 一致
- [ ] 10 个内置模板 ID 唯一、blocks 非空、icon/description 非空
- [ ] `npm run lint` + `npx vue-tsc --noEmit` + `npm run test` 全绿
- [ ] 无向后兼容破坏（v7/v8 仍可访问）

---

## 风险与注意

1. **Dexie v9 升级是破坏性操作**：用户在 v7/v8 的数据库会触发 schema 升级，IndexedDB 需保留旧 version 块。代码中已保留 v7/v8 链，验证现有用户在升级后数据不丢失。
2. **`deserializeBlockTree` 的 children 行为**：当前实现是 DFS 顺序（父→子），子节点紧跟父节点之后。若需要"父→子→兄弟"语义，调整 `expand()` 中的递归。
3. **`{{cursor}}` 标记与序列化冲突**：模板 `content` 序列化为 Block `content` 时，`__CURSOR__` 是可见文本。后续步骤在 SlashCommandMenu 集成时需做光标定位（基于 content offset + 第一个 cursorMarker）。

---

## 下一步

本方案产出物供 Plan 2（B 集成层）使用：
- `NormalizedTemplate` 类型（用于注册表）
- `TemplateRenderer.render` + `TemplateRenderer.buildContext`（用于 slash command 集成）
- `BUILTIN_TEMPLATES` + `getBuiltinTemplate`（用于构建 Command 条目）
- `deserializeBlockTree`（用于 blocksStore 插入）

执行完本方案后，继续 [Plan 2：B 集成层](docs/superpowers/plans/2026-06-05-template-system-plan-b.md)。
