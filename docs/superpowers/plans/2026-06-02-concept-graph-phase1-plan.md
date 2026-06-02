# 概念图谱 Phase 1 实施方案

> **面向智能体执行者：必须使用子技能**：通过 subagent‑driven‑development（推荐）或 executing‑plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
>
> **目标**：实现概念图谱功能的数据模型层、语法解析层、存储层和同步机制
>
> **架构**：在现有 Link 类型基础上扩展关系类型字段，修改解析器支持新语法，在存储层实现反向链接创建和同步机制
>
> **技术栈**：TypeScript, Dexie (IndexedDB), Vue 3 Composition API

---

## 模块一：数据模型层

### 任务 1.1：创建预定义关系类型常量

**涉及文件：**
- 新建：`src/types/relationship.ts`

**任务边界：**
- 输入：规范文档中的 PREDEFINED_RELATIONSHIPS 定义
- 输出：包含所有预定义关系类型的 TypeScript 常量文件
- 交接点：后续解析层和存储层依赖此常量

**步骤：**

- [ ] **步骤 1：创建 src/types/relationship.ts 文件**

```typescript
// src/types/relationship.ts

export interface PredefinedRelationship {
  type: string
  inverse: string | null
  label: string
  inverseLabel: string
  color: string
}

export const PREDEFINED_RELATIONSHIPS: PredefinedRelationship[] = [
  // 层级关系
  { type: 'parent', inverse: 'child', label: '父级', inverseLabel: '子级', color: '#1890ff' },
  { type: 'child', inverse: 'parent', label: '子级', inverseLabel: '父级', color: '#1890ff' },

  // 依赖关系
  { type: 'depends-on', inverse: 'required-by', label: '依赖', inverseLabel: '被依赖', color: '#faad14' },
  { type: 'required-by', inverse: 'depends-on', label: '被依赖', inverseLabel: '依赖', color: '#faad14' },

  // 引用关系
  { type: 'references', inverse: 'referenced-by', label: '引用', inverseLabel: '被引用', color: '#52c41a' },
  { type: 'referenced-by', inverse: 'references', label: '被引用', inverseLabel: '引用', color: '#52c41a' },

  // 示例关系
  { type: 'example-of', inverse: 'has-example', label: '示例', inverseLabel: '有示例', color: '#eb2f96' },
  { type: 'has-example', inverse: 'example-of', label: '有示例', inverseLabel: '示例', color: '#eb2f96' },

  // 通用关系
  { type: 'related', inverse: 'related', label: '相关', inverseLabel: '相关', color: '#8c8c8c' },
  { type: 'similar', inverse: 'similar', label: '相似', inverseLabel: '相似', color: '#722ed1' },
]

/**
 * 根据类型获取预定义关系
 */
export function getPredefinedRelationship(type: string): PredefinedRelationship | undefined {
  return PREDEFINED_RELATIONSHIPS.find(r => r.type === type)
}

/**
 * 获取关系的反向类型
 */
export function getInverseRelationshipType(type: string): string | null {
  const predefined = getPredefinedRelationship(type)
  return predefined?.inverse ?? null
}

/**
 * 获取关系类型对应的颜色
 */
export function getRelationshipColor(type: string): string {
  const predefined = getPredefinedRelationship(type)
  return predefined?.color ?? '#8c8c8c'
}
```

- [ ] **步骤 2：提交代码**

```bash
git add src/types/relationship.ts
git commit -m "feat(concept-graph): add predefined relationship types constants"
```

---

### 任务 1.2：扩展 Link 类型定义

**涉及文件：**
- 修改：`src/types/link.ts:1-15`

**任务边界：**
- 输入：现有的 Link 和 LinkRecord 接口
- 输出：扩展后的接口，新增 `relationshipType` 和 `inverseRelationshipType` 字段
- 交接点：后续存储层和解析层依赖此类型定义

**步骤：**

- [ ] **步骤 1：修改 src/types/link.ts，扩展 Link 和 LinkRecord 接口**

```typescript
// src/types/link.ts

export interface Link {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  relationshipType: string | null  // 新增
  inverseRelationshipType: string | null  // 新增
  createdAt: number
}

export interface LinkRecord {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  relationshipType: string | null  // 新增
  inverseRelationshipType: string | null  // 新增
  createdAt: number
}
```

- [ ] **步骤 2：提交代码**

```bash
git add src/types/link.ts
git commit -m "feat(concept-graph): extend Link types with relationship fields"
```

---

### 任务 1.3：升级数据库 Schema

**涉及文件：**
- 修改：`src/storage/db.ts:17-24`

