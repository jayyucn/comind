# Block 编辑器架构规范

> 版本：v0.3
> 日期：2026-05-19
> 状态：✅ 已实现
>
> **📌 说明：** 本文档是 comind 的核心架构约束文档。开发实现参考请见 `dev-guide.md`。

---

## 核心架构约束（硬性规则，违反任一条视为系统性错误）

### C1：单编辑器原则（最重要）

> 任何时刻，系统只能存在 **1 个活跃的 tiptap 编辑器实例**，只有 **1 个 Block 处于编辑状态**。编辑器必须随 Block 切换而销毁或复用。

**含义：**
- 只有一个 tiptap 实例在 DOM 中挂载
- 只有一个 Block 处于 Edit 态（其余均为 Display 态）
- 切换 Block 时：保存当前 → 销毁 editor → 挂载新 editor

**状态转换：**

| 事件 | 当前状态 | 目标状态 | 行为 |
|------|----------|----------|------|
| 点击 Block | display | edit | 挂载 tiptap，加载内容 |
| blur / ESC | edit | display | 保存内容，销毁 tiptap |
| 切换 Block | edit（Block A） | edit（Block B） | 保存 A → 销毁 → 挂载 B |

---

### C2：Block 是唯一数据单元

> 系统所有能力必须围绕 Block 构建。禁止引入"文档级模型"。

- 所有编辑操作作用于单个 Block
- 页面（Page）是独立实体，通过 `Page.blockId` 关联根 Block
- Block 是内容载体，Page 是容器和组织单元

---

### C3：状态驱动，而非 DOM 驱动

> 所有行为必须通过状态机控制（`activeBlockId`、Block 树），禁止直接 DOM 操作控制业务逻辑。

**EditorState（Pinia）：**
```typescript
// useEditorStore（src/stores/editor.ts）
interface EditorState {
  activeBlockId: string | null        // 当前编辑的 Block ID
  pendingCursorPos: number | null     // 待恢复的光标位置（PM position）
  activeEditor: Editor | null         // tiptap 编辑器实例
  slashCommand: {                     // 斜杠命令面板状态
    visible: boolean
    query: string
    selectedIndex: number
    position: { x: number; y: number }
    range: { from: number; to: number }
  } | null
  propertyEditor: {                   // 属性编辑器状态
    visible: boolean
    blockId: string | null
    initialKey: string | null
  } | null
  quickPropertyEditor: {              // 快捷属性编辑器状态
    visible: boolean
    blockId: string
    key: string
    position: { x: number; y: number } | null
  } | null
}
```

---

### C4：Phase 1 不引入虚拟列表

> 100 个 Block ≈ 100 个 DOM 节点，浏览器性能完全可承受。虚拟列表在 Phase 2/3 按需引入。

Phase 1 性能保障：Block 组件 memo 化 + 非编辑态静态 HTML + 输入防抖。

---

## 编辑行为规范

### Enter（拆分/插入 Block）

**代码实现：** `useBlockStore.insertBlockAtCursor()`

根据光标位置决定行为：

| 光标位置 | 行为 | 说明 |
|----------|------|------|
| 行首（offset=0） | 在当前 Block 上方插入兄弟 | `insertSiblingAbove()` |
| 行尾 + 有展开子节点 | 作为第一个子节点插入 | `insertAtPosition(asFirstChild=true)` |
| 行尾 + 无子节点 | 在下方插入兄弟 | `insertAtPosition(asFirstChild=false)` |
| 文本中间 | 拆分当前 Block，后半创建新节点 | 内容截断 + `insertAtPosition()` |
| 空行 | 等同行尾，插入子节点或兄弟 | `contentLen === 0` |

**Gap 排序 + 自动重编号：**
```typescript
// 安全计算插入位置，间隔耗尽时自动重编号
async function safeCalcInsertPos(
  prevPos: number | null,
  nextPos: number | null,
  blocksRef: Block[],
  storageRef: typeof storage,
  recalcPos?: () => { prevPos: number | null; nextPos: number | null }
): Promise<number>
```

### Backspace（合并 Block）

