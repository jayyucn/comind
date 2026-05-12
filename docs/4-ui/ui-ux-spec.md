# comind UI/UX 规范

> 版本：v0.6
> 日期：2026-04-23
> 状态：**待评审**（Sidebar 重新设计，配合 Phase 1.1 Journal）

---

## 设计哲学

### 概念方向：墨水与纸张

> comind 的核心隐喻是**墨水落在纸上**——内容是主角，结构是纸张的折痕，工具隐入背景。
>
> 不追求"App 感"，追求"书写感"。

具体来说：

- **质地优先于装饰**：用纸张纹理和墨水深浅表达层级，而非颜色区块
- **静谧**：整体低对比度，让链接、标签、折叠状态从内容中自然浮现
- **精准**：每个交互有明确的视觉反馈，不模糊

---

## 视觉系统

### 调色板

> 不依赖 Tailwind 默认色，每组颜色有冷暖一致性。

```
背景层级：
  --bg-base:        #FAFAF8   /* 主内容区背景，温润的米白，非刺眼纯白 */
  --bg-sidebar:      #F3F2EE   /* Sidebar 背景，稍暖的灰 */
  --bg-hover:        #EEEDE9   /* Hover 态背景 */
  --bg-active:       #E8E7E3   /* Active / 已选中背景 */

文字层级：
  --text-primary:    #1C1917   /* 主文字，暖近黑（不是 #000000） */
  --text-secondary:   #78716C   /* 次要文字，时间戳、占位符 */
  --text-tertiary:   #A8A29E   /* 最低层级，如层级线、禁用态 */

边框层级：
  --border:          #E5E4DF   /* 分割线、容器边框 */
  --border-strong:   #C9C8C3   /* 强分割，折叠图标区域 */

交互色：
  --accent:          #B45309   /* 主强调色，琥珀深橙，非典型蓝，有书卷气 */
  --accent-hover:    #92400E   /* 强调色 hover */
  --accent-subtle:   #FEF3C7   /* 强调色浅底，用于当前 Block 高亮 */

链接：
  --link:            #1D4ED8   /* 链接蓝，相对沉稳 */
  --link-hover:      #1E40AF   /* 链接 hover */

标签：
  --tag-text:        #047857   /* 标签文字，墨绿 */
  --tag-bg:          #ECFDF5   /* 标签背景薄荷绿 */

功能色（Phase 1 暂不需要，可预留）：
  --success:         #059669
  --warning:         #D97706
  --error:           #DC2626
```

### 字体系统

```
正文 / 内容（所有 Block 内文字）：
  字体：Noto Sans SC（中文）+ Geist（西文）
  大小：15px
  字重：400
  行高：1.75（宽松行高，outliner 内容可读性优先）

页面标题（Page Block 内容，isPage=true 的 Block）：
  字体：Noto Sans SC + Geist
  大小：20px
  字重：600
  行高：1.4

Sidebar 标题：
  字体：同正文
  大小：13px
  字重：500
  字间距：0.05em（微微拉开，更有标题感）

Sidebar 副文字（时间戳等）：
  大小：12px
  字重：400
  颜色：--text-secondary

Placeholder / 占位符：
  字体：同正文
  颜色：--text-tertiary
  斜体

标签文字：
  大小：13px
  字重：500

快捷键标注（Phase 1.1 考虑）：
  字体：JetBrains Mono
  大小：11px
  背景：--bg-hover
  padding: 2px 5px
  border-radius: 3px
```

> **为什么不只用 system-ui？**
> system-ui 在不同系统表现不一致（macOS 苹方 / Windows Segoe UI / Ubuntu 系统字体），无法控制字间距和渲染风格。Phase 1 通过 npm 引入字体，Google Fonts CDN 加载，保证所有用户看到一致的排版。
>
> Noto Sans SC：Google 开源，汉字覆盖最全，视觉中性不抢戏。
> Geist：Vercel 开源，比 Inter 更有个性，数字和英文渲染优秀。

### 间距系统

```
单位：4px 基准网格

Block 垂直间距：      2px  （紧密大纲感）
Block 左缩进（每级）：  24px
Sidebar 内边距：        12px（3 单位）
Sidebar 项目间距：      2px  （紧凑列表）
Sidebar 折叠图标宽：    16px
Block 操作区宽度：      40px（折叠图标 + 拖拽手柄）
Backlinks 内边距：     16px
主内容区左右边距：      自适应（Sidebar 240px 固定，剩余居中）
主内容最大宽度：        无上限（内容撑满，Sidebar 外区域全部利用）
```

> **关键变更：去掉了 800px max-width。** 内容密集型工具不应人为压窄，Sidebar 固定 240px 后主内容区自然达到 900-1200px（取决于屏幕宽度）。

### 动效哲学

> **克制、真实、有目的。**

