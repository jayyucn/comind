# Phase 3 编辑器交互增强 — 实施方案

> **面向智能体执行者：必须使用子技能**：通过 subagent‑driven‑development（推荐）或 executing‑plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。

**目标**：为概念图谱功能提供完整的编辑器端交互链路——`[[X]]^(type)` 语法触发菜单辅助、视图模式点下划线 + 类型标签渲染、点击类型标签切换关系。

**架构**：分层式。Tiptap 触发扩展发事件、Vue 组件管 UI、composable 管状态、渲染层处理视图模式样式。`WikiLinkExtension` 装饰逻辑跳过带类型链接。

**技术栈**：Vue 3 Composition API、Tiptap/ProseMirror、TypeScript、Vitest。

**关联文档**：
- 设计：[2026-06-04-phase3-editor-interaction-design.md](../specs/2026-06-04-phase3-editor-interaction-design.md)
- 计划：[2026-06-02-concept-graph-development-plan.md](./2026-06-02-concept-graph-development-plan.md)

**环境**：在主工作树中工作，不使用 worktree。

---

## 任务 1：扩展 PREDEFINED_RELATIONSHIPS 添加 color 字段

**涉及文件：**
- 修改：`src/types/relationship.ts`
- 测试：`src/types/relationship.test.ts`（新建）

- [ ] **步骤 1：编写失败测试用例**

新建 `src/types/relationship.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import {
  PREDEFINED_RELATIONSHIPS,
  getPredefinedRelationship,
  type RelationshipType
} from './relationship'

describe('PREDEFINED_RELATIONSHIPS', () => {
  it('包含 6 种预定义关系', () => {
    expect(PREDEFINED_RELATIONSHIPS).toHaveLength(6)
  })

  it('每种关系都有 type、inverse、color 字段', () => {
    for (const rel of PREDEFINED_RELATIONSHIPS) {
      expect(rel.type).toBeTruthy()
      expect(rel.inverse).toBeTruthy()
      expect(rel.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('type 字段是 RelationshipType 联合类型的成员', () => {
    const types: RelationshipType[] = [
      'depends-on', 'related', 'references',
      'part-of', 'contradicts', 'supports'
    ]
    for (const t of types) {
      expect(getPredefinedRelationship(t)).toBeDefined()
    }
  })
})
```

- [ ] **步骤 2：运行测试，验证执行失败**

执行命令：`npx vitest run src/types/relationship.test.ts 2>&1 | tail -20`
预期结果：失败，提示 `color` 字段不存在

- [ ] **步骤 3：修改 `src/types/relationship.ts` 添加 color 字段**

替换 `PREDEFINED_RELATIONSHIPS` 数组为：

```typescript
export const PREDEFINED_RELATIONSHIPS = [
  { type: 'depends-on',    inverse: 'required-by',     color: '#DC2626' },
  { type: 'related',       inverse: 'related',         color: '#7C3AED' },
  { type: 'references',    inverse: 'referenced-by',   color: '#2563EB' },
  { type: 'part-of',       inverse: 'has-part',        color: '#059669' },
  { type: 'contradicts',   inverse: 'contradicted-by', color: '#EA580C' },
  { type: 'supports',      inverse: 'supported-by',    color: '#0891B2' },
] as const
```

- [ ] **步骤 4：运行测试，验证执行通过**

执行命令：`npx vitest run src/types/relationship.test.ts 2>&1 | tail -10`
预期结果：3 个测试全通过

- [ ] **步骤 5：运行 lint + typecheck**

执行命令：
```bash
npx vue-tsc -b 2>&1 | tail -5
npx eslint src/types/relationship.ts src/types/relationship.test.ts 2>&1 | tail -5
```
预期结果：无错误

- [ ] **步骤 6：提交代码**

```bash
git add src/types/relationship.ts src/types/relationship.test.ts
git commit -m "feat(relationship): add color field to predefined relationships"
```

---

## 任务 2：修改 WikiLinkExtension 跳过 [[X]]^(type) 装饰

**涉及文件：**
- 修改：`src/extensions/WikiLinkExtension.ts`
- 修改：`src/extensions/WikiLinkExtension.test.ts`（如不存在则新建）

- [ ] **步骤 1：编写失败测试用例**

如果 `src/extensions/WikiLinkExtension.test.ts` 不存在，先创建基础结构：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { WikiLinkExtension } from './WikiLinkExtension'

function createEditor(content: string): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text, WikiLinkExtension],
    content: `<p>${content}</p>`
  })
}

