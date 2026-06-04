# Phase 3 编辑器交互增强 — 设计文档

> 版本：v1.0
> 日期：2026-06-04
> 状态：待用户审阅
> 关联计划：`docs/superpowers/plans/2026-06-02-concept-graph-development-plan.md`（Phase 3）

---

## 1. 目标与范围

为概念图谱功能（Phase 1 数据层 + Phase 2 可视化已完成部分）提供编辑器端的**完整交互链路**：

1. 用户在编辑器中输入 `[[X]]^(type)` 语法时，获得**菜单辅助**与**键盘流**
2. 在页面视图模式中，带类型链接以**点下划线 + 类型标签**形式渲染
3. 点击类型标签可**切换关系类型**，无需手动重写语法
4. **不修改数据模型**：仅在前端编辑器、视图层、菜单层做新增和修改

**MVP 边界**

- 6 种预定义关系类型（depends-on/related/references/part-of/contradicts/supports）
- 不支持自定义关系类型（后续 phase）
- 不修改存储层
- 编辑器内不渲染带类型链接的特殊样式（避免干扰输入）

---

## 2. 架构总览

```
┌──────────────────────────────────────────────────────────┐
│                     Tiptap Editor                         │
│  ┌────────────────────┐  ┌────────────────────────────┐  │
│  │ WikiLinkExtension  │  │ RelationshipTriggerExt    │  │
│  │ (渲染 [[X]] 装饰    │  │ (检测 ^( + 键盘事件)       │  │
│  │  跳过 [[X]]^(type)) │  │                            │  │
│  └────────────────────┘  └────────────────────────────┘  │
│              │                       │ events              │
│              ▼                       ▼                     │
│  ┌────────────────────┐  ┌────────────────────────────┐  │
│  │ Block/index.vue    │  │ useRelationshipMenu       │  │
│  │ (click handler)    │  │ (菜单状态)                  │  │
│  └────────────────────┘  └────────────────────────────┘  │
│                                       │                    │
│                                       ▼                    │
│                          ┌────────────────────────────┐  │
│                          │ RelationshipMenu.vue       │  │
│                          │ (UI)                        │  │
│                          └────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │ types/relationship.ts │
                  │ (6 种预定义 + 颜色)     │
                  └────────────────────────┘
```

**核心约束**

- 触发与渲染解耦：trigger 扩展只发事件，不操作菜单 DOM
- 菜单状态在 composable 里，跨组件共享（与 `PageLinkMenu` 模式一致）
- `WikiLinkExtension` 不依赖菜单，菜单不依赖扩展（只通过事件通信）

---

## 3. 数据模型

### 3.1 `types/relationship.ts`（扩展已有）

```typescript
export const PREDEFINED_RELATIONSHIPS = [
  { type: 'depends-on',    inverse: 'required-by',     color: '#DC2626' },
  { type: 'related',       inverse: 'related',         color: '#7C3AED' },
  { type: 'references',    inverse: 'referenced-by',   color: '#2563EB' },
  { type: 'part-of',       inverse: 'has-part',        color: '#059669' },
  { type: 'contradicts',   inverse: 'contradicted-by', color: '#EA580C' },
  { type: 'supports',      inverse: 'supported-by',    color: '#0891B2' },
] as const

export type RelationshipType = typeof PREDEFINED_RELATIONSHIPS[number]['type']

export function getPredefinedRelationship(type: string) {
  return PREDEFINED_RELATIONSHIPS.find(r => r.type === type)
}
```

**`color` 是新增字段**。已有的 `inverse` 字段保留。

### 3.2 `composables/useRelationshipMenu.ts`（新增）

```typescript
export interface RelationshipMenuOpenOpts {
  view: any                       // Tiptap EditorView
  position: { x: number; y: number }
  range: { from: number; to: number }
  initialQuery?: string
  currentType?: RelationshipType  // 切换模式时：当前类型用于预选
  onSelect: (type: RelationshipType) => void
}

export interface RelationshipMenuState {
  visible: boolean
  position: { x: number; y: number } | null
  range: { from: number; to: number } | null
  query: string
  selectedIndex: number
  currentType: RelationshipType | null  // null = 新建模式
  onSelect: ((type: RelationshipType) => void) | null
}
```