动画服务于确认，不服务于好看。

```
折叠/展开（Block 子节点隐藏/显示）：
  property: max-height
  duration: 180ms
  easing: cubic-bezier(0.4, 0, 0.2, 1)
  （比 ease 更自然的减速）

Sidebar 折叠/展开：
  property: width
  duration: 200ms
  easing: cubic-bezier(0.4, 0, 0.2, 1)

Backlinks 折叠/展开：
  property: max-height
  duration: 180ms
  easing: cubic-bezier(0.4, 0, 0.2, 1)

编辑器挂载（Block 进入编辑态）：
  property: border-color, background-color
  duration: 80ms
  easing: ease
  （极快，感觉像是"就在这里编辑"）

拖拽放置指示线：
  无动画，instant 出现/消失（符合直觉：放置即确定）

Hover 态：
  无过渡，instant（outliner 操作频繁，延迟感会累积）

Focus Ring（键盘导航焦点）：
  无动画
  样式：2px solid --accent，offset 2px，border-radius 3px
```

---

## 布局

### 页面结构

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ┌──────────┐ ┌────────────────────────────────────────┐  │
│   │ Sidebar  │ │                                        │  │
│   │  240px   │ │           Main Content                  │  │
│   │  固定     │ │           自适应宽度                    │  │
│   │          │ │                                        │  │
│   │  ──────  │ │                                        │  │
│   │          │ │                                        │  │
│   └──────────┘ └────────────────────────────────────────┘  │
│                ← Backlinks Section（内嵌，随页面滚动）→     │
└──────────────────────────────────────────────────────────────┘
```

**Layout Spec：**

```
App
  display: flex
  height: 100vh
  overflow: hidden

Sidebar
  width: 260px（固定，非 240px，内容更从容）
  flex-shrink: 0
  border-right: 1px solid --border
  display: flex
  flex-direction: column
  overflow: hidden
  position: relative
  /* 纸张纹理叠加（subtle）*/
  &::before: SVG noise filter, opacity 0.03，pointer-events: none

  /* 折叠动画 */
  transition: width 200ms cubic-bezier(0.4, 0, 0.2, 1)
  &.collapsed: width: 0, overflow: hidden

SidebarHeader
  height: 48px
  display: flex
  align-items: center
  justify-content: space-between
  padding: 0 16px 0 14px
  border-bottom: 1px solid --border
  flex-shrink: 0

SectionJournal
  padding: 10px 8px 8px
  flex-shrink: 0

SectionPages
  flex: 1
  overflow: hidden
  display: flex
  flex-direction: column
  padding: 4px 8px

SidebarFooter
  flex-shrink: 0
  padding: 6px 8px 8px
  border-top: 1px solid --border

MainContent
  flex: 1
  overflow-y: auto
  padding: 32px 48px 48px 48px
  &::-webkit-scrollbar { width: 6px }
  &::-webkit-scrollbar-thumb { background: --border-strong; border-radius: 3px }
  &::-webkit-scrollbar-thumb:hover { background: --text-tertiary }
```

---

## 组件规范

### Sidebar

Sidebar 由四个区域构成：Header、Journal Section、Pages Section、Footer。
Journal Section（琥珀底色按钮）是 Phase 1.1 引入的独立功能区，与 Pages 视觉平等但功能上有主次。

```
┌──────────────────────────────────────────────┐
│ COMIND                                [◀]    │  ← SidebarHeader（48px）
├──────────────────────────────────────────────┤
│ 日记                                        │  ← Section Label（10px 全大写）
│ ┌────────────────────────────────────────┐  │
│ │ 🌤️ 2026-04-23                         │  │  ← JournalButton（琥珀底）
│ │    今天                              → │  │
│ └────────────────────────────────────────┘  │
├──────────────────────────────────────────────┤
│ 页面                                  [+]   │  ← Section Label + NewBtn
│ 📄 数据模型设计                    3分钟前  │  ← PageItem
│ 📄 Phase 1 技术选型                  昨天    │
│ 📄 UI/UX 规范 v0.5                  4月14日  │
│ 📄 Sortable 实现方案                4月12日  │
│  ...                                        │
├──────────────────────────────────────────────┤
│  / 斜杠命令 · Ctrl+K 搜索                    │  ← SidebarFooter Hint
└──────────────────────────────────────────────┘
```

**SidebarHeader:**
- Logo "COMIND"：13px 600，letter-spacing 0.18em，--text-secondary，全大写
- Toggle 按钮：24×24px，radius 4px，折叠动画 200ms
- 高度：48px，底部分割线 1px --border

**SectionJournal:**
- Section Label "日记"：10px 500，letter-spacing 0.12em，--text-tertiary，padding 0 6px 5px
- JournalButton：宽度 100%，padding 8px 10px，radius 6px，背景 --accent-subtle
- 左侧竖条：2.5px --accent，始终可见
- hover：背景 #FEF0C0，箭头右移 2px
- sub 行："今天"（今天日记，accent 色）/ 具体日期（历史日记，--text-tertiary）

**SectionPages:**
- Section Label "页面"：10px 500，letter-spacing 0.12em，--text-tertiary
- New Page 按钮：20×20px，radius 4px，位于 header 右侧
- PagesList：flex: 1，overflow-y: auto，滚动条 4px

**SidebarFooter:**
- 快捷键提示：10px，--text-tertiary，居中
- kbd 样式：JetBrains Mono 9px，背景 --bg-hover，边框 1px --border，radius 3px

**PageItem:**
- 结构：[emoji 13px] [title + time 文本区 flex] [time]
- title：13px 400，--text-primary，ellipsis
- time：11px，--text-tertiary，JetBrains Mono
- active：背景 --bg-active，左竖条 2px --accent，title 字重 500
- hover：背景 --bg-hover

**Sidebar 空状态（Pages 区无内容时）：**
```
┌────────────────────────────────────────┐
│          📝                           │
│        暂无页面                       │
│    点击上方 + 创建第一个页面          │
│    或使用 Ctrl+K 搜索                 │
└────────────────────────────────────────┘
```
- icon：32px，opacity 0.4
- title：14px 500，--text-secondary
- sub：12px，--text-tertiary，Ctrl+K 加粗
```