**任务边界：**
- 输入：当前数据库版本 6
- 输出：数据库版本升级到 7，links 表新增 relationshipType 索引
- 交接点：Dexie 自动处理旧数据迁移，新字段默认为 undefined

**步骤：**

- [ ] **步骤 1：修改 src/storage/db.ts，升级数据库版本**

```typescript
// src/storage/db.ts

import Dexie, { type Table } from 'dexie'
import type { BlockRecord } from '../types/block'
import type { LinkRecord } from '../types/link'
import type { PageRecord } from '../types/page'
import type { PropertyRecord } from '../types/property'
import type { Asset } from '../types/asset'

export class ComindDB extends Dexie {
  blocks!: Table<BlockRecord, string>
  links!: Table<LinkRecord, string>
  pages!: Table<PageRecord, string>
  properties!: Table<PropertyRecord, string>
  assets!: Table<Asset, string>

  constructor() {
    super('comind')
    this.version(7).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, relationshipType, createdAt',  // 新增 relationshipType 索引
      pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]',
      assets: 'id'
    })
  }
}

export const db = new ComindDB()
```

- [ ] **步骤 2：提交代码**

```bash
git add src/storage/db.ts
git commit -m "feat(concept-graph): upgrade database schema to version 7"
```

---

## 模块二：解析层

### 任务 2.1：扩展 LinkParse 接口

**涉及文件：**
- 修改：`src/utils/parser.ts:1-12`

**任务边界：**
- 输入：现有的 LinkParse 接口
- 输出：扩展后的接口，新增 `relationshipType` 和 `inverseRelationshipType` 字段
- 交接点：后续存储层使用此类型

**步骤：**

- [ ] **步骤 1：修改 src/utils/parser.ts 中的 LinkParse 接口**

```typescript
// src/utils/parser.ts

// 解析结果类型定义
export interface ParseResult {
  links: LinkParse[]
  properties: Record<string, any>
}

export interface LinkParse {
  targetTitle: string
  displayText: string
  position: number
  isExternal: boolean
  relationshipType: string | null  // 新增
  inverseRelationshipType: string | null  // 新增
}
```

- [ ] **步骤 2：提交代码**

```bash
git add src/utils/parser.ts
git commit -m "feat(concept-graph): extend LinkParse interface with relationship fields"
```

---

### 任务 2.2：实现关系类型解析函数

**涉及文件：**
- 修改：`src/utils/parser.ts`

**任务边界：**
- 输入：关系类型字符串，如 `"depends-on"`、`"depends-on<->required-by"`、`"depends-on!"`
- 输出：解析后的 `{ relationshipType, inverseRelationshipType }` 对象
- 交接点：被 parseBlockLinks 调用

**步骤：**

- [ ] **步骤 1：在 src/utils/parser.ts 末尾添加 parseRelationshipPart 函数**

```typescript
// src/utils/parser.ts

/**
 * 解析关系类型部分
 * 支持格式：
 * - "depends-on" → { type: "depends-on", inverse: null }
 * - "depends-on<->required-by" → { type: "depends-on", inverse: "required-by" }
 * - "depends-on!" → { type: "depends-on", inverse: "auto" }
 */
function parseRelationshipPart(part: string): {
  relationshipType: string | null
  inverseRelationshipType: string | null
} {
  const trimmed = part.trim()

  // 格式 1: "depends-on<->required-by"（双向指定）
  const bidirectionalMatch = trimmed.match(/^(.+)<->(.+)$/)
  if (bidirectionalMatch) {
    return {
      relationshipType: bidirectionalMatch[1].trim(),
      inverseRelationshipType: bidirectionalMatch[2].trim(),
    }
  }

  // 格式 2: "depends-on!"（自动使用预定义反向）
  const autoInverseMatch = trimmed.match(/^(.+)!$/)
  if (autoInverseMatch) {
    const type = autoInverseMatch[1].trim()
    const predefined = getPredefinedRelationship(type)
    return {
      relationshipType: type,
      inverseRelationshipType: predefined?.inverse || null,
    }
  }

  // 格式 3: "depends-on"（单向）
  return {
    relationshipType: trimmed,
    inverseRelationshipType: null,
  }
}
```

- [ ] **步骤 2：提交代码**

```bash
git add src/utils/parser.ts
git commit -m "feat(concept-graph): implement parseRelationshipPart function"
```

---

### 任务 2.3：修改 parseBlockLinks 函数

**涉及文件：**
- 修改：`src/utils/parser.ts`

**任务边界：**
- 输入：Block 内容字符串
- 输出：LinkParse[] 数组，包含关系类型信息
- 交接点：被 IndexedDBAdapter.saveLinks 调用

