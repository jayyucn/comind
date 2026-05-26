# WikiLink 菜单触发逻辑重构实施方案

> **面向智能体执行者：必须使用子技能**：通过 subagent‑driven‑development（推荐）或 executing‑plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。

**目标**：优化 WikiLink 菜单的打开/关闭逻辑，使用 handleTextInput 替代 view.update，提升性能
**架构**：提取 findWikiLinkAtCursor 共享函数，handleTextInput 负责打开菜单，handleKeyDown 和 handleClick 负责关闭菜单，移除高频 view.update 检测
**技术栈**：TypeScript, ProseMirror, @tiptap/core

---

### 任务 1：提取 findWikiLinkAtCursor 共享函数

**涉及文件：**
- 修改：`d:\comind\comind\src\extensions\WikiLinkTriggerExtension.ts`

**步骤：**

- [ ] **步骤 1：在文件顶部添加 findWikiLinkAtCursor 函数**

在类型定义之后（约第 15 行后）添加：

```typescript
export interface WikiLinkAtCursorResult {
  found: boolean
  range: { from: number; to: number } | null
  query: string
}

/**
 * 在文档中查找光标位置处的 Wiki 链接
 * 支持：[[page]]、[[page|display]]、[[page（未闭合）
 */
export function findWikiLinkAtCursor(
  doc: any,
  pos: number
): WikiLinkAtCursorResult {
  // 匹配完整链接和未闭合链接
  const linkRegex = /\[\[([^\]|]*)(?:\|[^\]]*)?\]?\]?/g
  let foundMatch = false

  doc.descendants((node: any, nodePos: number) => {
    if (!node.isText || foundMatch) return

    const text = node.text || ''
    let match
    while ((match = linkRegex.exec(text)) !== null) {
      const start = nodePos + match.index
      const end = nodePos + match.index + match[0].length

      if (pos > start && pos <= end) {
        const query = match[1] || ''
        return {
          found: true,
          range: { from: start, to: end },
          query
        }
      }
    }
  })

  linkRegex.lastIndex = 0
  return { found: false, range: null, query: '' }
}
```

- [ ] **步骤 2：添加 triggerWikiLinkMenu 辅助函数**

```typescript
/**
 * 统一触发 WikiLink 菜单显示
 */
function triggerWikiLinkMenu(
  view: any,
  position: number,
  range: { from: number; to: number },
  query: string
) {
  menuIsOpen = true
  
  const triggerEvent = new CustomEvent<WikiLinkTriggerEvent>('wiki-link-trigger', {
    bubbles: true,
    detail: { view, position, range, query }
  })
  view.dom.dispatchEvent(triggerEvent)
}
```

- [ ] **步骤 3：编译检查**

执行命令：
```bash
npm run build
```
预期结果：编译通过，无类型错误

---

### 任务 2：添加 handleTextInput 打开菜单

**涉及文件：**
- 修改：`d:\comind\comind\src\extensions\WikiLinkTriggerExtension.ts`

**步骤：**

- [ ] **步骤 1：在 Plugin props 中添加 handleTextInput**

在 `handleKeyDown` 之后（约第 92 行后）添加：

```typescript
props: {
  handleKeyDown: (view, event) => {
    // ... 现有代码保持不变
  },
  handleTextInput(view, pos, text) {
    // selectingFromMenu 防止菜单选择时触发循环事件
    if (selectingFromMenu) return false
    
    const { state } = view
    
    // 检查光标是否在 Wiki 链接范围内
    const result = findWikiLinkAtCursor(state.doc, state.selection.from)
    
    if (result.found && result.range) {
      // 如果菜单未打开，则打开
      if (!menuIsOpen) {
        triggerWikiLinkMenu(view, pos, result.range, result.query)
      } else {
        // 菜单已打开，只更新查询
        const updateEvent = new CustomEvent<WikiLinkUpdateEvent>('wiki-link-update', {
          bubbles: true,
          detail: { query: result.query }
        })
        view.dom.dispatchEvent(updateEvent)
      }
    }
    
    return false
  },
  // ...
}
```

- [ ] **步骤 2：编译检查**

```bash
npm run build
```

---

### 任务 3：修改 handleKeyDown 支持方向键关闭菜单

**涉及文件：**
- 修改：`d:\comind\comind\src\extensions\WikiLinkTriggerExtension.ts`

**步骤：**

- [ ] **步骤 1：修改 handleKeyDown 添加关闭逻辑**

在 `handleKeyDown` 函数中，添加方向键关闭菜单的处理：

