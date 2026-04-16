# comind UI/UX 规范

> 版本：v0.3
> 日期：2026-04-16
> 状态：✅ 评审完成，已确认

---

## 1. 设计原则

### 1.1 Phase 1 设计哲学

> **功能优先，极简美学。** Phase 1 不追求视觉丰富，只追求：
> - 结构清晰：层级关系一眼可辨
> - 状态明确：编辑态/展示态/折叠态界限分明
> - 极低干扰：UI 不抢夺注意力，让内容成为焦点

### 1.2 核心原则

- **结构 > 样式**：层级关系通过缩进和视觉层次表达，不依赖颜色
- **所见即所得**：Block 内容即核心，装饰性 UI 最小化
- **一致性**：所有状态有唯一视觉表达，不存在歧义

---

## 2. 整体布局

### 2.1 页面结构

```
┌─────────────────────────────────────────────────────────┐
│  Header（Phase 1 省略，Phase 1.1 考虑）                  │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│   Sidebar    │            Main Content                  │
│   (Page 列表) │         (Block 树 + 编辑器)             │
│              │                                          │
│   240px      │            flex: 1                       │
│   可折叠      │                                          │
│              │                                          │
└──────────────┴──────────────────────────────────────────┘

Page 内容 + Backlinks Section（内嵌在 Page 底部，随页面滚动）
```

### 2.2 响应式策略

- **Phase 1 桌面优先**（最小宽度 1024px）
- 移动端 Phase 2/3 考虑，不在 Phase 1 范围
- Sidebar 在窄屏时可折叠（toggle 按钮）

### 2.3 布局约束

| 区域 | 约束 |
|------|------|
| Sidebar 宽度 | 固定 240px（可折叠至 0px） |
| Block 内容区 | flex: 1，最大宽度 800px（居中显示） |
| Header | Phase 1 省略，Phase 1.1 考虑 |

---

## 3. 组件清单

### 3.1 Sidebar（侧边栏）

**定位：** Page 导航区域。

**内容：**
- 当前工作区标题（"comind"）
- 新建页面按钮（"+" 或 "新建页面"）
- Page 列表（按字母/修改时间排序）
- Journal 入口（Phase 1.1 考虑）

> **Phase 1 不实现 Sidebar 搜索功能。**

**Page 列表项：**

```
┌─────────────────────────┐
│ 📄 页面标题             │
│    最后修改时间         │
└─────────────────────────┘
```

**状态：**
- Default：背景透明，文字 #333
- Hover：背景 #f5f5f5
- Active（当前页面）：背景 #e8f0fe，左边框 accent 颜色

**交互：**
- 点击 → 打开对应 Page
- 右键 → Phase 2/3 考虑（重命名、删除），Phase 1 暂不实现

### 3.2 BlockList（Block 列表）

**定位：** 主内容区主体，显示当前 Page 的 Block 树。

**结构：**

```
Block 1（顶级 Page Block = 页面标题）
  Block 1.1（子 Block）
    Block 1.1.1（孙 Block）
  Block 1.2（子 Block）
Block 2（顶级 Bullet）
  ...
```

**Block 树渲染规则：**

```
每个 Block 的缩进 = level * 24px

展开态：显示所有子 Block
折叠态：只显示当前 Block，子 Block 隐藏
```

### 3.3 Block（单个 Block）

**结构：**

```
┌────────────────────────────────────────────────────────┐
│ [折叠图标] [拖拽手柄] Block 内容 / 编辑器                │
│           [缩进层级线]                                  │
└────────────────────────────────────────────────────────┘
```

**组成部分：**

| 元素 | 说明 |
|------|------|
| 折叠图标 | 有子 Block 时显示（▶ 折叠 / ▼ 展开）；无子 Block 时隐藏 |
| 拖拽手柄 | 始终显示，hover 时高亮，拖拽时显示放置指示线 |
| 缩进层级线 | 每个缩进层级一条竖线，颜色随层级递减 |
| Block 内容 | 展示态：静态 HTML；编辑态：tiptap 输入框 |

**Block 展示态（Display）：**

```
┌────────────────────────────────────────────────────────┐
│ ▶ ⋮⋮ Block 内容文字，包含 #标签（高亮）                │
│ ▶    和 [[链接]]（蓝色可点击）                          │
└────────────────────────────────────────────────────────┘
```

**Block 编辑态（Edit）：**

```
┌────────────────────────────────────────────────────────┐
│    ⋮⋮ [tiptap 输入框，内容="Block 内容文字"]            │
└────────────────────────────────────────────────────────┘
```

**Block 状态定义：**

