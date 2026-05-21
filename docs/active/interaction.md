# comind 交互设计规范

> 版本：v1.0
> 日期：2026-05-21
> 状态：活跃
> 来源：合并自 interaction-spec.md + ui-ux-spec.md

---

## 1. 视觉系统

### 1.1 色彩系统

| 角色 | 色值 | 用途 |
|------|------|------|
| `primary` | `#4F46E5` | 主按钮、链接、强调 |
| `primary-hover` | `#4338CA` | 主按钮悬停 |
| `accent` | `#6366F1` | 焦点框、指示线、激活状态 |
| `text-primary` | `#1F2937` | 主要文字 |
| `text-secondary` | `#6B7280` | 次要文字、提示 |
| `text-muted` | `#9CA3AF` | 弱提示、占位符 |
| `bg-primary` | `#FFFFFF` | 主背景 |
| `bg-secondary` | `#F9FAFB` | 侧边栏背景 |
| `bg-tertiary` | `#F3F4F6` | 卡片背景 |
| `border` | `#E5E7EB` | 分割线、边框 |
| `success` | `#10B981` | 成功状态 |
| `warning` | `#F59E0B` | 警告状态 |
| `error` | `#EF4444` | 错误状态 |

### 1.2 排版

| 层级 | 字号 | 行高 | 字重 | 用途 |
|------|------|------|------|------|
| H1 | 28px | 36px | 700 | 页面标题 |
| H2 | 22px | 28px | 600 | 章节标题 |
| H3 | 18px | 24px | 600 | 子章节标题 |
| Body | 15px | 24px | 400 | 正文内容 |
| Small | 13px | 20px | 400 | 辅助文字 |
| Caption | 11px | 16px | 400 | 标签、提示 |

### 1.3 间距

| Token | 值 | 用途 |
|-------|-----|------|
| `space-xs` | 4px | 行内元素间距 |
| `space-sm` | 8px | 紧密相关元素 |
| `space-md` | 16px | 常规元素间距 |
| `space-lg` | 24px | 区块间距 |
| `space-xl` | 32px | 大区块间距 |
| `space-2xl` | 48px | 页面级间距 |

### 1.4 圆角

| Token | 值 | 用途 |
|-------|-----|------|
| `radius-sm` | 4px | 按钮、输入框 |
| `radius-md` | 8px | 卡片、弹出框 |
| `radius-lg` | 12px | 模态框 |
| `radius-full` | 9999px | 头像、标签 |

### 1.5 阴影

| Token | 值 | 用途 |
|-------|-----|------|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | 卡片、按钮 |
| `shadow-md` | `0 4px 6px rgba(0,0,0,0.07)` | 弹出框、下拉菜单 |
| `shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | 模态框、拖拽元素 |

---

## 2. Block 状态机

### 2.1 状态定义

| 状态 | 说明 | 视觉表现 |
|------|------|---------|
| `display` | 展示态，不在编辑 | 纯 HTML，无边框，无背景 |
| `edit` | 编辑态，tiptap 挂载 | 左侧 2px accent 边框，背景提亮 |
| `focused` | 键盘焦点态（未编辑） | 2px accent focus ring |
| `dragging` | 正在被拖拽 | opacity 0.5，背景 accent-subtle |

### 2.2 状态转换

```
display ──[点击 / Enter]──→ edit
  ↑                            │
  └──[ESC / blur / 点击其他]────┘

edit ──[拖拽目标悬停]──→ dragging

display ──[键盘↑↓]──→ focused ──[Enter]──→ edit
                    ↑         │
                    └──[ESC]──┘