### 3.3 持久化

**不存新表**。关系类型是链接记录的字段（`links.relationshipType` 已存在）。本次不修改数据模型。

---

## 4. 组件清单

| 文件 | 类型 | 职责 |
|------|------|------|
| `types/relationship.ts` | 已存在，扩展 | 6 种预定义关系常量、颜色、inverse |
| `extensions/RelationshipTriggerExtension.ts` | 新建 | Tiptap 扩展：检测 `^(`、发事件、转发键盘 |
| `composables/useRelationshipMenu.ts` | 新建 | 菜单状态管理 |
| `components/RelationshipMenu.vue` | 新建 | 菜单 UI |
| `extensions/WikiLinkExtension.ts` | 修改 | 跳过 `[[X]]^(type)` 的装饰 |
| `composables/useContentRenderer.ts` | 修改 | 视图模式渲染带类型链接（点下划线 + 标签） |
| `components/Editor.vue` | 修改 | 接入 useRelationshipMenu，挂载 RelationshipMenu |
| `components/Block/index.vue` | 修改 | 点击类型标签 → 触发切换菜单 |

---

## 5. 触发流程

### 5.1 新建带类型链接

```
用户输入:  [[X]]^(
                       ↓
RelationshipTriggerExtension.handleTextInput 检测:
  - 上文是 ]] (WikiLink 闭合)
  - 当前输入字符是 (
                       ↓
1. 派发 'rel-menu-open' CustomEvent
   detail: { view, position: view.coordsAtPos(cursor),
             range: {from: cursor, to: cursor}, initialQuery: '' }
                       ↓
2. Editor.vue 收到事件
   → useRelationshipMenu.open(...)
   → menuRef.visible = true
   → selectedIndex = 0 (depends-on)
                       ↓
3. 用户按 Enter
   → emit('select', 'depends-on')
   → Editor.vue 替换 range 内容为 'depends-on'
   → close menu
                       ↓
4. 用户输入 'rel' 过滤
   → query = 'rel'
   → 过滤后只剩 [related]
   → selectedIndex = 0
                       ↓
5. 用户按 Esc
   → 菜单关闭
   → range 文本保持为用户已输入（可能为空）
```

### 5.2 切换现有链接类型

```
用户点击 <span class="rel-type-label" data-rel-type="depends-on">depends-on</span>
                       ↓
Block/index.vue.handleContentClick:
  - target.closest('.rel-type-label') 命中
  - relType = 'depends-on'
  - 从 data 属性获取字符范围
                       ↓
useRelationshipMenu.openSwitch({
  view, position, range,
  currentType: 'depends-on',
  onSelect: (newType) => replaceText(range, newType)
})
                       ↓
RelationshipMenu 打开
  - currentType 预选
  - 用户鼠标/键盘选新类型
                       ↓
emit('select', 'related')
                       ↓
onSelect 触发
  - Tiptap transaction 替换 range 内文本
  - 触发 onChange → debouncedSave → saveBlock
  - 存储层 createInverseLink 更新反向链接
```

### 5.3 关闭菜单的触发

| 触发 | 行为 |
|------|------|
| Esc | 关闭，range 文本保留为用户已输入 |
| Enter | 选中当前项并替换 |
| 鼠标点击菜单外部 | 关闭（同 Esc） |
| 选中并 click item | 同 Enter |
| 文档结构变化（删除 `^` 或 `(`）| 关闭 |
| 光标移出 `^(` 范围 | 关闭 |

---

## 6. 渲染细节

### 6.1 编辑模式（Tiptap）

**`WikiLinkExtension` 修改**：装饰循环时跳过 `[[X]]^(type)` 范围。

```typescript
const linkOnlyRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
const typedLinkRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]\^?\(([^)]+)\)/g

// 先收集 typed link 范围
const typedRanges: Array<[number, number]> = []
// ... 用 typedLinkRegex 扫描

// 再做普通 wiki link 装饰，跳过 typed range
```

**结果**