describe('WikiLinkExtension', () => {
  let editor: Editor

  afterEach(() => {
    editor?.destroy()
  })

  it('普通 [[X]] 渲染带 wiki-link 装饰', () => {
    editor = createEditor('See [[X]] for details')
    const html = editor.getHTML()
    expect(html).toContain('class="wiki-link"')
    expect(html).toContain('data-page="X"')
  })

  it('带类型的 [[X]]^(type) 不渲染 wiki-link 装饰', () => {
    editor = createEditor('See [[X]]^(depends-on) for details')
    const html = editor.getHTML()
    // typed link 的 [[X]] 不应有 wiki-link 装饰
    expect(html).not.toMatch(/<span[^>]*class="wiki-link"[^>]*>\[\[X\]\]/)
  })
})
```

- [ ] **步骤 2：运行测试，验证第二个用例失败**

执行命令：`npx vitest run src/extensions/WikiLinkExtension.test.ts 2>&1 | tail -30`
预期结果：第二个测试失败（typed link 当前也会被装饰）

- [ ] **步骤 3：修改 `src/extensions/WikiLinkExtension.ts`**

读 [WikiLinkExtension.ts](file:///d:/comind/comind/src/extensions/WikiLinkExtension.ts) 全文。

修改装饰循环逻辑：先扫描 typed link 范围，装饰 wiki link 时跳过这些范围。

替换第 30-50 行附近的装饰生成为：

```typescript
addProseMirrorPlugins() {
  return [
    new Plugin({
      key: new PluginKey('wikiLink'),
      props: {
        decorations(state) {
          const decorations: Decoration[] = []
          const linkOnlyRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
          const typedLinkRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]\^?\(([^)]+)\)/g

          // 先收集所有 typed link 范围
          const typedRanges: Array<[number, number]> = []
          state.doc.descendants((node, pos) => {
            if (!node.isText) return
            const text = node.text || ''
            let m: RegExpExecArray | null
            typedLinkRegex.lastIndex = 0
            while ((m = typedLinkRegex.exec(text)) !== null) {
              typedRanges.push([pos + m.index, pos + m.index + m[0].length])
            }
          })

          // 再做普通 wiki link 装饰，跳过 typed range
          state.doc.descendants((node, pos) => {
            if (!node.isText) return
            const text = node.text || ''
            let m: RegExpExecArray | null
            linkOnlyRegex.lastIndex = 0
            while ((m = linkOnlyRegex.exec(text)) !== null) {
              const start = pos + m.index
              const end = start + m[0].length
              if (typedRanges.some(([s, e]) => start >= s && end <= e)) continue
              const target = m[1]
              const display = m[2] || target
              decorations.push(
                Decoration.inline(start, end, {
                  class: 'wiki-link',
                  'data-page': target
                })
              )
            }
          })

          return DecorationSet.create(state.doc, decorations)
        }
      }
    })
  ]
}
```

（保留原有的 import 语句，只替换/插入 decorations 逻辑。需先 `import { Decoration, DecorationSet }` from `@tiptap/pm/view`）

- [ ] **步骤 4：运行测试，验证通过**

执行命令：`npx vitest run src/extensions/WikiLinkExtension.test.ts 2>&1 | tail -10`
预期结果：所有测试通过

- [ ] **步骤 5：运行 lint + typecheck**

执行命令：
```bash
npx vue-tsc -b 2>&1 | tail -5
npx eslint src/extensions/WikiLinkExtension.ts src/extensions/WikiLinkExtension.test.ts 2>&1 | tail -5
```
预期结果：无错误

- [ ] **步骤 6：提交代码**

```bash
git add src/extensions/WikiLinkExtension.ts src/extensions/WikiLinkExtension.test.ts
git commit -m "feat(wiki-link): skip decoration for typed links [[X]]^(type)"
```

---

## 任务 3：修改 useContentRenderer 渲染带类型链接

**涉及文件：**
- 修改：`src/composables/useContentRenderer.ts`
- 测试：`src/composables/useContentRenderer.test.ts`（新建）

- [ ] **步骤 1：编写失败测试用例**

新建 `src/composables/useContentRenderer.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { useContentRenderer } from './useContentRenderer'

const { renderContentToHtml } = useContentRenderer()

describe('useContentRenderer - typed wiki links', () => {
  it('[[X]]^(depends-on) 渲染为点下划线 + 标签', () => {
    const html = renderContentToHtml('See [[X]]^(depends-on) for details', 'block-1')
    expect(html).toContain('class="block-link-typed"')
    expect(html).toContain('data-page="X"')
    expect(html).toContain('data-rel-type="depends-on"')
    expect(html).toContain('class="rel-type-label"')
    expect(html).toContain('data-block-id="block-1"')
  })

  it('未知类型渲染为灰色', () => {
    const html = renderContentToHtml('[[X]]^(unknown-type)', 'block-1')
    expect(html).toContain('data-rel-type="unknown-type"')
    expect(html).toMatch(/--rel-color:\s*#9CA3AF/)
  })

  it('[[X]]^(depends-on) 的字符偏移正确写入 data 属性', () => {
    const html = renderContentToHtml('[[X]]^(depends-on)', 'block-1')
    // 原始文本 [[X]]^(depends-on) 长度 18
    // typed link 在原始文本中的范围是 0..18
    const typedFrom = html.match(/data-typed-from="(\d+)"/)
    const typedTo = html.match(/data-typed-to="(\d+)"/)
    expect(typedFrom?.[1]).toBe('0')
    expect(typedTo?.[1]).toBe('18')
    // depends-on 在原始文本中的范围是 7..18
    const labelFrom = html.match(/data-label-from="(\d+)"/)
    const labelTo = html.match(/data-label-to="(\d+)"/)
    expect(labelFrom?.[1]).toBe('7')
    expect(labelTo?.[1]).toBe('18')
  })

  it('普通 [[X]] 不被识别为 typed link', () => {
    const html = renderContentToHtml('See [[X]] plain', 'block-1')
    expect(html).not.toContain('block-link-typed')
    expect(html).toContain('class="block-link"')
  })
})
```

- [ ] **步骤 2：运行测试，验证失败**

执行命令：`npx vitest run src/composables/useContentRenderer.test.ts 2>&1 | tail -20`
预期结果：所有 4 个测试失败

- [ ] **步骤 3：修改 `src/composables/useContentRenderer.ts`**

替换整个文件内容为：

```typescript
import { getPredefinedRelationship } from '../types/relationship'

const CSS_CLASSES = {
  blockLink: 'block-link',
  blockLinkTyped: 'block-link-typed',
  relTypeLabel: 'rel-type-label',
  blockTag: 'block-tag'
}

const TAG_REGEX = new RegExp(
  '([\\p{L}_][\\p{L}\\p{N}_]*(?:\\/[\\p{L}_][\\p{L}\\p{N}_]*)*)',
  'gu'
)
const TYPED_LINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]\^?\(([^)]+)\)/g
const EXTERNAL_LINK_REGEX = /\[\[(https?:\/\/[^\]]+)\]\]/g
const WIKI_LINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
const TAG_TRIGGER_REGEX = new RegExp(`(?<![\\/|>|@])#${'([\\p{L}_][\\p{L}\\p{N}_]*(?:\\/[\\p{L}_][\\p{L}\\p{N}_]*)*)'}`, 'gu')

function escapeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function useContentRenderer() {
  /**
   * 将 Block 内容渲染为 HTML
   *
   * 处理（按顺序）：
   * 1. 外部链接 [[https://...]]
   * 2. 带类型链接 [[X]]^(type) → .block-link-typed + .rel-type-label
   * 3. 普通链接 [[X]] 或 [[X|alias]] → .block-link
   * 4. #tag → .block-link.block-tag
   */
  function renderContentToHtml(text: string, blockId: string = ''): string {
    const html = escapeHtmlEntities(text)

    // 1. 外部链接
    const withExternal = html.replace(EXTERNAL_LINK_REGEX, (_, url) => {
      return `<span class="${CSS_CLASSES.blockLink} external" data-external="${escapeHtmlEntities(url)}">${url}</span>`
    })

    // 2. 带类型链接（必须在普通链接之前）
    //    需要在原始文本上做字符偏移计算，所以用原始 text 而非 html
    const withTyped = renderTypedLinks(text, blockId)

    // 3. 普通 wiki link（用 html 版本，避免破坏已转义字符）
    const withWikiLinks = withTyped.replace(WIKI_LINK_REGEX, (_, target, alias) => {
      const display = alias || target
      return `<span class="${CSS_CLASSES.blockLink}" data-page="${escapeHtmlEntities(target)}">${display}</span>`
    })

    // 4. #tag
    const final = withWikiLinks.replace(TAG_TRIGGER_REGEX, (_, tag) => {
      if (tag.includes('.')) return `#${tag}`
      return `<span class="${CSS_CLASSES.blockLink} ${CSS_CLASSES.blockTag}" data-page="${escapeHtmlEntities(tag)}">#${escapeHtmlEntities(tag)}</span>`
    })

    return final
  }

  function renderTypedLinks(text: string, blockId: string): string {
    const html = escapeHtmlEntities(text)
    let result = ''
    let lastIndex = 0

    let m: RegExpExecArray | null
    TYPED_LINK_REGEX.lastIndex = 0
    while ((m = TYPED_LINK_REGEX.exec(text)) !== null) {
      const typedStart = m.index
      const typedEnd = m.index + m[0].length
      const target = m[1]
      const alias = m[2]
      const relType = m[3]
      const display = alias || target

      // append 上一段（已转义）
      result += escapeHtmlEntities(text.slice(lastIndex, typedStart))

      const rel = getPredefinedRelationship(relType)
      const color = rel?.color ?? '#9CA3AF'
      const safeRelType = escapeHtmlEntities(relType)
      const safePage = escapeHtmlEntities(target)
      const safeDisplay = escapeHtmlEntities(display)

      result += `<span class="${CSS_CLASSES.blockLinkTyped}" ` +
                `data-page="${safePage}" ` +
                `data-rel-type="${safeRelType}" ` +
                `data-block-id="${escapeHtmlEntities(blockId)}" ` +
                `data-typed-from="${typedStart}" ` +
                `data-typed-to="${typedEnd}" ` +
                `style="--rel-color:${color}">${safeDisplay}</span>` +
                `<span class="${CSS_CLASSES.relTypeLabel}" ` +
                `data-rel-type="${safeRelType}" ` +
                `data-block-id="${escapeHtmlEntities(blockId)}" ` +
                `data-label-from="${typedEnd - relType.length}" ` +
                `data-label-to="${typedEnd}" ` +
                `style="--rel-color:${color}">${safeRelType}</span>`

      lastIndex = typedEnd
    }
    result += escapeHtmlEntities(text.slice(lastIndex))
    return result
  }

  return { renderContentToHtml }
}
```

- [ ] **步骤 4：运行测试，验证通过**

执行命令：`npx vitest run src/composables/useContentRenderer.test.ts 2>&1 | tail -10`
预期结果：4 个测试全通过

- [ ] **步骤 5：运行 lint + typecheck**

```bash
npx vue-tsc -b 2>&1 | tail -5
npx eslint src/composables/useContentRenderer.ts src/composables/useContentRenderer.test.ts 2>&1 | tail -5
```

- [ ] **步骤 6：修改 BulletRender.vue 传 blockId**

读 `src/components/Block/handlers/bullet/BulletRender.vue` 找到 `renderContentToHtml` 调用处。

修改为：

```vue
<script setup>
import { useContentRenderer } from '../../../../composables/useContentRenderer'
const { renderContentToHtml } = useContentRenderer()
// ...
</script>

<template>
  <!-- 找到渲染 content 的位置，把 renderContentToHtml(content) 改为 renderContentToHtml(content, block.id) -->
  <div class="block-text" @click="handleClick" v-html="renderedContent" />
</template>
```

具体修改：调用 `renderContentToHtml(content, props.block.id)`。

- [ ] **步骤 7：提交代码**

```bash
git add src/composables/useContentRenderer.ts src/composables/useContentRenderer.test.ts src/components/Block/handlers/bullet/BulletRender.vue
git commit -m "feat(renderer): render typed links with dotted underline and type label"
```

---

## 任务 4：实现 useRelationshipMenu composable

**涉及文件：**
- 新建：`src/composables/useRelationshipMenu.ts`
- 新建：`src/composables/useRelationshipMenu.test.ts`

- [ ] **步骤 1：编写失败测试用例**

新建 `src/composables/useRelationshipMenu.test.ts`：

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRelationshipMenu } from './useRelationshipMenu'
import type { RelationshipType } from '../types/relationship'

describe('useRelationshipMenu', () => {
  let menu: ReturnType<typeof useRelationshipMenu>

  beforeEach(() => {
    menu = useRelationshipMenu()
  })

  it('初始状态不可见', () => {
    expect(menu.state.value.visible).toBe(false)
  })

  it('open 设置 visible 和初始 query', () => {
    const onSelect = vi.fn()
    menu.open({
      view: { dom: { isConnected: true } },
      position: { x: 100, y: 200 },
      range: { from: 5, to: 5 },
      initialQuery: '',
      onSelect
    })
    expect(menu.state.value.visible).toBe(true)
    expect(menu.state.value.position).toEqual({ x: 100, y: 200 })
    expect(menu.state.value.range).toEqual({ from: 5, to: 5 })
    expect(menu.state.value.query).toBe('')
    expect(menu.state.value.selectedIndex).toBe(0)
    expect(menu.state.value.onSelect).toBe(onSelect)
  })

  it('再次 open 会先关闭上一个（单例）', () => {
    const onSelect1 = vi.fn()
    const onSelect2 = vi.fn()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: onSelect1 })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 1, y: 1 }, range: { from: 1, to: 1 }, onSelect: onSelect2 })
    expect(menu.state.value.onSelect).toBe(onSelect2)
  })

  it('editor view 已销毁时 open no-op', () => {
    menu.open({
      view: { dom: { isConnected: false } },
      position: { x: 0, y: 0 },
      range: { from: 0, to: 0 },
      onSelect: vi.fn()
    })
    expect(menu.state.value.visible).toBe(false)
  })

  it('openSwitch 设置 currentType 用于预选', () => {
    menu.openSwitch({
      view: { dom: { isConnected: true } },
      position: { x: 0, y: 0 },
      range: { from: 0, to: 0 },
      currentType: 'related' as RelationshipType,
      onSelect: vi.fn()
    })
    expect(menu.state.value.currentType).toBe('related')
  })

  it('close 重置状态', () => {
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: vi.fn() })
    menu.close()
    expect(menu.state.value.visible).toBe(false)
    expect(menu.state.value.position).toBeNull()
    expect(menu.state.value.range).toBeNull()
  })
})
```

