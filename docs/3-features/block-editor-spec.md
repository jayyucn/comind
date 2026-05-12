# Block 编辑器架构规范

> 版本：v0.2
> 日期：2026-04-16
> 状态：✅ 已确认
>
> **📌 说明：** 本文档是 comind 的核心架构约束文档。开发实现参考请见 `dev-guide.md`（已整合本文档全部内容，并补充代码示例）。

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
- 页面（Page）= `isPage = true` 的顶级 Block
- 系统只有 Block，没有"页面文档"、"笔记文档"等独立概念

---

### C3：状态驱动，而非 DOM 驱动

> 所有行为必须通过状态机控制（`activeBlockId`、Block 树），禁止直接 DOM 操作控制业务逻辑。

**EditorState（Pinia）：**
```typescript
interface EditorState {
  activeBlockId: string | null  // 光标位置由 tiptap 内部 state.selection 管理
}
```

---

### C4：Phase 1 不引入虚拟列表

> 100 个 Block ≈ 100 个 DOM 节点，浏览器性能完全可承受。虚拟列表在 Phase 2/3 按需引入。

Phase 1 性能保障：Block 组件 memo 化 + 非编辑态静态 HTML + 输入防抖。

---

## 编辑行为规范

### Enter（拆分 Block）

- 按光标位置将当前 Block 内容截断
- 后半部分生成新 Block，作为兄弟节点
- 光标移动到新 Block

### Backspace（合并 Block）

- 光标在 Block 开头时，与上一个 Block 合并
- 删除当前 Block，光标移动到上一个 Block 末尾

### Tab（缩进）

- 当前 Block 成为前一个 Block 的子节点
- 更新 `parentId` 和 `left`

### Shift+Tab（反缩进）

- 当前 Block 提升层级，成为前一个 Block 的兄弟
- 移出当前父节点

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

- **开发实现参考** → `dev-guide.md`（已整合本文档全部约束）
- **数据模型定义** → `data-model.md`
- **UI/UX 规范** → `ui-ux-spec.md`