| 内容 | 编辑模式 |
|------|---------|
| `[[X]]` | 蓝色实线（原有行为，保持） |
| `[[X]]^(type)` | 纯文本，不装饰 |

### 6.2 视图模式（useContentRenderer）

**`useContentRenderer.ts` 修改**：在普通 wiki link 之前先匹配带类型链接。

```typescript
html = html.replace(
  /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]\^?\(([^)]+)\)/g,
  (_, target, alias, relType) => {
    const display = alias || target
    const rel = getPredefinedRelationship(relType)
    const color = rel?.color ?? '#9CA3AF'  // 未知类型灰色
    return `<span class="block-link-typed"
              data-page="${esc(target)}"
              data-rel-type="${esc(relType)}"
              data-block-id="${blockId}"
              data-typed-from="${charStart}"
              data-typed-to="${charEnd}">${display}</span>` +
           `<span class="rel-type-label"
              data-rel-type="${esc(relType)}"
              data-block-id="${blockId}"
              data-label-from="${labelStart}"
              data-label-to="${labelEnd}">${esc(relType)}</span>`
  }
)
```

**`useContentRenderer` 新增参数**：`blockId: string`，由 `BulletRender.vue` 传入。

**辅助函数**

- `getEditorView(blockId)`: 从全局 EditorView 映射（已在 `useContentRenderer` 维护的 `editorViews` 集合中）按 blockId 查找
- `computeMenuPosition(typeLabel)`: 取 `typeLabel.getBoundingClientRect()` 的 `bottom + 4px` 作为 `y`，`left` 作为 `x`；如失败则 fallback 到视口中心

### 6.3 CSS

```scss
.block-link-typed {
  text-decoration: underline dotted;
  text-underline-offset: 2px;
  text-decoration-color: var(--rel-color, currentColor);
  cursor: pointer;
}
.block-link-typed:hover { text-decoration-style: solid; }

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
```

### 6.4 渲染结果对照

| 内容 | 编辑模式 | 视图模式 |
|------|---------|---------|
| `[[X]]` | 蓝色实线 | 蓝色实线（原有） |
| `[[X]]^(depends-on)` | 纯文本 | `[[X]]` 点下划线 + 红色斜体 `depends-on` |
| `[[X\|alias]]^(depends-on)` | 纯文本 | `alias` 点下划线 + 红色斜体 `depends-on` |
| `[[X]]^(unknown)` | 纯文本 | 灰色 `unknown` 标签 |

---

## 7. 点击行为

**`Block/index.vue.handleContentClick` 扩展**

```typescript
function handleContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement

  // 1. 点击类型标签
  const typeLabel = target.closest('.rel-type-label') as HTMLElement | null
  if (typeLabel) {
    e.preventDefault()
    e.stopPropagation()
    
    const relType = typeLabel.dataset.relType
    const range = {
      from: parseInt(typeLabel.dataset.labelFrom!),
      to: parseInt(typeLabel.dataset.labelTo!)
    }
    const blockId = typeLabel.dataset.blockId!
    
    relationshipMenu.openSwitch({
      view: getEditorView(blockId),
      position: computeMenuPosition(typeLabel),
      range,
      currentType: relType,
      onSelect: (newType) => {
        // Tiptap transaction 替换文本
        const view = getEditorView(blockId)
        if (!view) return
        view.dispatch(view.state.tr.insertText(newType, range.from, range.to))
      }
    })
    return
  }

  // 2. 点击带类型链接主体
  const typedLink = target.closest('.block-link-typed') as HTMLElement | null
  if (typedLink) {
    e.preventDefault()
    const pageName = typedLink.dataset.page
    if (pageName) navigateToPage(pageName)
    return
  }

  // 3. 普通 block-link（原有逻辑）
  const link = target.closest('.block-link') as HTMLElement | null
  if (link) { /* 原有处理 */ }
}
```

**点击冒泡路径**

`BulletRender.vue` 的 `<div class="block-text" @click="handleClick">` → `Block/index.vue` 的 `handleContentClick`。

---

## 8. 错误处理