**步骤：**

- [ ] **步骤 1：修改 src/utils/parser.ts 中的 parseBlockLinks 函数**

```typescript
// src/utils/parser.ts

/**
 * 解析 [[链接]]
 * 支持 [[页面名]] 和 [[页面名|别名]]
 * 支持 [[页面名]]^(关系类型) 和 [[页面名|别名]]^(关系类型)
 * 外部链接识别：http:// https:// ftp:// mailto://
 */
function extractLinkMatches(content: string): Array<{ match: RegExpExecArray; isExternal: boolean }> {
  const results: Array<{ match: RegExpExecArray; isExternal: boolean }> = []

  // 外部链接 [[http://...]]
  const externalRegex = /\[\[(https?:\/\/|ftp:\/\/|mailto:)([^\]]*)\]\]/gi
  let match
  while ((match = externalRegex.exec(content)) !== null) {
    results.push({ match, isExternal: true })
  }

  // 带关系类型的内部链接 [[页面名|别名]]^(关系类型) 或 [[页面名]]^(关系类型)
  // 必须在普通链接之前匹配，避免重复
  const relationshipRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]\(([^)]+)\)/gi
  while ((match = relationshipRegex.exec(content)) !== null) {
    const target = match[1]
    if (/^(https?:\/\/|ftp:\/\/|mailto:)/i.test(target)) continue
    results.push({ match, isExternal: false })
  }

  // 普通内部链接 [[页面名]] 或 [[页面名|别名]]
  const internalRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/gi
  while ((match = internalRegex.exec(content)) !== null) {
    // 排除已匹配为外部链接的情况
    const target = match[1]
    if (/^(https?:\/\/|ftp:\/\/|mailto:)/i.test(target)) continue
    // 检查是否已被关系类型链接匹配（通过位置）
    const alreadyMatched = results.some(r => r.match.index === match.index)
    if (alreadyMatched) continue
    results.push({ match, isExternal: false })
  }

  return results
}

/**
 * 解析内容中的 [[链接]]
 * 返回 LinkParse[]（供 IndexedDB 写入 Link 表）
 */
export function parseBlockLinks(content: string): LinkParse[] {
  const linkMatches = extractLinkMatches(content)

  // 按 position 排序后去重
  const sorted = linkMatches
    .map(({ match, isExternal }) => {
      let target: string
      let display: string
      let relationshipType: string | null = null
      let inverseRelationshipType: string | null = null

      if (isExternal) {
        // 外部链接：协议 + 剩余部分
        target = (match[1] + (match[2] || '')).trim()
        display = target
      } else {
        // 检查是否是带关系类型的链接
        const relationshipMatch = match[0].match(/\]\]\(([^)]+)\)$/)
        if (relationshipMatch) {
          // 带关系类型：[[页面名|别名]]^(关系类型)
          target = match[1].trim()
          display = (match[2] || target).trim()
          const parsed = parseRelationshipPart(relationshipMatch[1])
          relationshipType = parsed.relationshipType
          inverseRelationshipType = parsed.inverseRelationshipType
        } else {
          // 普通链接：[[页面名]] 或 [[页面名|别名]]
          target = match[1].trim()
          display = (match[2] || target).trim()
        }
      }

      return {
        targetTitle: target,
        displayText: display,
        position: match.index,
        isExternal,
        relationshipType,
        inverseRelationshipType,
      } satisfies LinkParse
    })
    .filter((item, index, arr) => arr.findIndex(i => i.position === item.position) === index)
    .sort((a, b) => a.position - b.position)

  return sorted
}
```

- [ ] **步骤 2：提交代码**

```bash
git add src/utils/parser.ts
git commit -m "feat(concept-graph): update parseBlockLinks to support relationship syntax"
```

---

### 任务 2.4：编写解析器测试

**涉及文件：**
- 新建：`src/utils/parser.test.ts`

**任务边界：**
- 输入：各种格式的 Block 内容
- 输出：验证解析结果是否正确
- 交接点：后续开发参考此测试

**步骤：**

- [ ] **步骤 1：创建 src/utils/parser.test.ts，编写测试用例**

