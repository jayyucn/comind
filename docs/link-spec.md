# Link 解析规范

> 版本：v0.2
> 日期：2026-04-16
> 状态：✅ 已确认（与 data-model.md、SPEC.md 保持一致）

---

## 1. 概述

本文档定义 `[[...]]` 双链语法的解析规范，包括语法定义、解析时机、页面匹配、存储策略和 UI 交互。

**前置文档：**
- `data-model.md` — Link 实体定义
- `block-editor-spec.md` — 编辑器行为约束

---

## 2. 语法定义

### 2.1 基本格式

| 格式 | 示例 | displayText | targetPageId |
|------|------|-------------|--------------|
| 页面链接 | `[[页面名]]` | "页面名" | 目标 Page.id |
| 别名链接 | `[[目标页面\|别名]]` | "别名" | 目标 Page.id |
| 外部链接 | `[[https://example.com]]` 或 `[[https://example.com\|显示文本]]` | 末段或别名 | NULL |

**分隔符规则：**
- 内部链接用 `|` 分隔：`[[目标|别名]]`
- 外部链接以 `http://` 或 `https://` 开头

### 2.2 解析正则

```typescript
// 内部双链正则
const INTERNAL_LINK_REG = /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g

// 外部链接正则（URL）
const EXTERNAL_LINK_REG = /\[\[(https?:\/\/[^\]|]+)(?:\|([^\]]+))?\]\]/g
```

**正则说明：**

| 分组 | 含义 |
|------|------|
| `$1` | 链接目标（页面名或 URL） |
| `$2` | 显示文本（可选，不存在时继承 $1） |

**边界条件：**

| 输入 | 解析结果 | 说明 |
|------|---------|------|
| `[[]]` | ❌ 不解析 | 空链接，跳过 |
| `[[页面]]` | ✅ 解析 | 正常解析 |
| `[[页面\|别名]]` | ✅ 解析 | 正常解析 |
| `[[页面#块ID]]` | ✅ 解析，$1 = "页面#块ID" | 锚点存为 $1 的一部分 |
| `[[#标签]]` | ✅ 解析 | 以 `#` 开头视为标签，非链接 |
| `[[页面 \| 别名]]` | ⚠️ 行为待定 | 含空格，建议 trim 处理 |

---

## 3. 解析时机

### 3.1 策略选择

Phase 1 采用 **保存时解析**（Save-time Parsing）。

| 策略 | 优点 | 缺点 |
|------|------|------|
| **保存时解析**（Phase 1 采用） | 写入稳定，数据库操作可批量 | 链接预览/高亮有延迟 |
| 实时解析（输入时） | 即时高亮反馈 | 频繁数据库操作，状态管理复杂 |

**说明：**
- 用户输入时，仅做语法检测和临时高亮（纯 UI 层）
- Block 保存时，执行完整解析，更新 Link 表
- 高亮使用 tiptap Mark，不写入数据库

### 3.2 解析流程

```
用户输入 [[页面名]]
    │
    ▼
┌─────────────────────────────────────┐
│  tiptap Mark 层                      │  ← 纯 UI，无数据库操作
│  实时高亮 [[...]] 文本               │
└─────────────────────────────────────┘
    │
    │ 用户触发保存（Ctrl+S / 失焦 / 自动保存）
    ▼
┌─────────────────────────────────────┐
│  Parser.parseBlockContent(content)  │  ← 解析 [[...]] 片段
│                                     │
│  1. 提取所有 [[...]] 匹配            │
│  2. 分类：内部链接 / 外部链接        │
│  3. 查表：匹配 targetPageId          │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Link 表操作                         │
│                                     │
│  1. 删除 sourceBlockId 的旧 Link    │
│  2. 插入新 Link 记录                 │
│  3. 事务保证原子性                   │
└─────────────────────────────────────┘
```

---

## 4. 页面匹配逻辑

### 4.1 内部链接匹配规则

当解析到 `[[页面名]]` 时，按以下顺序查找目标 Page：

```
1. 精确匹配 Page.title = "页面名"
2. 精确匹配 Page.alias 包含 "页面名"
3. 模糊匹配（Phase 1 跳过，性能待优化）
```

**未找到匹配页面时的行为：**

| 场景 | 行为 | 说明 |
|------|------|------|
| 目标页面不存在 | 创建悬空链接（Dangling Link） | targetPageId 存 NULL，displayText = "页面名"，创建后变成普通链接 |
| 用户点击悬空链接 | 自动创建 Page 并跳转 | 交互上等价于"新建页面" |