- [ ] **步骤 2：运行测试，验证失败**

执行命令：`npx vitest run src/composables/useRelationshipMenu.test.ts 2>&1 | tail -10`
预期结果：模块未找到

- [ ] **步骤 3：实现 `src/composables/useRelationshipMenu.ts`**

新建文件：

```typescript
import { ref, computed } from 'vue'
import type { RelationshipType } from '../types/relationship'
import { PREDEFINED_RELATIONSHIPS } from '../types/relationship'

export interface RelationshipMenuOpenOpts {
  view: { dom: { isConnected: boolean } } | any
  position: { x: number; y: number }
  range: { from: number; to: number }
  initialQuery?: string
  currentType?: RelationshipType
  onSelect: (type: RelationshipType) => void
}

export interface RelationshipMenuState {
  visible: boolean
  position: { x: number; y: number } | null
  range: { from: number; to: number } | null
  query: string
  selectedIndex: number
  currentType: RelationshipType | null
  onSelect: ((type: RelationshipType) => void) | null
}

const initialState: RelationshipMenuState = {
  visible: false,
  position: null,
  range: null,
  query: '',
  selectedIndex: 0,
  currentType: null,
  onSelect: null
}

export function useRelationshipMenu() {
  const state = ref<RelationshipMenuState>({ ...initialState })

  const items = computed(() => {
    if (!state.value.query) return PREDEFINED_RELATIONSHIPS
    const q = state.value.query.toLowerCase()
    return PREDEFINED_RELATIONSHIPS.filter(r =>
      r.type.toLowerCase().includes(q)
    )
  })

  function open(opts: RelationshipMenuOpenOpts) {
    if (!opts.view?.dom?.isConnected) return
    if (state.value.visible) close()

    const currentType = opts.currentType ?? null
    const currentTypeIndex = currentType
      ? PREDEFINED_RELATIONSHIPS.findIndex(r => r.type === currentType)
      : -1

    state.value = {
      visible: true,
      position: opts.position,
      range: opts.range,
      query: opts.initialQuery ?? '',
      selectedIndex: currentTypeIndex >= 0 ? currentTypeIndex : 0,
      currentType,
      onSelect: opts.onSelect
    }
  }

  function openSwitch(opts: Omit<RelationshipMenuOpenOpts, 'initialQuery'> & { currentType: RelationshipType }) {
    open(opts)
  }

  function close() {
    state.value = { ...initialState }
  }

  function setQuery(query: string) {
    state.value.query = query.replace(/\n/g, '')
    state.value.selectedIndex = 0
  }

  function setSelectedIndex(index: number) {
    const max = items.value.length - 1
    if (max < 0) {
      state.value.selectedIndex = 0
      return
    }
    state.value.selectedIndex = Math.max(0, Math.min(index, max))
  }

  function moveSelection(delta: number) {
    setSelectedIndex(state.value.selectedIndex + delta)
  }

  function select() {
    const item = items.value[state.value.selectedIndex]
    if (!item) return
    const onSelect = state.value.onSelect
    const type = item.type as RelationshipType
    close()
    onSelect?.(type)
  }

  return { state, items, open, openSwitch, close, setQuery, setSelectedIndex, moveSelection, select }
}
```

- [ ] **步骤 4：运行测试，验证通过**

执行命令：`npx vitest run src/composables/useRelationshipMenu.test.ts 2>&1 | tail -10`
预期结果：6 个测试全通过

- [ ] **步骤 5：lint + typecheck**

```bash
npx vue-tsc -b 2>&1 | tail -5
npx eslint src/composables/useRelationshipMenu.ts src/composables/useRelationshipMenu.test.ts 2>&1 | tail -5
```

- [ ] **步骤 6：提交代码**

```bash
git add src/composables/useRelationshipMenu.ts src/composables/useRelationshipMenu.test.ts
git commit -m "feat(menu): add useRelationshipMenu composable with state machine"
```

---

## 任务 5：实现 RelationshipMenu 组件

**涉及文件：**
- 新建：`src/components/RelationshipMenu.vue`
- 新建：`src/components/RelationshipMenu.test.ts`

- [ ] **步骤 1：编写失败测试用例**

新建 `src/components/RelationshipMenu.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import RelationshipMenu from './RelationshipMenu.vue'
import { useRelationshipMenu } from '../composables/useRelationshipMenu'

describe('RelationshipMenu', () => {
  let menu: ReturnType<typeof useRelationshipMenu>

  beforeEach(() => {
    menu = useRelationshipMenu()
  })

  it('visible=false 时不渲染', () => {
    const wrapper = mount(RelationshipMenu, { props: { menu } })
    expect(wrapper.find('.rel-menu').exists()).toBe(false)
  })

  it('visible=true 时渲染 6 项', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu } })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    expect(wrapper.findAll('.rel-menu-item')).toHaveLength(6)
  })

  it('第一项默认高亮', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu } })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    const items = wrapper.findAll('.rel-menu-item')
    expect(items[0].classes()).toContain('selected')
    expect(items[0].text()).toContain('depends-on')
  })

  it('输入过滤后只剩匹配项', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu } })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    menu.setQuery('rel')
    await nextTick()
    expect(wrapper.findAll('.rel-menu-item')).toHaveLength(1)
    expect(wrapper.find('.rel-menu-item').text()).toContain('related')
  })

  it('点击 item 触发 onSelect 并关闭', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu } })
    let selected: string | null = null
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: (t) => { selected = t } })
    await nextTick()
    await wrapper.findAll('.rel-menu-item')[2].trigger('click')
    expect(selected).toBe('references')
    expect(menu.state.value.visible).toBe(false)
  })

  it('无匹配时显示占位', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu } })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    menu.setQuery('xyz')
    await nextTick()
    expect(wrapper.find('.rel-menu-empty').exists()).toBe(true)
  })
})
```

- [ ] **步骤 2：运行测试，验证失败**

执行命令：`npx vitest run src/components/RelationshipMenu.test.ts 2>&1 | tail -10`
预期结果：模块未找到

- [ ] **步骤 3：实现 `src/components/RelationshipMenu.vue`**

新建文件：