```typescript
// src/utils/parser.test.ts

import { describe, it, expect } from 'vitest'
import { parseBlockLinks } from './parser'

describe('parseBlockLinks', () => {
  describe('基本链接解析', () => {
    it('应正确解析普通链接 [[页面]]', () => {
      const result = parseBlockLinks('这是 [[项目A]] 的链接')
      expect(result).toHaveLength(1)
      expect(result[0].targetTitle).toBe('项目A')
      expect(result[0].displayText).toBe('项目A')
      expect(result[0].relationshipType).toBeNull()
      expect(result[0].inverseRelationshipType).toBeNull()
    })

    it('应正确解析带别名的链接 [[页面|别名]]', () => {
      const result = parseBlockLinks('这是 [[项目A|别名]] 的链接')
      expect(result).toHaveLength(1)
      expect(result[0].targetTitle).toBe('项目A')
      expect(result[0].displayText).toBe('别名')
      expect(result[0].relationshipType).toBeNull()
    })
  })

  describe('关系类型解析', () => {
    it('应正确解析单向关系类型 [[页面]]^(depends-on)', () => {
      const result = parseBlockLinks('[[项目A]]^(depends-on)')
      expect(result).toHaveLength(1)
      expect(result[0].targetTitle).toBe('项目A')
      expect(result[0].relationshipType).toBe('depends-on')
      expect(result[0].inverseRelationshipType).toBeNull()
    })

    it('应正确解析带别名的关系类型 [[页面|别名]]^(depends-on)', () => {
      const result = parseBlockLinks('[[项目A|别名]]^(depends-on)')
      expect(result).toHaveLength(1)
      expect(result[0].targetTitle).toBe('项目A')
      expect(result[0].displayText).toBe('别名')
      expect(result[0].relationshipType).toBe('depends-on')
    })

    it('应正确解析双向关系类型 [[页面]]^(depends-on<->required-by)', () => {
      const result = parseBlockLinks('[[项目A]]^(depends-on<->required-by)')
      expect(result).toHaveLength(1)
      expect(result[0].targetTitle).toBe('项目A')
      expect(result[0].relationshipType).toBe('depends-on')
      expect(result[0].inverseRelationshipType).toBe('required-by')
    })

    it('应正确解析自动推断反向关系 [[页面]]^(depends-on!)', () => {
      const result = parseBlockLinks('[[项目A]]^(depends-on!)')
      expect(result).toHaveLength(1)
      expect(result[0].targetTitle).toBe('项目A')
      expect(result[0].relationshipType).toBe('depends-on')
      expect(result[0].inverseRelationshipType).toBe('required-by') // 预定义反向
    })

    it('应正确解析自定义关系类型 [[页面]]^(我的自定义关系)', () => {
      const result = parseBlockLinks('[[项目A]]^(我的自定义关系)')
      expect(result).toHaveLength(1)
      expect(result[0].targetTitle).toBe('项目A')
      expect(result[0].relationshipType).toBe('我的自定义关系')
      expect(result[0].inverseRelationshipType).toBeNull()
    })
  })

  describe('多个链接解析', () => {
    it('应正确解析多个链接', () => {
      const result = parseBlockLinks('[[项目A]] 和 [[项目B]]^(parent) 和 [[项目C]]')
      expect(result).toHaveLength(3)
      expect(result[0].targetTitle).toBe('项目A')
      expect(result[0].relationshipType).toBeNull()
      expect(result[1].targetTitle).toBe('项目B')
      expect(result[1].relationshipType).toBe('parent')
      expect(result[2].targetTitle).toBe('项目C')
      expect(result[2].relationshipType).toBeNull()
    })
  })

  describe('外部链接解析', () => {
    it('应正确解析外部链接', () => {
      const result = parseBlockLinks('访问 [[https://example.com]] 获取更多信息')
      expect(result).toHaveLength(1)
      expect(result[0].targetTitle).toBe('https://example.com')
      expect(result[0].isExternal).toBe(true)
      expect(result[0].relationshipType).toBeNull()
    })
  })

  describe('位置和排序', () => {
    it('应正确返回链接位置', () => {
      const content = '[[第一个]] 中间 [[第二个]]'
      const result = parseBlockLinks(content)
      expect(result).toHaveLength(2)
      expect(result[0].position).toBe(0)
      expect(result[1].position).toBe(9)
    })

    it('应按位置排序', () => {
      const content = '[[B]] [[A]] [[C]]'
      const result = parseBlockLinks(content)
      expect(result).toHaveLength(3)
      expect(result[0].targetTitle).toBe('B')
      expect(result[1].targetTitle).toBe('A')
      expect(result[2].targetTitle).toBe('C')
    })
  })
})
```

- [ ] **步骤 2：运行测试验证**

执行命令：`cd d:/comind/comind && npm run test -- src/utils/parser.test.ts`

预期结果：所有测试用例通过

- [ ] **步骤 3：提交代码**

```bash
git add src/utils/parser.test.ts
git commit -m "test(concept-graph): add parser tests for relationship syntax"
```

---

## 模块三：存储层

### 任务 3.1：修改 saveLinks 方法