**悬空链接处理：**

```typescript
interface ParsedLink {
  targetPageId: string | null  // null = 悬空链接
  displayText: string
  position: { start: number; end: number }
  isExternal: boolean
  isDangling: boolean  // 目标页面不存在
}
```

### 4.2 匹配优先级

```typescript
async function resolvePage(target: string): Promise<Page | null> {
  // 1. 精确匹配 title
  const byTitle = await db.pages.where('title').equals(target).first()
  if (byTitle) return byTitle

  // 2. 精确匹配 alias
  const byAlias = await db.pages.filter(p => p.alias?.includes(target)).first()
  if (byAlias) return byAlias

  // 3. 未找到 → 返回 null（悬空链接）
  return null
}
```

---

## 5. 存储策略

### 5.1 Link 表操作

**写入时机：**
- Block 保存时
- Property 解析时（Property 中含 `[[...]]`）

**删除时机：**
- Block 内容变更，旧的 `[[...]]` 被删除 → 对应 Link 记录删除
- Block 删除 → 级联删除 sourceBlockId 的所有 Link

**更新策略：**
- 不做增量更新，每次保存时全量替换该 Block 的 Link 记录
- 理由：Block 内容变更频率低，全量替换逻辑简单，事务保证一致性

### 5.2 事务操作

```typescript
async function saveBlockLinks(blockId: string, links: ParsedLink[]): Promise<void> {
  await db.transaction('rw', db.links, async () => {
    // 1. 删除旧记录
    await db.links.where('sourceBlockId').equals(blockId).delete()

    // 2. 插入新记录
    // IndexedDB schema: createdAt 存 number 时间戳；转换由 adapter 层处理
    const createdAt = Date.now()
    for (const link of links) {
      await db.links.add({
        sourceBlockId: blockId,
        targetPageId: link.targetPageId,
        displayText: link.displayText,
        position: link.position?.start,
        linkType: link.isExternal ? 'external' : 'internal',
        createdAt
      })
    }
  })
}
```

### 5.3 索引设计

```typescript
// 与 storage-spec.md §0 和 data-model.md SQLite DDL 保持一致
db.version(1).stores({
  blocks: 'id, parentId, pageId, left, createdAt, updatedAt',
  pages: 'id, title, createdAt, updatedAt',
  links: '++id, sourceBlockId, targetPageId, linkType'
})
```

**关键查询场景：**

```typescript
// 场景1：获取 Block X 的所有外链（用于渲染）
async function getOutlinks(blockId: string): Promise<Link[]> {
  return db.links.where('sourceBlockId').equals(blockId).toArray()
}

// 场景2：获取 Page P 的所有反向引用（Backlinks）
async function getBacklinks(pageId: string): Promise<BacklinkItem[]> {
  return db.links
    .where('targetPageId').equals(pageId)
    .toArray()
    .then(links => Promise.all(
      links.map(async link => {
        const block = await db.blocks.get(link.sourceBlockId)
        return { link, block }
      })
    ))
}

// 场景3：获取 Page P 的引用计数（轻量，用于侧边栏展示）
async function getBacklinkCount(pageId: string): Promise<number> {
  return db.links.where('targetPageId').equals(pageId).count()
}
```

---

## 6. UI 交互

### 6.1 渲染层（tiptap Mark）

双链高亮和交互完全在 tiptap Mark 层实现，不污染数据模型。

```typescript
// src/extensions/LinkMark.ts
import { Mark, mergeAttributes } from '@tiptap/core'

export const LinkMark = Mark.create({
  name: 'linkMark',

  addAttributes() {
    return {
      href: { default: null },
      isExternal: { default: false },
      targetPageId: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-link]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const className = HTMLAttributes.isExternal ? 'ext-link' : 'int-link'
    return ['span', mergeAttributes({ class: className, 'data-link': '' }), 0]
  },

  // 点击事件在 Editor.vue 中通过 click handler 处理
})
```

**CSS 样式：**

```css
.int-link {
  color: var(--link-color, #4f86f7);
  cursor: pointer;
  border-bottom: 1px dashed currentColor;
}

.int-link:hover {
  border-bottom-style: solid;
}

.ext-link {
  color: var(--ext-link-color, #8b5cf6);
  cursor: pointer;
}

.dangling-link {
  color: var(--link-color, #4f86f7);
  opacity: 0.7;
  border-bottom: 1px dashed currentColor;
}
```

### 6.2 点击行为