| 情况 | 处理 |
|------|------|
| `^(` 触发时光标不在 `]]` 后 | 不触发（no-op） |
| 编辑器已销毁但菜单仍开 | `open` 检查 view 是否连接；未连接 abort |
| 菜单查询无匹配 | 显示 "No matches" 占位（与 `PageLinkMenu` 一致） |
| 重复触发（连按 `^(`）| 状态机 `menuIsOpen` 单例约束 |
| 文档变化导致范围失效 | watch 文档变化，失效时 close |
| 切换类型时类型未变 | no-op，不触发 save |
| 未知关系类型 | 视图降级为灰色标签；存储层 `getPredefinedRelationship` 返回 undefined（已有） |
| 切换后存储更新 | 复用 `createRootBlockWithLink` 已有的同源 type 替换逻辑 |

**防御式编程**

```typescript
// useRelationshipMenu
function open(opts) {
  if (!opts.view?.dom?.isConnected) return
  if (menuState.visible) close()
  menuState = { visible: true, ... }
}
```

---

## 9. 测试策略

### 9.1 单元测试

| 文件 | 覆盖 | 用例数 |
|------|------|--------|
| `types/relationship.test.ts` | 6 种预定义字段一致性 | 3 |
| `composables/useRelationshipMenu.test.ts` | 状态机：open/close、update query、单例 | 5 |
| `components/RelationshipMenu.test.ts` | 渲染、过滤、键盘、预选 | 8 |
| `extensions/RelationshipTriggerExtension.test.ts` | `^(` 检测、键盘转发、生命周期 | 6 |
| `utils/useContentRenderer.test.ts` | `[[X]]^(type)` → 正确 HTML、降级、字符偏移 | 5 |

### 9.2 集成测试

| 场景 | 验证 |
|------|------|
| 端到端写 `[[X]]^(depends-on)` | 菜单 → 选 → Enter → 文本插入 |
| 端到端切换类型 | 点击标签 → 菜单 → 选新类型 → 文本替换 |
| 编辑状态不带装饰 | Tiptap 中 `[[X]]^(type)` 不应有 `.block-link-typed` 渲染 |
| 视图状态带装饰 | Block view 中渲染出 `.block-link-typed` 和 `.rel-type-label` |
| 切换后存储更新 | `links.relationshipType` 改变；目标页反向链接更新 |

### 9.3 回归保护

- 现有 `WikiLinkExtension.test.ts` 全部通过（普通 `[[X]]` 装饰不变）
- 现有 `useRelationshipSync.test.ts` 不受影响
- 现有 `auto-inverse-*-bug.test.ts` 不受影响

### 9.4 E2E（P2，可选）

浏览器实际输入流截图、点击切换流程截图。不在 Phase 3 必做范围。

---

## 10. 文件修改清单

### 新增

```
src/extensions/RelationshipTriggerExtension.ts
src/extensions/RelationshipTriggerExtension.test.ts
src/composables/useRelationshipMenu.ts
src/composables/useRelationshipMenu.test.ts
src/components/RelationshipMenu.vue
src/components/RelationshipMenu.test.ts
src/types/relationship.test.ts
```

### 修改

```
src/extensions/WikiLinkExtension.ts       # 跳过 typed link 装饰
src/composables/useContentRenderer.ts    # 渲染带类型链接
src/components/Editor.vue                # 接入关系菜单
src/components/Block/index.vue           # 点击类型标签处理
src/components/Block/handlers/bullet/BulletRender.vue  # 传 blockId 给 renderer
src/types/relationship.ts                # 扩展 PREDEFINED_RELATIONSHIPS（含 color）
```

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 字符偏移与 doc position 不一致 | 测试覆盖；渲染时由 parser 一次扫描输出所有偏移 |
| ProseMirror transaction 触发 onUpdate 雪崩 | 复用现有 debounce 300ms |
| 视图模式点击位置与 doc 范围映射错误 | 渲染时把字符偏移写入 `data-*` 属性，避免读 DOM 推算 |
| `color-mix()` 浏览器兼容性 | 旧浏览器降级为 `background: rgba(0,0,0,0.05)` |
| 6 种颜色可读性 | 设计验证：所有颜色与白底对比度 ≥ 4.5:1 |

---

*文档生成时间：2026-06-04*