### Block

```
每个 Block 结构：

[40px 操作区] [内容区]
  操作区      内容区
  ─────────  ─────────────────────────────────────────────────
  [折叠]      Block 内容文字 / tiptap 编辑器
  [拖拽]      [[链接]] #标签 从内容中解析渲染
  (可选)      └── 子 Block（缩进 24px/级，层级线）

操作区宽度：40px（固定）
操作区内容：折叠图标（16px）+ 拖拽手柄（16px）+ 4px gap

折叠图标（CollapseIcon）：
  有子 Block 时显示，无子 Block 时隐藏
  ▶（折叠态）→ 展开子节点
  ▼（展开态）→ 折叠子节点
  颜色：--text-tertiary
  hover：--text-secondary
  cursor: pointer

拖拽手柄（DragHandle）：
  默认：隐藏（opacity: 0）
  Block hover：opacity: 0.4
  手柄 hover / 拖拽中：opacity: 0.7，cursor: grab
  内容：6点阵 ⋮⋮（SVG 或 CSS 生成）

层级线（IndentLines）：
  位于操作区右侧边缘，每个层级一条竖线
  level 2 → 1 条线，level 3 → 2 条线，依次类推
  线宽：1px，颜色从 --border 递减至 --bg-base
  最高可见层级：6（6 级以后线不可见，避免视觉噪音）

Block 内容区（Display 态）：
  font: 15px / 1.75，--text-primary
  无左边框，无背景色（融入页面）
  min-height: 27px（行高 1.75 × 15px ≈ 26px）

Block 内容区（Edit 态）：
  边框：左侧 2px solid --accent
  背景：--bg-base（轻微提亮，表示"这里在编辑"）
  padding-left: 4px（给 accent 边框留呼吸空间）
  min-height: 27px

Block Hover（Display 态）：
  背景：--bg-hover（极轻微，整个 Block 行变色）
  操作区：折叠图标 + 拖拽手柄 opacity 变化

Block 层级嵌套示例：
  level 1:  ┌[▷][⋮⋮] 内容...                               ─┐
  level 2:   ┌[▷][⋮⋮] | 内容...                             │
  level 3:   ┌[▷][⋮⋮] | | 内容...                           │
```

### 编辑器挂载行为

```
进入编辑态（点击 Block 或按 Enter）：
  1. 当前 Block 内容区替换为 tiptap 实例
  2. 左侧立即出现 2px --accent 边框（80ms）
  3. 背景变为 --bg-base（80ms）
  4. tiptap 自动聚焦，光标位置保持（或移到末尾）

退出编辑态（按 ESC）：
  1. 保存内容到 Pinia
  2. 销毁 tiptap 实例
  3. 左侧边框消失（instant）
  4. 背景恢复透明（instant）
  5. 回到 Display 态

仅 activeBlock 挂载 tiptap，其余 Block 均为静态 HTML。
```

### Backlinks Section