**代码实现：** `useBlockStore.mergeWithPrevious()`

- 光标在 Block 开头时，与视觉前一个 Block 合并
- 考虑折叠状态：前一个 Block 折叠时，合并到该 Block 自身
- 被合并节点的子节点转移到目标节点
- 返回合并后的光标位置：`{ id: mergeTarget.id, cursorPos: targetContentLen + 1 }`

### Tab（缩进）

**代码实现：** `useBlockStore.indent()`

- 当前 Block 成为前一个兄弟的子节点
- 更新 `parentId` 和 `pos`
- 使用 `safeCalcInsertPos` 计算新位置

### Shift+Tab（反缩进）

**代码实现：** `useBlockStore.outdent()`

- 当前 Block 提升到父 Block 的同级
- 更新 `parentId` 和 `pos`

---

## 渲染规则

**单编辑器渲染策略：**
```
block.id === activeBlockId → 渲染 tiptap Editor（Edit 态）
否则 → 渲染静态 HTML（Display 态，非响应式）
```

**tiptap 生命周期：**
- `onMounted` → 创建 tiptap 实例
- `onUnmounted` → 销毁实例

**编辑器状态（Display vs Edit）：**
- Display：纯 HTML，无编辑器实例，轻量渲染
- Edit：tiptap 实例挂载，左侧 2px accent 边框，背景提亮

---

## 数据流

```
输入流：用户输入 → tiptap → Pinia（运行态）→ debounce 300ms → IndexedDB（持久化）
输出流：IndexedDB → Pinia → 按需渲染 → Block 组件展示
```

**防抖保存：**
- 每个 Block 独立防抖（`pendingSaves` Map）
- 防抖间隔：`SAVE_DEBOUNCE_MS`（300ms）
- 删除 Block 时取消防抖

**结构版本号：**
- `structureVersion` ref：每次 Block 增删移时递增
- 用于触发 Sortable 实例重建

---

## Block 树遍历

**已实现的遍历方法：**

| 方法 | 说明 |
|------|------|
| `findPreviousBlockInTreeOrder` | 树前序遍历前驱 |
| `findNextBlockInTreeOrder` | 树前序遍历后继 |
| `findPreviousVisibleBlock` | 视觉前一个 Block（考虑折叠） |
| `findLastVisibleDescendant` | 最后一个可见后代（考虑折叠） |

---

## 已实现功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 单编辑器切换 | ✅ | C1 约束已实现 |
| Block CRUD | ✅ | 创建、读取、更新、删除 |
| Enter 拆分/插入 | ✅ | 根据光标位置分流 |
| Backspace 合并 | ✅ | 考虑折叠状态 |
| Tab/Shift+Tab 缩进 | ✅ | Gap 排序 + 自动重编号 |
| 拖拽排序 | ✅ | Sortable.js + `moveBlock()` |
| 防抖保存 | ✅ | 每个 Block 独立 300ms 防抖 |
| 斜杠命令 | ✅ | Slash Command 面板 |
| 属性编辑器 | ✅ | Property Editor + Quick Editor |
| Gap 排序自动恢复 | ✅ | `safeCalcInsertPos` + `renumberBlocks` |

---

## 成功标准

系统必须满足：

- 1000+ Block 流畅滚动（Phase 1 按需渲染保障）
- 编辑器切换 < 50ms
- 输入响应 < 16ms
- 单 editor 稳定运行，无重复实例

---

## 禁止事项

- ❌ 多 editor 并存
- ❌ 文档级编辑模型
- ❌ UI 状态反向污染数据结构
- ❌ Phase 1 引入虚拟列表（性能未达瓶颈前）
- ❌ 复杂 Markdown 实时解析（Phase 1 聚焦大纲体验）

---

## 相关文档

- **开发实现参考** → `dev-guide.md`
- **数据模型定义** → `data-model.md`
- **UI/UX 规范** → `ui-ux-spec.md`
- **Property 规范** → `property-spec.md`
- **存储格式规范** → `storage-spec.md`

---

*文档基于代码实现更新（2026-05-19），替代 v0.2（2026-04-16）。*