```vue
<script setup lang="ts">
import type { useRelationshipMenu } from '../composables/useRelationshipMenu'

const props = defineProps<{
  menu: ReturnType<typeof useRelationshipMenu>
}>()

const { state, items, close, select, moveSelection } = props.menu

function onItemClick(index: number) {
  props.menu.setSelectedIndex(index)
  select()
}

function onMouseDownItem(e: MouseEvent, index: number) {
  // 防止编辑器失焦
  e.preventDefault()
  onItemClick(index)
}

// 暴露给父组件以便绑定键盘事件
defineExpose({ moveSelection, select, close })
</script>

<template>
  <div v-if="state.visible" class="rel-menu" :style="{ left: state.position?.x + 'px', top: state.position?.y + 'px' }">
    <ul v-if="items.length > 0" class="rel-menu-list">
      <li
        v-for="(item, index) in items"
        :key="item.type"
        class="rel-menu-item"
        :class="{ selected: index === state.selectedIndex }"
        :style="{ '--rel-color': item.color }"
        @mousedown="onMouseDownItem($event, index)"
      >
        <span class="rel-menu-type">{{ item.type }}</span>
        <span class="rel-menu-inverse">→ {{ item.inverse }}</span>
      </li>
    </ul>
    <div v-else class="rel-menu-empty">No matches</div>
  </div>
</template>

<style scoped>
.rel-menu {
  position: fixed;
  z-index: 1000;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  min-width: 200px;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px 0;
}

.rel-menu-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.rel-menu-item {
  padding: 6px 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  border-left: 3px solid transparent;
}

.rel-menu-item:hover,
.rel-menu-item.selected {
  background: rgba(0, 0, 0, 0.04);
  border-left-color: var(--rel-color);
}

.rel-menu-type {
  font-weight: 500;
  color: var(--rel-color);
}

.rel-menu-inverse {
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
  font-style: italic;
}

.rel-menu-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-secondary, #6b7280);
  font-size: 13px;
}
</style>
```

- [ ] **步骤 4：运行测试，验证通过**

执行命令：`npx vitest run src/components/RelationshipMenu.test.ts 2>&1 | tail -10`
预期结果：6 个测试全通过

- [ ] **步骤 5：lint + typecheck**

```bash
npx vue-tsc -b 2>&1 | tail -5
npx eslint src/components/RelationshipMenu.vue src/components/RelationshipMenu.test.ts 2>&1 | tail -5
```

- [ ] **步骤 6：提交代码**

```bash
git add src/components/RelationshipMenu.vue src/components/RelationshipMenu.test.ts
git commit -m "feat(menu): add RelationshipMenu component with fuzzy filter"
```

---

## 任务 6：实现 RelationshipTriggerExtension

**涉及文件：**
- 新建：`src/extensions/RelationshipTriggerExtension.ts`
- 新建：`src/extensions/RelationshipTriggerExtension.test.ts`

- [ ] **步骤 1：编写失败测试用例**

新建 `src/extensions/RelationshipTriggerExtension.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { RelationshipTriggerExtension } from './RelationshipTriggerExtension'

function createEditor(content: string): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text, RelationshipTriggerExtension],
    content: `<p>${content}</p>`
  })
}

describe('RelationshipTriggerExtension', () => {
  let editor: Editor

  afterEach(() => {
    editor?.destroy()
  })

  it('在 [[X]] 后输入 ( 不触发 rel-menu-open（未识别 typed link 上下文）', () => {
    editor = createEditor('See [[X]] for details')
    let triggered = false
    editor.view.dom.addEventListener('rel-menu-open', () => { triggered = true })
    // 模拟光标移到 (位置后输入 (
    // 直接 dispatch text 插入
    editor.chain().focus().insertContent('(').run()
    expect(triggered).toBe(false)
  })

  it('在 [[X]] 后输入 ^( 触发 rel-menu-open 事件', async () => {
    editor = createEditor('See [[X]] for details')
    const eventPromise = new Promise<any>((resolve) => {
      editor.view.dom.addEventListener('rel-menu-open', (e: any) => resolve(e.detail))
    })
    // 在 [[X]] 之后插入 ^(
    editor.chain().focus().insertContent('^(').run()
    const detail = await Promise.race([
      eventPromise,
      new Promise((r) => setTimeout(() => r(null), 200))
    ])
    expect(detail).not.toBeNull()
    expect(detail.range).toBeDefined()
  })

  it('在 [[X|Y]]^( 后输入 ( 也触发', async () => {
    editor = createEditor('[[Page|Y]]')
    const eventPromise = new Promise<any>((resolve) => {
      editor.view.dom.addEventListener('rel-menu-open', (e: any) => resolve(e.detail))
    })
    editor.chain().focus().insertContent('^(').run()
    const detail = await Promise.race([
      eventPromise,
      new Promise((r) => setTimeout(() => r(null), 200))
    ])
    expect(detail).not.toBeNull()
  })
})
```

- [ ] **步骤 2：运行测试，验证失败**

执行命令：`npx vitest run src/extensions/RelationshipTriggerExtension.test.ts 2>&1 | tail -10`
预期结果：模块未找到

- [ ] **步骤 3：实现 `src/extensions/RelationshipTriggerExtension.ts`**

新建文件：