```typescript
handleKeyDown: (view, event) => {
  if (event.key === '[') {
    // ... 现有 [[ 触发逻辑保持不变
  }
  
  // 菜单打开时，方向键关闭菜单
  if (menuIsOpen) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      menuIsOpen = false
      menuOpenRange = null
      const closeEvent = new CustomEvent<WikiLinkCloseEvent>('wiki-link-close', {
        bubbles: true,
        detail: { reason: 'cursor-move' }
      })
      view.dom.dispatchEvent(closeEvent)
      return true
    }
  }
  
  // ... 现有的 Enter/Escape/ArrowUp/ArrowDown 逻辑保持不变
}
```

- [ ] **步骤 2：在顶部添加 menuOpenRange 变量**

在 `menuIsOpen` 之后添加：

```typescript
let menuIsOpen = false
let menuOpenRange: { from: number; to: number } | null = null
let selectingFromMenu = false
```

- [ ] **步骤 3：编译检查**

```bash
npm run build
```

---

### 任务 4：添加 handleClick 点击外部关闭菜单

**涉及文件：**
- 修改：`d:\comind\comind\src\extensions\WikiLinkTriggerExtension.ts`

**步骤：**

- [ ] **步骤 1：在 Plugin props 中添加 handleClick**

在 `handleTextInput` 之后添加：

```typescript
handleClick(view, pos, event) {
  // 检查点击是否在编辑器内部
  const editorContainer = view.dom.closest('[contenteditable="true"]')
  const isInEditor = editorContainer !== null
  
  // 如果在编辑器外部且菜单打开，则关闭
  if (!isInEditor && menuIsOpen) {
    menuIsOpen = false
    menuOpenRange = null
    const closeEvent = new CustomEvent<WikiLinkCloseEvent>('wiki-link-close', {
      bubbles: true,
      detail: { reason: 'cursor-move' }
    })
    view.dom.dispatchEvent(closeEvent)
  }
  return false
}
```

- [ ] **步骤 2：编译检查**

```bash
npm run build
```

---

### 任务 5：完全移除 view 方法

**涉及文件：**
- 修改：`d:\comind\comind\src\extensions\WikiLinkTriggerExtension.ts`

**步骤：**

- [ ] **步骤 1：移除整个 view 方法**

将 `addProseMirrorPlugins()` 中的 `view(view)` 方法完全移除：

```typescript
addProseMirrorPlugins() {
  return [
    new Plugin({
      key: new PluginKey('wikiLinkTrigger'),
      props: {
        handleKeyDown: (view, event) => {
          // ... 处理 [[ 触发和方向键关闭
        },
        handleTextInput: (view, pos, text) => {
          // ... 处理链接内输入打开菜单
        },
        handleClick: (view, pos, event) => {
          // ... 处理点击外部关闭菜单
        }
      },
      state: {
        init() {
          return DecorationSet.empty
        },
        apply(tr, prev) {
          return prev.map(tr.mapping, tr.doc)
        }
      }
      // view 方法已完全移除
    })
  ]
}
```

- [ ] **步骤 2：编译检查**

```bash
npm run build
```

---

### 任务 6：测试验证

**涉及文件：**
- 新建：`d:\comind\comind\src\extensions\WikiLinkTriggerExtension.test.ts`

**步骤：**

- [ ] **步骤 1：创建测试文件**

```typescript
import { describe, it, expect } from 'vitest'
import { findWikiLinkAtCursor } from './WikiLinkTriggerExtension'

describe('WikiLinkTriggerExtension', () => {
  describe('findWikiLinkAtCursor', () => {
    it('finds cursor in complete wiki link [[page]]', () => {
      // 测试光标在完整链接内
    })

    it('finds cursor in wiki link with display [[page|display]]', () => {
      // 测试光标在带显示文本的链接内
    })

    it('finds cursor in incomplete link [[page', () => {
      // 测试光标在未闭合链接内
    })

    it('returns not found when cursor outside links', () => {
      // 测试光标在普通文本中
    })

    it('returns empty query for empty link [[]]', () => {
      // 测试空链接
    })
  })
})
```

- [ ] **步骤 2：运行测试**

执行命令：
```bash
npm run test
```
预期结果：所有测试通过

- [ ] **步骤 3：运行完整构建**

```bash
npm run build
```
预期结果：构建成功

- [ ] **步骤 4：提交代码**

```bash
git add .
git commit -m "refactor: optimize wiki link menu trigger logic with handleTextInput"
```

---

## 验收标准

1. ✅ TypeScript 类型检查通过（`vue-tsc -b`）
2. ✅ Vite 构建成功（`vite build`）
3. ✅ 单元测试通过（`npm run test`）
4. ✅ 光标在链接内输入时能唤起菜单
5. ✅ 按左右方向键时能关闭菜单
6. ✅ 点击编辑器外部时能关闭菜单
7. ✅ 无性能退化（不再有高频 view.update 检测）