| 状态 | 视觉表达 |
|------|---------|
| Default（展示态） | 背景透明，文字 #1a1a1a |
| Hover（展示态） | 背景 #fafafa |
| Active（编辑态） | 背景 #fff，左边框 2px accent 蓝色边框 |
| Dragging（拖拽中） | 背景 #f0f4ff，opacity: 0.8，放置位置显示蓝色横线 |
| Drop Target（放置目标） | 放置位置显示 2px accent 蓝色横线 |

**层级线规则：**

```
level 1 Block：无层级线
level 2 Block：1 条竖线
level 3 Block：2 条竖线
...以此类推
```

竖线颜色随层级递减：#d0d0d0 → #e8e8e8 → #f0f0f0（最深层级线几乎不可见）

### 3.4 Editor（tiptap 编辑器封装）

**定位：** 当 Block 处于编辑态时，替换内容区为 tiptap 实例。

**规则：**

- 只在 active Block 上挂载
- 仅在 activeBlockId 对应的 Block 内渲染
- 其余 Block 保持展示态

**Placeholder（空 Block 提示）：**

```
输入文字，或使用 [[链接]] 或 #标签 ...
```

**输入框样式：**

```css
{
  outline: none;
  border: none;
  background: transparent;
  font-size: 15px;
  line-height: 1.6;
  color: #1a1a1a;
  min-height: 24px;
  padding: 0;
  font-family: inherit;
}
```

### 3.5 Backlinks Section（反向链接区）

**定位：** 内嵌在 Page 内容底部，**随页面自然滚动**，非固定高度独立面板。

> 参考 Logseq 的内嵌反向链接区实现：位于 Page 最后一个 Block 之后，作为一个可折叠的 Block 区块存在。

**结构：**

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│   [Page 内所有 Block 内容...]                          │
│                                                        │
│   ┌──────────────────────────────────────────────────┐ │
│   │ 🔗 反向链接 (3)                            [折叠] │ │
│   ├──────────────────────────────────────────────────┤ │
│   │ 📄 页面 A                                          │ │
│   │   "参考了 [[存储规范]]，详细内容见..."             │ │
│   │                                           [跳转]  │ │
│   ├──────────────────────────────────────────────────┤ │
│   │ 📄 页面 B                                          │ │
│   │   "[[存储规范]] 的实现方案..."                     │ │
│   └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

**行为：**

- 展示当前 Page 的所有反向链接（来自 Link 表，targetPageId = 当前 Page.id）
- 每条显示：来源 Page 标题 + Block 内容预览（截断至约 80 字）+ 跳转按钮
- 无反向链接时显示："暂无反向链接"
- 可折叠（收起后只显示标题行）
- 随 Page 内容自然滚动，**非固定高度**

**与 Logseq 的差异（Phase 1 简化）：**
- 不显示引用块引用层级（Phase 2/3 考虑）
- 不支持反向链接内直接编辑（Phase 2/3 考虑）

### 3.6 Drag Handle（拖拽手柄）

**定位：** 每个 Block 左侧，折叠图标旁边。

**样式：**
- 宽度：16px
- 内容：6 个点（⋮⋮）或拖拽横线
- Default：透明度 0（不可见）
- Hover Block：透明度 0.3
- Hover 手柄本身：透明度 0.6，cursor: grab

**放置指示线：**

```
- 放置在 Block 之前：蓝色横线出现在 Block 上方
- 放置在 Block 之下：蓝色横线出现在 Block 下方
- 放置为子 Block：缩进 + 蓝色横线
```

---

## 4. 视觉规范

### 4.1 颜色系统

| 用途 | 色值 |
|------|------|
| 正文文字 | #1a1a1a |
| 次要文字（时间戳等） | #888888 |
| 页面标题 | #1a1a1a，字重 600 |
| 链接文字 | #2563eb（蓝色） |
| 链接 hover | #1d4ed8 |
| 标签文字 | #059669（绿色） |
| 标签背景 | #ecfdf5 |
| 边框 / 分割线 | #e5e5e5 |
| 背景（主内容） | #ffffff |
| 背景（Sidebar） | #fafafa |
| 背景（Block hover） | #fafafa |
| 背景（编辑态 Block） | #ffffff + 左侧 accent 边框 |
| 背景（拖拽中） | #eff6ff |
| Accent 主色 | #2563eb（蓝色） |
| 层级线 | #e0e0e0（最深层递减至 #f0f0f0） |

### 4.2 字体系统