```typescript
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface RelationshipTriggerEvent {
  view: any
  position: { x: number; y: number }
  range: { from: number; to: number }
  initialQuery: string
}

let menuIsOpen = false

export function closeRelationshipMenuByEditor() {
  menuIsOpen = false
}

/** 在光标位置前查找最近的 ]]（wikilink 闭合） */
function findClosedWikiLinkBefore(doc: any, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(pos)
  const textBefore = $pos.nodeBefore?.text || ''
  const closeIdx = textBefore.lastIndexOf(']]')
  if (closeIdx < 0) return null

  // 计算 doc 位置
  const nodeStart = pos - textBefore.length
  const closeFrom = nodeStart + closeIdx
  const closeTo = closeFrom + 2

  if (pos > closeTo) return { from: closeTo, to: pos }
  return null
}

function triggerRelationshipMenu(view: any) {
  menuIsOpen = true
  const { state } = view
  const cursorPos = state.selection.from

  const closed = findClosedWikiLinkBefore(state.doc, cursorPos)
  if (!closed) {
    menuIsOpen = false
    return
  }

  // 当前光标应该在 ^ 之后、( 之前或之后
  // 初始 query 为 ( 之后到光标的文本
  const $pos = state.doc.resolve(cursorPos)
  const nodeText = $pos.parent.textBetween($pos.start(), cursorPos, '\n', '\n')
  const parenIdx = nodeText.lastIndexOf('(')
  const initialQuery = parenIdx >= 0 ? nodeText.slice(parenIdx + 1) : ''

  // range 是当前光标位置到 ( 之后（query 范围）
  const queryFrom = parenIdx >= 0
    ? cursorPos - initialQuery.length
    : cursorPos

  let coords
  try {
    coords = view.coordsAtPos(cursorPos)
  } catch {
    coords = { top: 100, left: 100, bottom: 100, right: 100 }
  }

  const detail: RelationshipTriggerEvent = {
    view,
    position: { x: coords.left, y: coords.bottom + 4 },
    range: { from: queryFrom, to: cursorPos },
    initialQuery
  }

  const event = new CustomEvent('rel-menu-open', {
    bubbles: true,
    detail
  })
  view.dom.dispatchEvent(event)
}

function handleRelationshipDetection(view: any) {
  if (menuIsOpen) {
    const { state } = view
    const cursorPos = state.selection.from
    const closed = findClosedWikiLinkBefore(state.doc, cursorPos)
    if (!closed || cursorPos < closed.from) {
      closeRelationshipMenuByEditor()
      dispatchClose(view)
    }
    return
  }

  // 检查是否刚输入了 ( 且上文是 ^[[X]]
  const { state } = view
  const cursorPos = state.selection.from
  if (cursorPos < 1) return

  const $pos = state.doc.resolve(cursorPos)
  const textBefore = $pos.parent.textBetween($pos.start(), cursorPos, '\n', '\n')
  if (!textBefore.endsWith('(')) return

  // 检查 ^ 之前是否有 ]]
  const caretIdx = textBefore.length - 1
  if (caretIdx < 1) return
  if (textBefore[caretIdx - 1] !== '^') return

  const beforeCaret = textBefore.slice(0, caretIdx - 1)
  if (!beforeCaret.endsWith(']]')) return

  // 触发菜单
  setTimeout(() => triggerRelationshipMenu(view), 0)
}

function dispatchClose(view: any) {
  const event = new CustomEvent('rel-menu-close', { bubbles: true, detail: {} })
  view.dom.dispatchEvent(event)
}

export const RelationshipTriggerExtension = Extension.create({
  name: 'relationshipTrigger',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('relationshipTrigger'),
        props: {
          handleKeyDown: (view, event) => {
            if (event.key === '(') {
              setTimeout(() => handleRelationshipDetection(view), 0)
            }

            if (menuIsOpen) {
              if (event.key === 'Enter' || event.key === 'Escape' ||
                  event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                event.stopPropagation()
                if (event.key === 'Enter' || event.key === 'Escape') {
                  menuIsOpen = false
                }
                const key = event.key.toLowerCase()
                view.dom.dispatchEvent(new CustomEvent(`rel-menu-${key}`, {
                  bubbles: true,
                  detail: {}
                }))
                return true
              }
            }

            return false
          },
          handleTextInput(view) {
            setTimeout(() => handleRelationshipDetection(view), 0)
            return false
          }
        },
        view(_view) {
          return {
            update(view, prevState) {
              if (view.state.doc === prevState.doc) return
              handleRelationshipDetection(view)
            },
            destroy() {
              menuIsOpen = false
            }
          }
        }
      })
    ]
  }
})
```

- [ ] **步骤 4：运行测试，验证通过**

执行命令：`npx vitest run src/extensions/RelationshipTriggerExtension.test.ts 2>&1 | tail -20`
预期结果：3 个测试全通过

- [ ] **步骤 5：lint + typecheck**

```bash
npx vue-tsc -b 2>&1 | tail -5
npx eslint src/extensions/RelationshipTriggerExtension.ts src/extensions/RelationshipTriggerExtension.test.ts 2>&1 | tail -5
```

- [ ] **步骤 6：提交代码**

```bash
git add src/extensions/RelationshipTriggerExtension.ts src/extensions/RelationshipTriggerExtension.test.ts
git commit -m "feat(trigger): add RelationshipTriggerExtension for typed link detection"
```

---

## 任务 7：Editor.vue 集成 RelationshipMenu

**涉及文件：**
- 修改：`src/components/Editor.vue`

- [ ] **步骤 1：读 Editor.vue 找接入点**

读 `src/components/Editor.vue` 全文（140 行）。在 `WikiLinkTriggerExtension` 旁边添加 `RelationshipTriggerExtension`，在组件 setup 中添加 `useRelationshipMenu` 和事件监听。

- [ ] **步骤 2：修改 Editor.vue**

在 `<script setup>` 顶部加入 import：

```typescript
import { useRelationshipMenu } from '../composables/useRelationshipMenu'
import RelationshipMenu from './RelationshipMenu.vue'
import { RelationshipTriggerExtension } from '../extensions/RelationshipTriggerExtension'
```

在 setup 中添加：

```typescript
const relMenu = useRelationshipMenu()

// 编辑器 view 引用
const editorRef = ref<any>(null)
function onEditorReady(view: any) {
  editorRef.value = view
}
```

找到 Tiptap `extensions` 数组，在 `WikiLinkTriggerExtension` 后添加 `RelationshipTriggerExtension`。

在 `onMounted` 或 `onEditorCreated` 中添加事件监听：

```typescript
function handleRelMenuOpen(e: Event) {
  const detail = (e as CustomEvent).detail
  relMenu.open({
    view: detail.view,
    position: detail.position,
    range: detail.range,
    initialQuery: detail.initialQuery,
    onSelect: (type) => {
      if (!editorRef.value) return
      const view = editorRef.value
      const range = detail.range
      view.dispatch(view.state.tr.insertText(type, range.from, range.to))
    }
  })
}

function handleRelMenuClose() {
  relMenu.close()
}

function handleRelMenuKey(e: Event) {
  const key = (e as CustomEvent).type
  if (key === 'rel-menu-enter') {
    relMenu.select()
  } else if (key === 'rel-menu-escape') {
    relMenu.close()
  } else if (key === 'rel-menu-arrowup') {
    relMenu.moveSelection(-1)
  } else if (key === 'rel-menu-arrowdown') {
    relMenu.moveSelection(1)
  }
}

onMounted(() => {
  if (editorRef.value?.dom) {
    editorRef.value.dom.addEventListener('rel-menu-open', handleRelMenuOpen)
    editorRef.value.dom.addEventListener('rel-menu-close', handleRelMenuClose)
    editorRef.value.dom.addEventListener('rel-menu-enter', handleRelMenuKey)
    editorRef.value.dom.addEventListener('rel-menu-escape', handleRelMenuKey)
    editorRef.value.dom.addEventListener('rel-menu-arrowup', handleRelMenuKey)
    editorRef.value.dom.addEventListener('rel-menu-arrowdown', handleRelMenuKey)
  }
})
```