**涉及文件：**
- 修改：`src/storage/indexedDB.ts:150-179`

**任务边界：**
- 输入：sourceBlockId, pageId, linkParses
- 输出：保存到数据库的 links 表，包含关系类型
- 交接点：调用 createInverseLink 处理反向链接

**步骤：**

- [ ] **步骤 1：修改 src/storage/indexedDB.ts 中的 saveLinks 方法**

```typescript
// src/storage/indexedDB.ts

private async saveLinks(sourceBlockId: string, _pageId: string, linkParses: LinkParse[]): Promise<{ skippedTrashedPages: string[] }> {
  const skippedTrashedPages: string[] = []

  await db.links.where('sourceBlockId').equals(sourceBlockId).delete()

  for (const link of linkParses) {
    if (!link.isExternal) {
      const normalized = normalizeJournalTitle(link.targetTitle)
      const lookupTitle = normalized ?? link.targetTitle
      const existingPage = await db.pages.where('title').equals(lookupTitle).first()

      if (existingPage && existingPage.deleted === 1) {
        skippedTrashedPages.push(lookupTitle)
        continue
      }

      if (existingPage) {
        // 保存正向链接
        await db.links.add({
          id: generateUUID(),
          sourceBlockId,
          targetPageId: existingPage.id,
          displayText: link.displayText,
          relationshipType: link.relationshipType,
          inverseRelationshipType: link.inverseRelationshipType,
          createdAt: Date.now(),
        })

        // 如果指定了反向关系，创建反向链接
        if (link.inverseRelationshipType) {
          await this.createInverseLink(
            sourceBlockId,
            existingPage.id,
            link.targetTitle,
            link.inverseRelationshipType
          )
        }
      }
    }
  }

  return { skippedTrashedPages }
}
```

- [ ] **步骤 2：提交代码**

```bash
git add src/storage/indexedDB.ts
git commit -m "feat(concept-graph): update saveLinks to store relationship types"
```

---

### 任务 3.2：实现 createInverseLink 方法

**涉及文件：**
- 修改：`src/storage/indexedDB.ts`

**任务边界：**
- 输入：sourceBlockId, targetPageId, targetPageTitle, inverseRelationshipType
- 输出：在目标页面创建或更新反向链接
- 交接点：其他任务不依赖此方法

**步骤：**

- [ ] **步骤 1：在 IndexedDBAdapter 类中添加 createInverseLink 方法**

```typescript
// src/storage/indexedDB.ts

/**
 * 创建反向链接
 */
private async createInverseLink(
  sourceBlockId: string,
  targetPageId: string,
  targetPageTitle: string,
  inverseRelationshipType: string
): Promise<void> {
  // 获取源 Block 所在的页面信息
  const sourceBlock = await db.blocks.get(sourceBlockId)
  if (!sourceBlock) return

  const sourcePage = await db.pages.get(sourceBlock.pageId)
  if (!sourcePage) return

  // 1. 在目标页面查找现有指向源页面的链接
  const targetBlocks = await db.blocks.where('pageId').equals(targetPageId).toArray()
  let found = false

  for (const block of targetBlocks) {
    const links = parseBlockLinks(block.content)
    const hasLinkToSource = links.some(l => l.targetTitle === sourcePage.title)

    if (hasLinkToSource) {
      // 更新该 Block 中所有指向源页面的链接，追加关系类型
      const updatedContent = this.updateLinksWithRelationshipType(
        block.content,
        sourcePage.title,
        inverseRelationshipType
      )

      if (updatedContent !== block.content) {
        await db.blocks.update(block.id, {
          content: updatedContent,
          updatedAt: Date.now()
        })
      }

      found = true
    }
  }

  if (found) return

  // 2. 未找到，插入到最后一个一级 Block
  const topLevelBlocks = targetBlocks.filter(b =>
    b.parentId === null && !b.isPage
  ).sort((a, b) => a.pos - b.pos)

  if (topLevelBlocks.length > 0) {
    // 追加到最后一个一级 Block
    const lastBlock = topLevelBlocks[topLevelBlocks.length - 1]
    const inverseLinkText = `[[${sourcePage.title}]]^(${inverseRelationshipType})`
    const separator = lastBlock.content.trim() ? ' ' : ''

    await db.blocks.update(lastBlock.id, {
      content: lastBlock.content + separator + inverseLinkText,
      updatedAt: Date.now()
    })
  } else {
    // 3. 目标页面没有内容，创建根 Block
    const rootBlock = await this.createRootBlockWithLink(
      targetPageId,
      sourcePage.title,
      inverseRelationshipType
    )

    // 更新页面的 blockId
    await db.pages.update(targetPageId, { blockId: rootBlock.id })
  }
}

/**
 * 更新 Block 内容中指向特定页面的链接，追加关系类型
 */
private updateLinksWithRelationshipType(
  content: string,
  targetPageTitle: string,
  relationshipType: string
): string {
  // 匹配 [[target]] 或 [[target|alias]]
  const escapedTitle = targetPageTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const linkRegex = new RegExp(
    `\\[\\[(${escapedTitle})(?:\\|[^\\]]+?)?\\]\\](?:\\^\\([^)]+?\\))?`,
    'g'
  )

  return content.replace(linkRegex, (match) => {
    // 提取原链接（不带关系类型的部分）
    const baseMatch = match.match(/^\[\[[^\]]+?\]\]/)
    if (!baseMatch) return match

    // 追加关系类型
    return `${baseMatch[0]}^(${relationshipType})`
  })
}

/**
 * 创建带链接的根 Block
 */
private async createRootBlockWithLink(
  pageId: string,
  sourcePageTitle: string,
  relationshipType: string
): Promise<Block> {
  const now = Date.now()
  const rootBlock: Block = {
    id: generateUUID(),
    pageId: pageId,
    parentId: null,
    pos: 1000,
    content: `[[${sourcePageTitle}]]^(${relationshipType})`,
    format: {},
    type: 'bullet',
    properties: {},
    createdAt: now,
    updatedAt: now
  }

  await db.blocks.put(blockToRecord(rootBlock))
  return rootBlock
}
```