| 链接类型 | 点击行为 |
|---------|---------|
| 内部链接（页面存在） | 跳转到目标 Page |
| 内部链接（悬空/页面不存在） | 创建 Page → 跳转到新建 Page |
| 外部链接 | 在新标签页打开 |

**实现：**

```typescript
// Editor.vue
function handleLinkClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.dataset.link) return

  const pageId = target.dataset.pageId
  const href = target.dataset.href

  if (href) {
    // 外部链接
    window.open(href, '_blank')
  } else if (pageId) {
    // 内部链接（已解析）
    router.push({ name: 'page', params: { id: pageId } })
  } else {
    // 悬空链接 → 创建页面
    const displayText = target.textContent
    createAndNavigate(displayText)
  }
}
```

### 6.3 Hover 预览（Phase 1 跳过）

Phase 1 不实现 Hover 预览，避免复杂度超标。后续迭代可加：

| 功能 | 优先级 |
|------|--------|
| Hover 显示页面标题 | Phase 2 |
| Hover 显示 Block 内容摘要 | Phase 2 |
| Hover 预览图（截图） | 远期 |

### 6.4 Backlinks 面板

**展示位置：** Page 详情页右侧面板（或底部展开区域）

**数据结构：**

```typescript
interface BacklinkItem {
  sourceBlock: Block
  sourcePage: Page
  linkDisplayText: string
  context: string  // Block.content 截取（链接前后各 N 个字符）
}
```

**展示格式：**

```
← 3 个页面引用

┌─────────────────────────────────────────┐
│ 📄 数据模型设计                          │
│ "...结论见 [[Link 解析规范]] ..."        │
└─────────────────────────────────────────┘
│ 📄 技术选型                              │
│ "...相关讨论在 [[Link 解析规范]] ..."    │
└─────────────────────────────────────────┘
```

---

## 7. 解析器实现

### 7.1 核心模块

```typescript
// src/utils/linkParser.ts

const INTERNAL_LINK_REG = /\[\[([^\]|#]+?)(?:\|([^\]]+?))?\]\]/g
const EXTERNAL_LINK_REG = /\[\[(https?:\/\/[^\]|]+?)(?:\|([^\]]+?))?\]\]/g

interface ParseOptions {
  blockId: string
  onPageResolve: (title: string) => Promise<string | null>  // 返回 Page.id 或 null
}

export interface ParsedLink {
  target: string       // 原始目标文本（页面名或 URL）
  displayText: string  // 显示文本
  isExternal: boolean
  targetPageId: string | null
  isDangling: boolean
  position: { start: number; end: number }
}

export async function parseBlockContent(
  content: string,
  options: ParseOptions
): Promise<ParsedLink[]> {
  const links: ParsedLink[] = []

  // 1. 提取内部链接
  let match: RegExpExecArray | null
  INTERNAL_LINK_REG.lastIndex = 0
  while ((match = INTERNAL_LINK_REG.exec(content)) !== null) {
    const [full, target, alias] = match
    if (!target.trim()) continue  // 跳过空链接 [[]]

    const displayText = alias?.trim() || target.trim()
    const targetPageId = await options.onPageResolve(target.trim())

    links.push({
      target: target.trim(),
      displayText,
      isExternal: false,
      targetPageId,
      isDangling: targetPageId === null,
      position: { start: match.index, end: match.index + full.length }
    })
  }

  // 2. 提取外部链接
  EXTERNAL_LINK_REG.lastIndex = 0
  while ((match = EXTERNAL_LINK_REG.exec(content)) !== null) {
    const [full, url, alias] = match
    const displayText = alias?.trim() || url

    links.push({
      target: url,
      displayText,
      isExternal: true,
      targetPageId: null,
      isDangling: false,
      position: { start: match.index, end: match.index + full.length }
    })
  }

  return links
}
```

### 7.2 与 Property 解析的配合

当 Block 的 `properties` 字段（JSON 对象）中某属性值为 `[[...]]` 格式时，需将其解析为 Page 引用并写入 Link 表。

**实现：复用 parseBlockContent，包裹 Property value 为占位文本**