| 用途 | 字体 | 大小 | 字重 | 行高 |
|------|------|------|------|------|
| Page 标题 | system-ui, sans-serif | 18px | 600 | 1.4 |
| Block 内容 | system-ui, sans-serif | 15px | 400 | 1.6 |
| Sidebar Page 标题 | system-ui, sans-serif | 14px | 400 | 1.4 |
| Sidebar 副文字 | system-ui, sans-serif | 12px | 400 | 1.4 |
| 链接 | system-ui, sans-serif | 15px | 400 | 1.6，蓝色 |
| 标签 | system-ui, sans-serif | 13px | 500 | 1.6，绿色 |
| Placeholder | system-ui, sans-serif | 15px | 400 | 1.6，#aaaaaa |

### 4.3 间距系统

| 用途 | 间距 |
|------|------|
| Block 垂直间距 | 2px |
| Block 水平缩进（每级） | 24px |
| Sidebar 内边距 | 12px |
| Sidebar 项目间距 | 4px |
| Backlinks Section 内边距 | 12px |
| 主内容区左右边距 | 80px |
| 主内容区最大宽度 | 800px（居中） |

### 4.4 过渡与动画

| 场景 | 过渡 |
|------|------|
| Block 折叠/展开 | CSS max-height transition，200ms ease |
| Backlinks Section 折叠/展开 | CSS max-height transition，200ms ease |
| Sidebar 折叠/展开 | CSS width transition，200ms ease |
| Hover 状态 | 无动画（instant） |
| 编辑器挂载/销毁 | 无动画（instant） |
| 拖拽放置线 | 无动画（instant） |

---

## 5. 空状态

### 5.1 无 Page（Sidebar 空）

```
┌──────────────────────────┐
│  comind                  │
├──────────────────────────┤
│                          │
│    暂无页面               │
│    [创建第一个页面]        │
│                          │
└──────────────────────────┘
```

### 5.2 Page 内无 Block（BlockList 空）

```
Page 内无任何 Block 时：
- 自动创建 1 个空 Block，插入当前 Page
- 空 Block 处于编辑态，光标自动落入
- Placeholder: "输入文字开始..."
```

---

## 6. 快捷键映射

| 快捷键 | 行为 | 触发条件 |
|--------|------|---------|
| `Enter` | 拆分 Block | 编辑态，光标在 Block 中间或末尾 |
| `Backspace` | 合并 Block | 编辑态，光标在 Block 开头 |
| `Tab` | 缩进 | 编辑态 或 展示态（通过快捷键） |
| `Shift + Tab` | 反缩进 | 编辑态 或 展示态（通过快捷键） |
| `↑ / ↓` | Block 导航 | 展示态，上下移动焦点 |
| `Enter`（导航后） | 进入编辑 | 展示态，聚焦 Block 后按 Enter |
| `ESC` | 退出编辑 | 编辑态，回到展示态 |

> **说明：** 展示态 Tab/Shift+Tab 行为见 `block-editor-spec.md`。

---

## 7. 组件层级树

```
App
├── Sidebar
│   ├── SidebarHeader（"comind" 标题）
│   ├── NewPageButton
│   └── PageList
│       └── PageItem × N
│
└── MainContent
    ├── BlockList
    │   └── Block × N（递归，支持无限嵌套）
    │       ├── CollapseIcon
    │       ├── DragHandle
    │       ├── BlockContent（展示态 / 编辑态）
    │       │   ├── DisplayContent
    │       │   └── Editor（tiptap 实例，仅 activeBlock 渲染）
    │       └── ChildrenBlockList（递归）
    │
    └── BacklinksSection
        ├── SectionHeader（"🔗 反向链接 (N)"）
        └── BacklinkItem × N
            ├── SourcePageTitle
            ├── BlockPreview
            └── JumpButton
```

---

## 8. 已确认事项

| 事项 | 结论 |
|------|------|
| 颜色方案 | 确认使用色板 |
| Sidebar 搜索 | Phase 1 不实现搜索功能 |
| Backlinks 样式 | Logseq 风格，内嵌在 Page 底部，随页面滚动 |
| 层级线 | 确认，层级线辅助视觉缩进 |
| 空 Block | Page 无 Block 时自动创建空 Block，光标自动落入 |

---

## 9. 待定事项

| 事项 | 说明 |
|------|------|
| 移动端布局 | Phase 1 桌面优先，窄屏是否支持 Sidebar 折叠 |
| 深色模式 | Phase 2/3 考虑 |
| 图标方案 | 使用 emoji 还是 SVG 图标库（Phase 1 可用 emoji） |
| Backlinks 引用层级 | Phase 2/3 考虑显示引用块的嵌套层级 |

---

*文档 v0.3，评审完成，已确认。*