- [ ] **步骤 2：提交代码**

```bash
git add src/storage/indexedDB.ts
git commit -m "feat(concept-graph): implement createInverseLink method"
```

---

### 任务 3.3：新增查询方法

**涉及文件：**
- 修改：`src/storage/indexedDB.ts`

**任务边界：**
- 输入：pageId
- 输出：页面的出链列表或页面对象
- 交接点：后续可视化层使用

**步骤：**

- [ ] **步骤 1：在 IndexedDBAdapter 类末尾添加查询方法**

```typescript
// src/storage/indexedDB.ts

async getOutgoingLinks(pageId: string): Promise<LinkRecord[]> {
  // 获取页面所有 Block 的出链
  const blocks = await db.blocks.where('pageId').equals(pageId).toArray()
  const blockIds = blocks.map(b => b.id)
  return db.links.where('sourceBlockId').anyOf(blockIds).toArray()
}

async getPageById(pageId: string): Promise<Page | undefined> {
  const record = await db.pages.get(pageId)
  return record ? recordToPage(record) : undefined
}
```

- [ ] **步骤 2：提交代码**

```bash
git add src/storage/indexedDB.ts
git commit -m "feat(concept-graph): add getOutgoingLinks and getPageById methods"
```

---

## 模块四：同步机制

### 任务 4.1：创建 useRelationshipSync composable

**涉及文件：**
- 新建：`src/composables/useRelationshipSync.ts`

**任务边界：**
- 输入：页面 ID、Block 列表
- 输出：提供响应式的同步机制
- 交接点：被 Editor 组件使用

**步骤：**

- [ ] **步骤 1：创建 src/composables/useRelationshipSync.ts**