```

### 2.3 临时状态

- `pendingCursorPos`：编辑态切换瞬间使用，记录点击位置，tiptap 挂载后立即消费

---

## 3. 鼠标操作

### 3.1 单击 Block 内容区

**行为：** 将目标 Block 切换为 `edit` 态，光标落在点击位置

**边界情况：**

| 场景 | 行为 |
|------|------|
| 点击已有 `edit` 态 Block | 不做任何操作，光标移动到点击位置 |
| 点击折叠态父 Block | 进入编辑态，父 Block 不展开 |
| 点击子 Block（父折叠） | 父 Block 自动展开，再进入子 Block 编辑态 |
| 点击页面空白区域 | 当前编辑态 Block 失活，保存内容 |

### 3.2 折叠图标点击

**前提：** Block 有子 Block

**行为：** 切换 `collapsed` 属性，子 Block 高度动画收缩/展开（200ms 过渡）

### 3.3 拖拽操作

**触发区：** bullet（圆点）区域

**放置类型：**

| 放置位置 | 结果 |
|---------|------|
| 目标 Block 上方 50% 区域 | 作为目标的前一个兄弟 |
| 目标 Block 下方 50% 区域 | 作为目标的后一个兄弟 |
| 目标 Block 操作区（左侧） | 作为目标的子 Block |

**视觉反馈：**
- 拖拽中：被拖 Block opacity 0.5，背景 accent-subtle
- 放置指示线：2px accent 线，即时响应
- 循环嵌套检测：禁止拖拽父节点到其子节点区域

### 3.4 Backlinks 点击

**行为：** 跳转到源 Block 所在 Page，并将该 Block 切换为 `edit` 态

### 3.5 层级线（Level Lines）

**显示条件：** Block 拥有子 Block 且处于展开态

**样式：** 1px 实线，accent 颜色透明度 0.15，从当前 Block 下方延伸至最后一个子孙 Block 底部

---

## 4. 键盘操作

### 4.1 Enter — 拆分 Block

**基于光标位置分流：**

| 光标位置 | 条件 | 行为 |
|---------|------|------|
| 行首 | `cursorPos === 1` | 在当前 Block **上方**插入空兄弟节点 |
| 行尾 | `cursorPos === contentLen + 1` | 有展开子节点 → 插入为第一个子节点；否则插入为下方兄弟 |
| 中间 | 其他情况 | 拆分内容，后半创建新 Block 作为下方兄弟 |
| 空行 | `contentLen === 0` | 视为行尾处理 |

### 4.2 Backspace — 合并 Block

**前提：** 光标在 Block 开头

**行为：** 将当前 Block 内容追加到上一个 Block 末尾，删除当前 Block

**边界情况：**

| 场景 | 行为 |
|------|------|
| 光标不在开头 | Backspace 由 tiptap 处理（删除字符） |
| 第一个 Block | 不触发合并 |
| 空 Block | 触发合并（删除空 Block） |

### 4.3 Tab — 缩进

**前提：** 存在前一个兄弟 Block

**行为：** 将当前 Block 添加为前一个 Block 的子 Block（作为最后一个子节点）

### 4.4 Shift+Tab — 反缩进

**前提：** 不是顶级 Block（`parentId !== null`）

**行为：** 将当前 Block 提升到父 Block 的兄弟位置（插入到父 Block 之后）

### 4.5 ↑ — 上移焦点

**行为：** 移动焦点到上一个 Block（按树的先序遍历顺序），目标 Block 进入 `edit` 态

**触发条件：** 光标在文档开头时才触发 Block 切换

### 4.6 ↓ — 下移焦点

**行为：** 移动焦点到下一个 Block（按树的先序遍历顺序），目标 Block 进入 `edit` 态

**触发条件：** 光标在文档末尾时才触发 Block 切换

### 4.7 ESC — 退出编辑

| 当前状态 | ESC 行为 |
|---------|---------|
| `edit` 态 | 保存内容，退出编辑态 |
| `focused` 态 | 清除焦点 |
| 拖拽中 | 取消拖拽 |

### 4.8 Ctrl+S — 手动保存

**行为：** 触发当前 `edit` 态 Block 的保存逻辑，写入 IndexedDB

---

## 5. 组件规范

### 5.1 页面布局

```
┌─────────────────────────────────────────────────────────┐
│ Sidebar (280px) │ Main Content (flex: 1)               │
│                 │                                       │
│ - 页面列表       │ - 页面标题                            │
│ - 日记列表       │ - Block 树                           │
│ - 搜索          │ - Backlinks 面板                      │
│                 │                                       │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Block 组件结构

```
.block
├── .block-bullet          // 圆点/拖拽触发区
├── .block-indent          // 缩进指示器
├── .block-content         // 内容区（编辑态：tiptap / 展示态：HTML）
├── .block-children        // 子 Block 容器
│   └── .block (递归)
└── .block-level-line      // 层级线（有子 Block 时显示）
```

### 5.3 动画规范

| 动画 | 时长 | 缓动 | 用途 |
|------|------|------|------|
| 折叠/展开 | 200ms | ease-out | Block 子节点高度变化 |
| 指示线出现 | 0ms | 无 | 拖拽放置指示线 |
| 页面切换 | 150ms | ease-in-out | 页面内容淡入 |

---

*本文档由 2 个交互规范文档合并而成，版本 v1.0*