```typescript
import { parseBlockContent } from './linkParser'

/**
 * 解析 Block properties 中的 [[...]] 引用。
 * 策略：将 Property value 包裹为占位文本，调用已有的 parseBlockContent 逻辑。
 * 注意：properties 中可能有多个属性含 [[...]]，需逐属性处理。
 */
export interface PropertyLinkResult {
  blockId: string
  links: ParsedLink[]  // 与 Block content 的 Link 共用一套结构
}

export async function parsePropertyLinks(
  blockId: string,
  properties: Record<string, any>,
  onPageResolve: (title: string) => Promise<string | null>
): Promise<ParsedLink[]> {
  const links: ParsedLink[] = []

  for (const [_key, rawValue] of Object.entries(properties)) {
    // 跳过非字符串值
    if (typeof rawValue !== 'string') continue

    // 跳过不含 [[ 的值
    if (!rawValue.includes('[[')) continue

    // 跳过多行文本（""" 包裹）
    if (rawValue.trim().startsWith('"""')) continue

    // 包裹为虚拟文本以复用解析器
    // 注意：同一 Property value 中可能有多个 [[...]]，parseBlockContent 会全部提取
    const virtualContent = rawValue
    const parsed = await parseBlockContent(virtualContent, { onPageResolve })
    links.push(...parsed)
  }

  return links
}
```

**写入 Link 表的统一流程：**

```typescript
async function saveBlockAllLinks(
  blockId: string,
  blockContent: string,
  properties: Record<string, any>
): Promise<void> {
  // 1. 解析 Block content 中的 [[...]]
  const contentLinks = await parseBlockContent(blockContent, { onPageResolve })

  // 2. 解析 Properties 中的 [[...]]
  const propertyLinks = await parsePropertyLinks(blockId, properties, onPageResolve)

  // 3. 合并（注意去重：同一个 targetPageId 只保留一条 Link）
  const allLinks = deduplicateLinks([...contentLinks, ...propertyLinks])

  // 4. 事务写入 Link 表（覆盖式）
  await saveBlockLinks(blockId, allLinks)
}

function deduplicateLinks(links: ParsedLink[]): ParsedLink[] {
  const seen = new Set<string>()
  return links.filter(link => {
    const key = `${link.targetPageId ?? link.target}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
```

**注意：** Property 解析与 Block content 解析共用同一套 `ParsedLink` 结构，最终统一写入 Link 表。

---

## 8. 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| `[[]]` 空链接 | 跳过，不写入 Link 表 |
| `[[页面名\|]]` 空别名 | displayText = "页面名" |
| `[[页面\|别名\|多余]]` | 取第一个 `\|` 分隔，忽略后续 |
| 页面名含 `\|` | 正则匹配贪婪行为：取第一个 `\|` 作为分隔符 |
| 循环引用（A→B→A） | 允许，不做循环检测 |
| 自引用（Block 在 Page 内链接自己） | 允许，UI 层可过滤 |
| Block 内容变更但未保存 | 旧 Link 记录保留，直到下次保存 |
| 网络断开时点击外链 | 浏览器默认行为，打开新标签页 |

---

## 9. 待确认事项

| 事项 | 说明 |
|------|------|
| 别名含 `\|` | 暂不支持，如需支持改用反向拆分 |
| 模糊匹配 | Phase 2 考虑（模糊搜索补全） |
| Hover 预览 | Phase 2 考虑 |
| 链接补全（输入时） | Phase 2 考虑（类似 Logseq 的 `[[` 补全） |
| 外部链接识别 | 当前以 http://https:// 开头判断，可扩展其他协议 |

---

## 10. 测试用例

```typescript
describe('Link Parser', () => {
  test('解析内部链接 [[页面]]', () => {
    const links = parseBlockContent('见 [[数据模型]]')
    expect(links).toHaveLength(1)
    expect(links[0].displayText).toBe('数据模型')
    expect(links[0].isExternal).toBe(false)
  })

  test('解析别名链接 [[页面|别名]]', () => {
    const links = parseBlockContent('参考 [[数据模型|DM规范]]')
    expect(links[0].displayText).toBe('DM规范')
    expect(links[0].target).toBe('数据模型')
  })

  test('解析外部链接', () => {
    const links = parseBlockContent('官网 [[https://example.com]]')
    expect(links[0].isExternal).toBe(true)
    expect(links[0].target).toBe('https://example.com')
  })

  test('跳过空链接 [[]]', () => {
    const links = parseBlockContent('测试 [[]] 链接')
    expect(links).toHaveLength(0)
  })

  test('多链接解析', () => {
    const links = parseBlockContent('参考 [[A]] 和 [[B|别名B]]')
    expect(links).toHaveLength(2)
  })

  test('链接边界正确', () => {
    const links = parseBlockContent('前缀 [[页面]] 后缀')
    expect(links[0].position.start).toBe(2)  // [[ 起始位置
    expect(links[0].position.end).toBe(9)    // ]] 结束位置
  })
})
```

---

*文档由 AI 助手协助生成，待开发者评审确认。*