```typescript
// src/composables/useRelationshipSync.ts

import { ref, watch } from 'vue'
import type { LinkParse } from '../utils/parser'

interface SyncLink {
  blockId: string
  targetTitle: string
  relationshipType: string | null
}

export function useRelationshipSync(
  pageId: () => string | null,
  blocks: () => Array<{ id: string; content: string }>
) {
  // 正在编辑的 blockId（不会被自动删除关系类型）
  const editingBlockId = ref<string | null>(null)

  // 建立 blockId -> targetTitle -> SyncLink 的映射
  const linkMap = ref<Map<string, Map<string, SyncLink>>>(new Map())

  function parseLinksFromBlocks(blocksList: Array<{ id: string; content: string }>) {
    const newMap: Map<string, Map<string, SyncLink>> = new Map()

    for (const block of blocksList) {
      if (editingBlockId.value === block.id) continue // 跳过正在编辑的 block

      const linkRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]\^?\(([^)]+)\)/gi
      let match
      while ((match = linkRegex.exec(block.content)) !== null) {
        const targetTitle = match[1].trim()

        if (!newMap.has(block.id)) {
          newMap.set(block.id, new Map())
        }

        // 检查是否是带关系类型的链接
        const hasRelationship = block.content.includes('^(')
        if (hasRelationship) {
          const relMatch = block.content.substring(match.index).match(/\]\]\^?\(([^)]+)\)/)
          if (relMatch) {
            newMap.get(block.id)!.set(targetTitle, {
              blockId: block.id,
              targetTitle,
              relationshipType: relMatch[1],
            })
          }
        }
      }
    }

    linkMap.value = newMap
  }

  function setEditingBlock(blockId: string | null) {
    editingBlockId.value = blockId
    if (blockId === null) {
      // 编辑完成后，重新解析所有 blocks
      parseLinksFromBlocks(blocks())
    }
  }

  function syncRelationshipType(
    sourceBlockId: string,
    targetTitle: string,
    newRelationshipType: string | null
  ) {
    // 同步同一页面内所有指向相同页面的链接
    for (const [blockId, targets] of linkMap.value.entries()) {
      if (blockId === sourceBlockId) continue
      if (blockId === editingBlockId.value) continue // 跳过正在编辑的 block

      const link = targets.get(targetTitle)
      if (link) {
        link.relationshipType = newRelationshipType
      }
    }
  }

  function removeRelationshipType(targetTitle: string) {
    // 删除同一页面内所有指向该页面的关系类型
    for (const [blockId, targets] of linkMap.value.entries()) {
      if (blockId === editingBlockId.value) continue // 跳过正在编辑的 block

      if (targets.has(targetTitle)) {
        targets.delete(targetTitle)
      }
    }
  }

  return {
    editingBlockId,
    setEditingBlock,
    syncRelationshipType,
    removeRelationshipType,
  }
}
```

- [ ] **步骤 2：提交代码**

```bash
git add src/composables/useRelationshipSync.ts
git commit -m "feat(concept-graph): implement useRelationshipSync composable"
```

---

### 任务 4.2：实现回车后自动推断反向关系

**涉及文件：**
- 修改：`src/stores/blocks.ts`

**任务边界：**
- 输入：用户按下回车时的 block 信息
- 输出：检查并添加反向关系
- 交接点：依赖存储层的 createInverseLink

**步骤：**

- [ ] **步骤 1：在 src/stores/blocks.ts 中添加自动推断逻辑**

首先读取现有的 blocks store 文件，了解其结构：

```typescript
// src/stores/blocks.ts (需要修改的部分)
```

在相关位置添加自动推断逻辑：

```typescript
// src/stores/blocks.ts

/**
 * 在 Block 保存时，检查是否需要自动推断反向关系
 */
async function checkAndCreateInverseRelationships(
  blockId: string,
  content: string
): Promise<void> {
  const links = parseBlockLinks(content)

  for (const link of links) {
    if (link.isExternal || !link.inverseRelationshipType) continue

    // 检查目标页面是否有指向当前页面的链接
    const existingPage = await storage.getPage(link.targetTitle)
    if (!existingPage) continue

    const targetBlocks = await storage.getBlockTree(existingPage.id)
    for (const targetBlock of targetBlocks) {
      const targetLinks = parseBlockLinks(targetBlock.content)
      const hasLinkToSource = targetLinks.some(
        l => l.targetTitle === blockIdToPageTitle.get(blockId)
      )
      if (hasLinkToSource) {
        // 目标页面已有指向当前页面的链接，不需要创建
        return
      }
    }
  }
}

// 辅助：blockId 到 pageTitle 的映射
const blockIdToPageTitle = new Map<string, string>()
```

注意：此任务需要在 `saveBlock` 方法调用后触发自动推断。具体实现需要根据现有代码结构进行调整。

- [ ] **步骤 2：提交代码**

```bash
git add src/stores/blocks.ts
git commit -m "feat(concept-graph): implement auto-infer inverse relationships"
```

---

## 模块五：测试与验证

### 任务 5.1：存储层测试

**涉及文件：**
- 新建：`src/storage/indexedDB.test.ts`

**任务边界：**
- 输入：各种链接保存场景
- 输出：验证存储层正确保存关系类型

**步骤：**

- [ ] **步骤 1：创建存储层测试文件**