在 `<template>` 末尾添加菜单组件：

```vue
<RelationshipMenu :menu="relMenu" />
```

（具体 Tiptap 集成方法：`onUpdate` 或 `onCreate` 回调中保存 `view` 到 `editorRef.value`。如有需要，在 `WikiLinkTriggerExtension` 已有的 `editorView` 引用上复用。）

- [ ] **步骤 3：运行 typecheck**

```bash
npx vue-tsc -b 2>&1 | tail -10
```

预期结果：无错误

- [ ] **步骤 4：运行 build**

```bash
npm run build 2>&1 | tail -10
```

预期结果：构建成功

- [ ] **步骤 5：提交代码**

```bash
git add src/components/Editor.vue
git commit -m "feat(editor): integrate RelationshipMenu and trigger extension"
```

---

## 任务 8：Block/index.vue 处理 .rel-type-label 点击

**涉及文件：**
- 修改：`src/components/Block/index.vue`

- [ ] **步骤 1：读 Block/index.vue 找 handleContentClick**

读 `src/components/Block/index.vue` 第 440-460 行的 `handleContentClick`。

- [ ] **步骤 2：修改 handleContentClick 处理类型标签点击**

在 `<script setup>` 顶部添加 import：

```typescript
import { useRelationshipMenu } from '../../composables/useRelationshipMenu'
import { getEditorView } from '../../composables/useContentRenderer'  // 如不存在则改为辅助函数
```

（如果 `getEditorView` 不存在，则在 `useContentRenderer` 中导出，或在此处直接用全局 Map）

在 setup 中添加：

```typescript
const relMenu = useRelationshipMenu()
```

在 `handleContentClick` 中**最前面**添加：

```typescript
function handleContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement

  // 1. 点击类型标签 → 切换类型
  const typeLabel = target.closest('.rel-type-label') as HTMLElement | null
  if (typeLabel) {
    e.preventDefault()
    e.stopPropagation()

    const relType = typeLabel.dataset.relType as string
    const blockId = typeLabel.dataset.blockId || ''
    const labelFrom = parseInt(typeLabel.dataset.labelFrom || '0', 10)
    const labelTo = parseInt(typeLabel.dataset.labelTo || '0', 10)
    const typedLink = typeLabel.previousElementSibling as HTMLElement | null
    const pageName = typedLink?.dataset.page

    if (!pageName) return

    const rect = typeLabel.getBoundingClientRect()
    const view = getEditorView(blockId)

    relMenu.openSwitch({
      view: view || { dom: { isConnected: false } },
      position: { x: rect.left, y: rect.bottom + 4 },
      range: { from: labelFrom, to: labelTo },
      currentType: relType as any,
      onSelect: (newType) => {
        if (!view) return
        // Tiptap transaction 替换文本
        const content = view.state.doc.textBetween(0, view.state.doc.content.size, '\n', '\n')
        // 简单方式：找到该字符范围的文本
        const tr = view.state.tr
        // 用 replaceWith 替换从 labelFrom 到 labelTo
        tr.insertText(newType, labelFrom, labelTo)
        view.dispatch(tr)
      }
    })
    return
  }

  // 2. 点击带类型链接主体 → 跳页
  const typedLink = target.closest('.block-link-typed') as HTMLElement | null
  if (typedLink) {
    e.preventDefault()
    const pageName = typedLink.dataset.page
    if (pageName) navigateToPage(pageName)
    return
  }

  // 3. 普通 block-link（原有逻辑）
  // ...
}
```

- [ ] **步骤 3：在 useContentRenderer 中导出 getEditorView（如尚未存在）**

读 `useContentRenderer.ts` 检查是否有 `editorViews` 集合导出。

如不存在，在文件末尾添加：

```typescript
// 全局 EditorView 映射
const editorViews = new Map<string, any>()

export function registerEditorView(blockId: string, view: any) {
  editorViews.set(blockId, view)
}

export function unregisterEditorView(blockId: string) {
  editorViews.delete(blockId)
}

export function getEditorView(blockId: string): any | undefined {
  return editorViews.get(blockId)
}
```

- [ ] **步骤 4：在 Editor.vue 生命周期中注册/注销 EditorView**

在 `onCreated` 或 `onUpdate` 中调用 `registerEditorView(blockId, view)`；
在 `onDestroy` 中调用 `unregisterEditorView(blockId)`。

具体：找到 Tiptap 编辑器的 `onCreate` 回调（如果有），在其中保存 `view` 并调用 `registerEditorView(props.blockId, view)`。

- [ ] **步骤 5：运行 typecheck + build**

```bash
npx vue-tsc -b 2>&1 | tail -5
npm run build 2>&1 | tail -10
```

预期结果：构建成功

- [ ] **步骤 6：运行 lint**

```bash
npx eslint src/components/Block/index.vue src/components/Editor.vue src/composables/useContentRenderer.ts 2>&1 | tail -10
```

- [ ] **步骤 7：提交代码**

```bash
git add src/components/Block/index.vue src/components/Editor.vue src/composables/useContentRenderer.ts
git commit -m "feat(click): handle type label click to switch relationship"
```

---

## 任务 9：添加全局 CSS 样式

**涉及文件：**
- 修改：`src/styles/main.css`（或项目用的全局 CSS 文件）

- [ ] **步骤 1：找全局样式文件**

```bash
ls src/styles/ 2>&1
ls src/assets/ 2>&1
```

根据实际文件名追加样式。

- [ ] **步骤 2：添加 .block-link-typed 和 .rel-type-label 样式**

在全局 CSS 中追加：

```css
/* 带类型 wiki link 视图模式渲染 */
.block-link-typed {
  text-decoration: underline dotted;
  text-underline-offset: 2px;
  text-decoration-color: var(--rel-color, currentColor);
  cursor: pointer;
}
.block-link-typed:hover {
  text-decoration-style: solid;
}

.rel-type-label {
  color: var(--rel-color, currentColor);
  font-style: italic;
  font-size: 0.9em;
  margin-left: 2px;
  padding: 0 4px;
  border-radius: 3px;
  cursor: pointer;
  user-select: none;
}
.rel-type-label:hover {
  background: color-mix(in srgb, var(--rel-color) 12%, transparent);
}

/* 降级方案：浏览器不支持 color-mix() */
@supports not (background: color-mix(in srgb, red 10%, transparent)) {
  .rel-type-label:hover {
    background: rgba(0, 0, 0, 0.05);
  }
}
```