```
定位：Page 最后一个 Block 之后，内嵌在页面内容流中（非固定面板）
与页面内容的最小间距：48px（确保 Backlinks 不出现在页面"中段"）

┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  Block 1                                                     │
│    Block 1.1                                                 │
│                                                              │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │ ← 分割线
│                                                              │
│  ↩ 反向链接 (3)                                   [折叠]   │ ← SectionHeader
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 📄 存储规范                                              │ │
│  │ "参考了 [[数据模型设计]] 的实现..."                     │ │
│  │                                           [跳转 →]     │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 📄 项目笔记                                              │ │
│  │ "[[数据模型设计]] 中提到..."                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘

BacklinksContainer（外层容器）:
  margin-top: 48px                                ← 与上方内容的最小间距
  max-height: 400px
  overflow-y: auto
  /* 折叠状态下 max-height 归零，通过动画过渡 */
  transition: max-height 180ms cubic-bezier(0.4, 0, 0.2, 1)

BacklinkItem:
  内边距：12px 16px
  背景：无
  hover：背景 --bg-hover
  cursor: pointer（点击跳转）
  结构：
    [type-icon] [source-title]          ← 13px 500 --text-primary
    [preview-text]                        ← 13px 400 --text-secondary，max 2 行，ellipsis
    [jump-button]                         ← "跳转 →" 13px --link

Section 折叠时：
  max-height 归零（180ms 动画），只显示 SectionHeader

Section 空状态：
  "暂无反向链接"，--text-tertiary，13px，居中，16px 上下 padding
  （不计入 max-height 约束，展开态高度由内容撑起）
```

### 空状态

```
无页面（Sidebar 空）：
  ┌──────────────────────────────────────┐
  │                                      │
  │          暂无页面                     │ ← 16px 500 --text-secondary
  │          点击上方「+」创建             │ ← 13px 400 --text-tertiary
  │                                      │
  └──────────────────────────────────────┘

Page 无 Block（BlockList 空）：
  自动创建 1 个空 Block → 进入编辑态 → 光标落入
  Placeholder: "输入文字，或使用 [[链接]] 或 #标签..."
  （斜体，--text-tertiary）
  Block 左上角出现 2px --accent 边框（编辑态标识）
```

---

## 交互状态

### Focus Ring（键盘导航专用）

```
:focus-visible
  outline: 2px solid --accent
  outline-offset: 2px
  border-radius: 3px

以下元素必须可见 Focus Ring：
  - Sidebar NewPageButton
  - Sidebar PageItem
  - Backlinks SectionHeader
  - BacklinksItem 中的 JumpButton
  - 未来工具栏按钮

Block 本身不需要 Focus Ring（通过左侧 accent 边框和背景色区分 active 编辑态）
```

### 拖拽交互

```
被拖动 Block：
  视觉：opacity: 0.5，背景 --accent-subtle
  cursor: grabbing
  实际 DOM 不移动，由 Pinia 状态驱动目标位置预览

放置指示线：
  颜色：2px --accent
  instant 出现/消失（无动画）

放置层级指示：
  放置在 Block 之前/之后：水平线在目标 Block 上方/下方
  放置为子 Block：水平线缩进 24px（与目标 Block 操作区对齐）

取消拖拽：
  按 ESC → 拖拽状态清除，Block 回到原位
  鼠标移出主内容区 → 拖拽状态清除
```

### 文本选中 & 滚动条

```
::selection
  background: #FDE68A（琥珀色选中，呼应 accent）
  color: --text-primary

::-webkit-scrollbar（主内容）
  width: 6px
  &-thumb: background --border-strong，border-radius 3px
  &-thumb:hover: background --text-tertiary
  &-track: background transparent

::-webkit-scrollbar（Sidebar）
  width: 4px
  &-thumb: background --border，border-radius 2px
```

---

## 图标方案

> Phase 1 使用 emoji（零依赖），Phase 2/3 迁移至 SVG sprite。

| 位置 | emoji | 说明 |
|------|-------|------|
| PageItem 图标 | 📄 | Page 类型 |
| JournalItem 图标（Phase 1.1） | 📅 | 日记类型 |
| BacklinksSectionHeader | ↩ | 反向链接 |
| Block 折叠（折叠态） | ▶ | 右三角 |
| Block 折叠（展开态） | ▼ | 下三角 |
| 新建按钮 | + | 加号 |
| 跳转按钮 | → | 右箭头 |

---

## 响应式

```
最小支持宽度：1024px

1024px - 1200px（窄屏笔记本）：
  Sidebar 保持 240px
  主内容区 padding 缩小至 24px 32px

> 1200px：
  Sidebar 240px
  主内容区 padding 保持 48px（已足够宽）

< 1024px：
  Sidebar 折叠至 0px，显示 hamburger toggle 按钮
  toggle 按钮位于主内容区左上角
```

---

## 附录：字体引入方式

```html
<!-- Google Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

<!-- 或通过 npm 安装后 import -->
<!-- npm install @fontsource/noto-sans-sc @fontsource/jetbrains-mono -->
```

CSS 字体声明：

```css
:root {
  --font-body: 'Noto Sans SC', 'JetBrains Mono', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}

body {
  font-family: var(--font-body);
}
```

---

*文档 v0.5，评审完成，已确认。*