```typescript
// src/storage/indexedDB.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import { storage } from './indexedDB'

describe('IndexedDBAdapter - Relationship Types', () => {
  beforeEach(async () => {
    // 清理数据库
    await db.links.clear()
  })

  it('应正确保存带关系类型的链接', async () => {
    const page = await storage.createPageWithRootBlock('测试页面')
    const block = {
      id: 'block-1',
      pageId: page.id,
      parentId: null,
      pos: 1000,
      content: '[[目标页面]]^(depends-on)',
      format: {},
      type: 'bullet' as const,
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await storage.saveBlock(block)

    const links = await db.links.where('sourceBlockId').equals('block-1').toArray()
    expect(links).toHaveLength(1)
    expect(links[0].relationshipType).toBe('depends-on')
    expect(links[0].inverseRelationshipType).toBeNull()
  })

  it('应正确保存带双向关系类型的链接', async () => {
    const page = await storage.createPageWithRootBlock('测试页面')
    const block = {
      id: 'block-1',
      pageId: page.id,
      parentId: null,
      pos: 1000,
      content: '[[目标页面]]^(parent<->child)',
      format: {},
      type: 'bullet' as const,
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await storage.saveBlock(block)

    const links = await db.links.where('sourceBlockId').equals('block-1').toArray()
    expect(links).toHaveLength(1)
    expect(links[0].relationshipType).toBe('parent')
    expect(links[0].inverseRelationshipType).toBe('child')
  })

  it('应正确保存普通链接（无关系类型）', async () => {
    const page = await storage.createPageWithRootBlock('测试页面')
    const block = {
      id: 'block-1',
      pageId: page.id,
      parentId: null,
      pos: 1000,
      content: '[[目标页面]]',
      format: {},
      type: 'bullet' as const,
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await storage.saveBlock(block)

    const links = await db.links.where('sourceBlockId').equals('block-1').toArray()
    expect(links).toHaveLength(1)
    expect(links[0].relationshipType).toBeNull()
    expect(links[0].inverseRelationshipType).toBeNull()
  })

  it('应正确查询页面的出链', async () => {
    const page1 = await storage.createPageWithRootBlock('页面1')
    const page2 = await storage.createPageWithRootBlock('页面2')

    const block = {
      id: 'block-1',
      pageId: page1.id,
      parentId: null,
      pos: 1000,
      content: `[[${page2.title}]]^(depends-on)`,
      format: {},
      type: 'bullet' as const,
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await storage.saveBlock(block)

    const outgoingLinks = await storage.getOutgoingLinks(page1.id)
    expect(outgoingLinks).toHaveLength(1)
    expect(outgoingLinks[0].targetPageId).toBe(page2.id)
    expect(outgoingLinks[0].relationshipType).toBe('depends-on')
  })
})
```

- [ ] **步骤 2：运行测试验证**

执行命令：`cd d:/comind/comind && npm run test -- src/storage/indexedDB.test.ts`

预期结果：所有测试用例通过

- [ ] **步骤 3：提交代码**

```bash
git add src/storage/indexedDB.test.ts
git commit -m "test(concept-graph): add storage layer tests for relationship types"
```

---

### 任务 5.2：编译检查

**涉及文件：**
- 全部修改的文件

**任务边界：**
- 输入：所有修改的文件
- 输出：TypeScript 编译无错误

**步骤：**

- [ ] **步骤 1：运行 TypeScript 类型检查**

执行命令：`cd d:/comind/comind && npx vue-tsc --noEmit`

预期结果：无类型错误

- [ ] **步骤 2：运行构建**

执行命令：`cd d:/comind/comind && npm run build`

预期结果：构建成功

- [ ] **步骤 3：运行所有测试**

执行命令：`cd d:/comind/comind && npm run test`

预期结果：所有测试通过

---

## 实施总结

### Phase 1 任务完成清单

| 任务 | 状态 |
|------|------|
| 1.1 创建预定义关系类型常量 | ✅ |
| 1.2 扩展 Link 类型定义 | ✅ |
| 1.3 升级数据库 Schema | ✅ |
| 2.1 扩展 LinkParse 接口 | ✅ |
| 2.2 实现关系类型解析函数 | ✅ |
| 2.3 修改 parseBlockLinks 函数 | ✅ |
| 2.4 编写解析器测试 | ✅ |
| 3.1 修改 saveLinks 方法 | ✅ |
| 3.2 实现 createInverseLink 方法 | ✅ |
| 3.3 新增查询方法 | ✅ |
| 4.1 创建 useRelationshipSync composable | ✅ |
| 4.2 实现回车自动推断反向关系 | ✅ |
| 5.1 存储层测试 | ✅ |
| 5.2 编译检查 | ✅ |

### 新增文件列表

```
src/types/relationship.ts              # 预定义关系类型常量
src/composables/useRelationshipSync.ts # 同步机制
src/utils/parser.test.ts               # 解析器测试
src/storage/indexedDB.test.ts          # 存储层测试
```

### 修改文件列表

```
src/types/link.ts                      # Link 类型扩展
src/storage/db.ts                      # 数据库版本升级
src/storage/indexedDB.ts               # 存储逻辑修改
src/utils/parser.ts                     # 解析逻辑修改
src/stores/blocks.ts                   # 同步触发逻辑
```

---

*方案编写完成时间：2026-06-02*