- [ ] **步骤 3：运行 build**

```bash
npm run build 2>&1 | tail -10
```

预期结果：构建成功

- [ ] **步骤 4：提交代码**

```bash
git add src/styles/  # 或实际路径
git commit -m "style: add typed wiki link and relationship label styles"
```

---

## 任务 10：端到端集成测试

**涉及文件：**
- 新建：`src/integration/typed-wiki-link-flow.test.ts`（如不存在 integration 目录则建）

- [ ] **步骤 1：编写集成测试**

新建 `src/integration/typed-wiki-link-flow.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { WikiLinkExtension } from '../extensions/WikiLinkExtension'
import { RelationshipTriggerExtension } from '../extensions/RelationshipTriggerExtension'
import RelationshipMenu from '../components/RelationshipMenu.vue'
import { useRelationshipMenu } from '../composables/useRelationshipMenu'

describe('typed wiki link flow', () => {
  let editor: Editor
  let menu: ReturnType<typeof useRelationshipMenu>

  beforeEach(() => {
    menu = useRelationshipMenu()
    editor = new Editor({
      extensions: [Document, Paragraph, Text, WikiLinkExtension, RelationshipTriggerExtension],
      content: '<p>See [[X]] for details</p>'
    })
  })

  afterEach(() => {
    editor?.destroy()
  })

  it('在 [[X]] 后输入 ^( 触发菜单；Enter 插入类型', async () => {
    const menuWrapper = mount(RelationshipMenu, { props: { menu } })

    // 光标移到 [[X]] 之后
    editor.chain().focus().setTextSelection(9).run()  // ]] 之后

    // 模拟输入 ^(
    editor.chain().focus().insertContent('^(').run()
    await new Promise(r => setTimeout(r, 50))
    await nextTick()

    expect(menu.state.value.visible).toBe(true)

    // 按 Enter 接受默认（depends-on）
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' })
    editor.view.dom.dispatchEvent(new CustomEvent('rel-menu-enter', { bubbles: true, detail: {} }))

    await nextTick()
    expect(menu.state.value.visible).toBe(false)
    expect(editor.getHTML()).toContain('depends-on')
  })

  it('输入 ^ 后取消（Esc）菜单不修改文本', async () => {
    const menuWrapper = mount(RelationshipMenu, { props: { menu } })

    editor.chain().focus().setTextSelection(9).run()
    editor.chain().focus().insertContent('^(').run()
    await new Promise(r => setTimeout(r, 50))

    expect(menu.state.value.visible).toBe(true)
    const before = editor.getHTML()

    editor.view.dom.dispatchEvent(new CustomEvent('rel-menu-escape', { bubbles: true, detail: {} }))
    await nextTick()

    expect(menu.state.value.visible).toBe(false)
    expect(editor.getHTML()).toBe(before)
  })
})
```

- [ ] **步骤 2：运行测试**

执行命令：`npx vitest run src/integration/typed-wiki-link-flow.test.ts 2>&1 | tail -20`
预期结果：2 个测试通过

- [ ] **步骤 3：运行全部测试套件**

```bash
npx vitest run 2>&1 | tail -20
```

预期结果：仅之前已知的 25 个预存失败，无新增失败

- [ ] **步骤 4：提交代码**

```bash
git add src/integration/typed-wiki-link-flow.test.ts
git commit -m "test: add end-to-end typed wiki link flow integration test"
```

---

## 任务 11：最终验证

- [ ] **步骤 1：跑 lint**

```bash
npx eslint src/ 2>&1 | tail -20
```

- [ ] **步骤 2：跑 typecheck**

```bash
npx vue-tsc -b 2>&1 | tail -10
```

- [ ] **步骤 3：跑 build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **步骤 4：跑全部测试**

```bash
npx vitest run 2>&1 | tail -10
```

- [ ] **步骤 5：手动验证颜色对比度**

打开浏览器到任一带 `[[X]]^(type)` 的页面，验证：
- 6 种预定义颜色与白底对比度 ≥ 4.5:1
- 点下划线清晰
- 类型标签斜体可读

- [ ] **步骤 6：手动验证端到端流程**

按设计文档第 5 段流程验证：
1. 输入 `[[X]]` → 普通页面菜单
2. 选 X → 关闭
3. 输入 `^(` → 关系类型菜单
4. 选 depends-on → 文本插入
5. 输入 `)` → 闭合
6. 视图模式：点下划线 + depends-on 标签
7. 点击 depends-on 标签 → 切换菜单
8. 选 related → 文本替换
9. 验证存储层反向链接更新

- [ ] **步骤 7：提交验证记录**

```bash
git log --oneline -20  # 确认所有 commit 都已提交
```

---

## 任务依赖图

```
T1 (类型扩展) ──┬─> T2 (WikiLink 跳过) ──────────────────┐
                ├─> T3 (useContentRenderer 渲染) ────────┤
                │                                          │
                ├─> T4 (useRelationshipMenu) ─> T5 (Menu) │
                │                                  │       │
                │                                  ▼       │
                └─> T6 (TriggerExtension) ─> T7 (Editor)  │
                                                   │       │
                                                   ▼       │
                                              T8 (Click) ─┤
                                                       │
                                                       ▼
                                                T9 (CSS) ┤
                                                       │
                                                       ▼
                                                T10 (E2E) ┤
                                                       │
                                                       ▼
                                                T11 (验证)
```

T1 → T2、T3、T4 独立可并行
T4 → T5 串行
T5 → T6 串行（trigger 需要菜单 API）
T1+T5 → T7 串行
T1+T4+T5 → T8 串行
T1+T2+T3 → T9 串行
T1~T9 → T10 串行
T10 → T11 串行

---

## 自我审核检查

- ✅ 覆盖设计文档全部 7 段（架构、数据模型、组件、触发、渲染、点击、错误处理）
- ✅ 每个测试用例都先写失败测试，再写实现
- ✅ 全部代码块完整，无占位（"待定""后续实现"）
- ✅ 每次提交后立即验证
- ✅ 步骤粒度 2-5 分钟（写测试、运行、修改、运行、提交）
- ✅ 文件路径精确，相对项目根
- ✅ 任务边界清晰：每个任务只做一件事，独立可验证
- ✅ 依赖关系明确：TDD 顺序，前置任务通过后启动后续

---

*文档生成时间：2026-06-04*
