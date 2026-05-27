# CSS 系统重构实施方案

> **面向智能体执行者：必须使用子技能**：通过 subagent‑driven‑development（推荐）或 executing‑plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
> **目标**：重构 CSS 系统，建立统一的设计令牌体系，实现 CSS 变量 + SCSS 混合架构
> **架构**：创建三层设计令牌（primitives → semantic → components），将组件样式集中到 src/styles/ 目录
> **技术栈**：CSS 变量、SCSS、Vite
> **前提**：需要先安装 `sass` 依赖

---

## 任务 1：安装 sass 依赖

**涉及文件**：
- 修改：`comind/package.json`

- [ ] **步骤 1：安装 sass 依赖**
执行命令：
```bash
cd comind && npm install -D sass
```
预期结果：sass 添加到 devDependencies

---

## 任务 2：创建设计令牌 - Primitives

**涉及文件**：
- 新建：`comind/src/styles/tokens/_primitives.scss`

- [ ] **步骤 1：创建 tokens 目录**
执行命令：
```bash
mkdir -p comind/src/styles/tokens
```

- [ ] **步骤 2：创建 _primitives.scss**
新建文件 `comind/src/styles/tokens/_primitives.scss`：
```scss
// Design Token Primitives - 原始值层
// 这些是具体的设计值，被语义化层引用

// 颜色 - Amber（强调色系）
$color-amber-50: #FFFBEB;
$color-amber-100: #FEF3C7;
$color-amber-200: #FDE68A;
$color-amber-300: #FCD34D;
$color-amber-400: #FBBF24;
$color-amber-500: #B45309;
$color-amber-600: #92400E;
$color-amber-700: #78350F;

// 颜色 - Stone（中性色系）
$color-stone-50: #FAFAF9;
$color-stone-100: #F5F5F4;
$color-stone-200: #E7E5E4;
$color-stone-300: #D6D3D1;
$color-stone-400: #C9C8C3;
$color-stone-500: #A8A29E;
$color-stone-600: #78716C;
$color-stone-700: #57534E;
$color-stone-800: #44403C;
$color-stone-900: #1C1917;

// 颜色 - 功能色
$color-link: #1D4ED8;
$color-link-hover: #1E40AF;
$color-tag-text: #047857;
$color-tag-bg: #ECFDF5;
$color-success: #059669;
$color-warning: #D97706;
$color-error: #DC2626;
$color-external: #64748B;

// 透明度变体
$accent-03: rgba(180, 83, 9, 0.03);
$accent-06: rgba(180, 83, 9, 0.06);
$accent-08: rgba(180, 83, 9, 0.08);
$accent-10: rgba(180, 83, 9, 0.10);
$accent-40: rgba(180, 83, 9, 0.40);
$tag-10: rgba(99, 102, 241, 0.10);
$tag-40: rgba(99, 102, 241, 0.40);
$ext-40: rgba(100, 116, 139, 0.40);
$overlay: rgba(28, 25, 23, 0.30);

// 间距（4px 基准网格）
$space-1: 4px;
$space-2: 8px;
$space-3: 12px;
$space-4: 16px;
$space-5: 20px;
$space-6: 24px;
$space-8: 32px;
$space-10: 40px;
$space-12: 48px;

// 圆角
$radius-sm: 4px;
$radius-md: 6px;
$radius-lg: 8px;

// 字号
$text-xs: 0.75rem;
$text-sm: 0.875rem;
$text-base: 0.9375rem;
$text-lg: 1.125rem;
$text-xl: 1.25rem;
$text-2xl: 1.5rem;

// 行高
$leading-tight: 1.25;
$leading-normal: 1.5;
$leading-relaxed: 1.75;

// 字重
$font-normal: 400;
$font-medium: 500;
$font-semibold: 600;
$font-bold: 700;

// 阴影
$shadow-focus: 0 0 0 3px rgba(180, 83, 9, 0.10);
$shadow-modal: 0 8px 32px rgba(28, 25, 23, 0.12);
$shadow-elevation-1: 0 1px 3px rgba(28, 25, 23, 0.08);
$shadow-elevation-2: 0 4px 12px rgba(28, 25, 23, 0.10);

// 字体
$font-sans: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
$font-mono: 'JetBrains Mono', 'Fira Code', monospace;

// 布局
$max-width-content: 720px;
$sidebar-width: 260px;

// 过渡
$transition-fast: 120ms ease;
$transition-base: 150ms ease;
$transition-slow: 200ms ease-out;
$transition-collapse: 300ms cubic-bezier(0.4, 0, 0.2, 1);

// Z-index 层级
$z-dropdown: 100;
$z-modal: 200;
$z-toast: 300;
```

---

## 任务 3：创建设计令牌 - Semantic

**涉及文件**：
- 新建：`comind/src/styles/tokens/_semantic.scss`

- [ ] **步骤 1：创建 _semantic.scss**
新建文件 `comind/src/styles/tokens/_semantic.scss`：
```scss
// Design Token Semantic - 语义化层
// 引用原始值，赋予功能语义

:root {
  // 背景层级
  --bg-base: #{$color-stone-50};
  --bg-sidebar: #{$color-stone-100};
  --bg-hover: #{$color-stone-200};
  --bg-active: #{$color-stone-300};

  // 文字层级
  --text-primary: #{$color-stone-900};
  --text-secondary: #{$color-stone-600};
  --text-tertiary: #{$color-stone-500};
  --text-disabled: #{$color-stone-400};

  // 边框层级
  --border: #{$color-stone-200};
  --border-light: #{$color-stone-300};
  --border-strong: #{$color-stone-400};

  // 强调色
  --accent: #{$color-amber-500};
  --accent-hover: #{$color-amber-600};
  --accent-subtle: #{$color-amber-100};
  --accent-bg: #{$color-amber-100};

  // 透明度变体
  --accent-03: #{$accent-03};
  --accent-06: #{$accent-06};
  --accent-08: #{$accent-08};
  --accent-10: #{$accent-10};
  --accent-40: #{$accent-40};
  --tag-10: #{$tag-10};
  --tag-40: #{$tag-40};
  --ext-40: #{$ext-40};
  --overlay: #{$overlay};

  // 间距
  --space-1: #{$space-1};
  --space-2: #{$space-2};
  --space-3: #{$space-3};
  --space-4: #{$space-4};
  --space-5: #{$space-5};
  --space-6: #{$space-6};
  --space-8: #{$space-8};
  --space-10: #{$space-10};
  --space-12: #{$space-12};

  // 圆角
  --radius-sm: #{$radius-sm};
  --radius-md: #{$radius-md};
  --radius-lg: #{$radius-lg};

  // 字号
  --text-xs: #{$text-xs};
  --text-sm: #{$text-sm};
  --text-base: #{$text-base};
  --text-lg: #{$text-lg};
  --text-xl: #{$text-xl};
  --text-2xl: #{$text-2xl};

  // 字体
  --font-sans: #{$font-sans};
  --font-mono: #{$font-mono};

  // 阴影
  --shadow-focus: #{$shadow-focus};
  --shadow-modal: #{$shadow-modal};
  --shadow-elevation-1: #{$shadow-elevation-1};
  --shadow-elevation-2: #{$shadow-elevation-2};

  // 布局
  --max-width: #{$max-width-content};
  --sidebar-width: #{$sidebar-width};

  // 兼容别名（从原 style.css 保留）
  --color-paper: #FFFBF5;
  --color-ink: #{$color-stone-900};
  --color-ink-secondary: #{$color-stone-600};
  --color-ink-muted: #{$color-stone-600};
  --color-ink-faint: #{$color-stone-500};
  --color-accent: #{$color-amber-500};
  --color-accent-deep: #{$color-amber-600};
  --color-accent-bg: #{$color-amber-100};
  --color-border: #{$color-stone-200};
  --color-border-light: #{$color-stone-300};
  --color-border-strong: #{$color-stone-400};
  --color-hover: #{$color-stone-200};
  --color-surface: #{$color-stone-200};
  --color-sidebar-bg: #{$color-stone-100};
  --color-highlight: #{$color-amber-200};
  --color-white: #FFFFFF;
  --color-tag: #6366F1;
  --color-external: #{$color-external};
  --color-scrollbar: #{$color-stone-400};
}
```

---

## 任务 4：创建设计令牌 - Components

**涉及文件**：
- 新建：`comind/src/styles/tokens/_components.scss`

- [ ] **步骤 1：创建 _components.scss**
新建文件 `comind/src/styles/tokens/_components.scss`：
```scss
// Design Token Components - 组件级令牌
// 组件特定用途的设计值

:root {
  // Block 组件
  --block-bullet-color: var(--accent);
  --block-bullet-opacity: 0.35;
  --block-bullet-size: 5px;
  --block-chevron-size: 7px;
  --block-chevron-opacity: 0.45;
  --block-indent-width: 24px;
  --block-transition-collapse: #{$transition-collapse};

  // Sidebar 组件
  --sidebar-item-height: 32px;
  --sidebar-item-padding: #{$space-2};
  --sidebar-icon-size: 16px;

  // 链接与标签
  --link: #{$color-link};
  --link-hover: #{$color-link-hover};
  --tag-text: #{$color-tag-text};
  --tag-bg: #{$color-tag-bg};

  // 状态色
  --success: #{$color-success};
  --warning: #{$color-warning};
  --error: #{$color-error};
  --info: #{$color-link};

  // 优先级背景色
  --priority-low-bg: rgba(148, 163, 184, 0.12);
  --priority-medium-bg: rgba(234, 179, 8, 0.14);
  --priority-high-bg: rgba(249, 115, 22, 0.16);
  --priority-urgent-bg: rgba(239, 68, 68, 0.18);

  // 选中状态
  --selection-bg: rgba(66, 133, 244, 0.15);

  // 滚动条
  --scrollbar-size: 6px;
  --scrollbar-radius: 3px;
}
```

---

## 任务 5：创建 SCSS Mixins

**涉及文件**：
- 新建：`comind/src/styles/_mixins.scss`

- [ ] **步骤 1：创建 _mixins.scss**
新建文件 `comind/src/styles/_mixins.scss`：
```scss
// SCSS Mixins - 样式复用工具

// 响应式断点
@mixin tablet {
  @media (min-width: 768px) { @content; }
}

@mixin desktop {
  @media (min-width: 1024px) { @content; }
}

@mixin mobile {
  @media (max-width: 767px) { @content; }
}

// Focus Ring
@mixin focus-ring {
  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
}

// 过渡动画
@mixin transition-base {
  transition: all var(--transition-base);
}

@mixin transition-fast {
  transition: all var(--transition-fast);
}

@mixin transition-slow {
  transition: all var(--transition-slow);
}

// 滚动条
@mixin custom-scrollbar {
  &::-webkit-scrollbar {
    width: var(--scrollbar-size);
    height: var(--scrollbar-size);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-scrollbar);
    border-radius: var(--scrollbar-radius);
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--text-tertiary);
  }
}

// 文本截断
@mixin text-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@mixin text-clamp($lines: 2) {
  display: -webkit-box;
  -webkit-line-clamp: $lines;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

// Flex 工具
@mixin flex-center {
  display: flex;
  align-items: center;
  justify-content: center;
}

@mixin flex-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

// 按钮基础
@mixin button-base {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  @include transition-base;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  &:active:not(:disabled) {
    background: var(--bg-active);
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @include focus-ring;
}

// 卡片阴影
@mixin card {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

// 输入框基础
@mixin input-base {
  width: 100%;
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-base);
  @include transition-base;

  &:hover:not(:disabled) {
    border-color: var(--border-strong);
  }

  &:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--shadow-focus);
  }

  &::placeholder {
    color: var(--text-tertiary);
  }

  &:disabled {
    background: var(--bg-hover);
    cursor: not-allowed;
  }
}
```

---

## 任务 6：创建 CSS 重置

**涉及文件**：
- 新建：`comind/src/styles/base/_reset.scss`

- [ ] **步骤 1：创建 base 目录**
执行命令：
```bash
mkdir -p comind/src/styles/base
```

- [ ] **步骤 2：创建 _reset.scss**
新建文件 `comind/src/styles/base/_reset.scss`：
```scss
// CSS Reset & Base Styles

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

body {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: $leading-relaxed;
  color: var(--color-ink);
  background: var(--color-paper);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app {
  height: 100%;
  width: 100%;
}

// TipTap editor 基础样式
.tiptap {
  outline: none;
  min-height: 1.3em;
  line-height: $leading-tight;
}

.tiptap p {
  margin: 0;
  padding: 0;
}

// 选中文本样式
::selection {
  background: var(--color-accent-bg);
  color: var(--color-ink);
}

// Focus Ring（键盘导航专用）
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

// 滚动条样式
::-webkit-scrollbar {
  width: var(--scrollbar-size);
  height: var(--scrollbar-size);
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--color-scrollbar);
  border-radius: var(--scrollbar-radius);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

// Sortable.js 拖拽占位符样式
.sortable-ghost,
.sortable-chosen,
.sortable-drag {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

.sortable-ghost::before,
.sortable-ghost::after,
.sortable-chosen::before,
.sortable-chosen::after,
.sortable-drag::before,
.sortable-drag::after {
  display: none !important;
}

[draggable="true"] {
  -webkit-user-drag: element;
}

// 临时占位符元素（跨容器拖拽时插入）
.block-children > div:not([data-block-id]),
.block-list > div:not([data-block-id]) {
  display: none !important;
}

// 链接样式
a {
  color: var(--link);
  text-decoration: none;
  @include transition-base;

  &:hover {
    color: var(--link-hover);
    text-decoration: underline;
  }
}

// 按钮重置
button {
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  border: none;
  background: none;
}

// 输入框重置
input,
textarea {
  font-family: inherit;
  font-size: inherit;
}

// 图片
img {
  max-width: 100%;
  height: auto;
}

// 列表
ul, ol {
  list-style: none;
}

// 禁用用户选择
user-select-none,
.no-select {
  user-select: none;
}
```

---

## 任务 7：创建组件样式 - Block

**涉及文件**：
- 新建：`comind/src/styles/components/_block.scss`
- 修改：`comind/src/components/Block/index.vue`（移除 @import）
- 删除：`comind/src/components/Block/styles.css`（稍后）

- [ ] **步骤 1：创建 components 目录**
执行命令：
```bash
mkdir -p comind/src/styles/components
```

- [ ] **步骤 2：创建 _block.scss**
新建文件 `comind/src/styles/components/_block.scss`：
```scss
// Block 组件样式

.block {
  position: relative;
  user-select: none;
}

.block-row {
  display: flex;
  align-items: center;
  min-height: 1.3em;
  line-height: $leading-tight;
}

.block-indent {
  flex-shrink: 0;
  height: 100%;
}

// 缩进线（Indent Lines）
.block-children::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--indent-depth, 0) * var(--block-indent-width) + 9px);
  width: 1px;
  background: var(--block-bullet-color);
  opacity: 0.12;
  pointer-events: none;
  z-index: 0;
  transition: opacity 200ms ease-out;
}

.block-children:not(.has-children)::before {
  opacity: 0;
}

// Bullet 区域
.block-bullet {
  flex-shrink: 0;
  width: 20px;
  height: 1.8em;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: $radius-sm;
  cursor: pointer;
}

// Bullet 圆点（叶节点）
.bullet-dot {
  width: var(--block-bullet-size);
  height: var(--block-bullet-size);
  border-radius: 50%;
  background: var(--block-bullet-color);
  opacity: var(--block-bullet-opacity);
  transform: translateY(1px);
  transition: opacity 150ms ease-out, transform 150ms ease-out, box-shadow 150ms ease-out;
  flex-shrink: 0;
}

// Chevron 箭头（父节点）
.bullet-chevron {
  width: var(--block-chevron-size);
  height: var(--block-chevron-size);
  border-right: 1.5px solid var(--block-bullet-color);
  border-bottom: 1.5px solid var(--block-bullet-color);
  transform: rotate(45deg) translateY(1px);
  opacity: var(--block-chevron-opacity);
  transition: transform 180ms ease-out, opacity 150ms ease-out;
  flex-shrink: 0;

  &.is-collapsed {
    transform: rotate(-45deg) translateY(1px);
  }
}

// Hover 效果
.block-bullet:hover {
  .bullet-dot {
    opacity: 0.7;
    transform: scale(1.4) translateY(1px);
    box-shadow: 0 0 0 3px var(--accent-08);
  }

  .bullet-chevron {
    opacity: 0.75;
    transform: rotate(45deg) scale(1.2) translateY(1px);
    box-shadow: 0 0 0 3px var(--accent-06);

    &.is-collapsed {
      transform: rotate(-45deg) scale(1.2) translateY(1px);
    }
  }
}

// Active Block
.block.active {
  .bullet-dot {
    opacity: 0.55;
  }

  .bullet-chevron {
    opacity: 0.6;
  }
}

.block-content {
  flex: 1;
  cursor: text;
  min-width: 0;
}

.block-text {
  min-height: 1.3em;
  padding: 0 $space-1;
  border-radius: $radius-sm;
  white-space: pre-wrap;
  word-break: break-word;
}

.block-placeholder {
  color: var(--color-ink-faint);
  font-style: italic;
  pointer-events: none;
}

.block.active .block-text {
  background: var(--accent-06);
}

// 子节点容器
.block-children {
  position: relative;
  padding-left: 20px;
  padding-top: 2px;
  overflow: hidden;
  max-height: 2000px;
  opacity: 1;
  transform: translateY(0);
  min-height: 0;
  transition:
    max-height var(--block-transition-collapse),
    opacity 200ms ease-out,
    transform 250ms ease-out;

  &.is-collapsed {
    max-height: 0;
    opacity: 0.6;
    transform: translateY(-8px);
  }

  &.is-animating {
    overflow: hidden;
  }
}

// 子块项的进入/退出动画
.block-children > .block {
  opacity: 1;
  transform: translateX(0);
  margin-top: 2px;
  transition:
    opacity 200ms ease-out,
    transform 200ms ease-out;

  .block-children.is-collapsed > & {
    opacity: 0;
    transform: translateX(-8px);
  }
}

// Link & Tag styles
.block-link {
  color: var(--color-accent);
  cursor: pointer;
  border-bottom: 1px solid var(--accent-40);

  &.external {
    color: var(--color-external);
    border-bottom-color: var(--ext-40);
  }
}

.block-tag {
  color: var(--color-tag);
  background: var(--tag-10);
  padding: 0 2px;
  border-radius: 3px;
  font-size: 0.9em;

  .tag-sep {
    color: var(--tag-40);
    margin: 0 1px;
  }
}

// 拖拽样式
.block-chosen {
  opacity: 0.8;
}

.block-inner {
  display: flex;
  align-items: center;
  flex: 1;
}

.block-chosen .block-inner {
  background: var(--accent-04);
  border-radius: var(--radius-md);
}

.block-chosen::before,
.block-chosen .block-children::before {
  opacity: 0.3 !important;
}

.block-ghost {
  opacity: 0.3;
  background: var(--accent-06);
  border: 2px dashed var(--color-accent);
  border-radius: var(--radius-md);
  position: relative !important;
  max-width: 100%;
  box-sizing: border-box;

  .block-content,
  .block-bullet {
    visibility: hidden;
  }

  &::after {
    content: '';
    display: block;
    height: 24px;
  }

  &::before {
    display: none !important;
  }

  .block-children::before {
    display: none !important;
  }
}

.block-drag {
  opacity: 1;
  transform: scale(1.02);
  box-shadow: 0 6px 20px var(--overlay);
  border-radius: var(--radius-md);
  cursor: grabbing;
}

// 放置指示线
.drop-indicator {
  position: fixed;
  height: 2px;
  background: var(--color-accent);
  pointer-events: none;
  z-index: $z-dropdown;
  opacity: 0;
  transition: opacity 0ms;

  &.visible {
    opacity: 1;
  }

  &.nest {
    border-left: 2px solid var(--color-accent);
    background: transparent;
    height: 0;
  }
}

// 优先级背景色
.block.priority-low .block-inner {
  background: linear-gradient(90deg, var(--priority-low-bg) 0%, rgba(148, 163, 184, 0.02) 100%);
  border-radius: $radius-md;
}

.block.priority-medium .block-inner {
  background: linear-gradient(90deg, var(--priority-medium-bg) 0%, rgba(234, 179, 8, 0.02) 100%);
  border-radius: $radius-md;
}

.block.priority-high .block-inner {
  background: linear-gradient(90deg, var(--priority-high-bg) 0%, rgba(249, 115, 22, 0.02) 100%);
  border-radius: $radius-md;
}

.block.priority-urgent .block-inner {
  background: linear-gradient(90deg, var(--priority-urgent-bg) 0%, rgba(239, 68, 68, 0.02) 100%);
  border-radius: $radius-md;
}

.block.active.priority-low .block-inner,
.block.active.priority-medium .block-inner,
.block.active.priority-high .block-inner,
.block.active.priority-urgent .block-inner {
  filter: brightness(1.02);
}

// 属性显示区域
.block-properties {
  margin-left: calc(var(--indent-depth, 0) * var(--block-indent-width) + 20px);
  padding-right: $space-2;
}

// 跨 Block 选中遮罩
.block.cb-selected::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--selection-bg);
  pointer-events: none;
  border-radius: $radius-sm;
  z-index: 1;
}
```

- [ ] **步骤 3：修改 Block/index.vue 移除 @import**
修改 `comind/src/components/Block/index.vue` 第 864 行：
```diff
- <style scoped>
- @import './styles.css';
- </style>
+ <style scoped lang="scss">
+ </style>
```

---

## 任务 8：创建组件样式 - Page

**涉及文件**：
- 新建：`comind/src/styles/components/_page.scss`
- 修改：`comind/src/components/Page/index.vue`（移除 @import）
- 删除：`comind/src/components/Page/styles.css`（稍后）

- [ ] **步骤 1：创建 _page.scss**
新建文件 `comind/src/styles/components/_page.scss`：
```scss
// Page 组件样式

.page-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 100%;
  gap: 48px;
  padding-bottom: var(--space-6);
}

.main-content {
  max-width: var(--max-width);
  min-height: calc(100vh * 0.618);
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
  flex: 1;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}

.page-header-content {
  flex: 1;
  min-width: 0;
}

.page-title {
  font-family: var(--font-sans);
  font-size: var(--text-xl);
  font-weight: $font-semibold;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.5px;
  line-height: $leading-tight;
}

.page-title--display {
  cursor: default;
  padding: 2px var(--space-1);
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  transition: border-color 150ms ease, background 150ms ease;
}

.page-title--editable:hover {
  border-color: var(--border);
  background: var(--accent-03);
  cursor: text;
}

.page-title--input {
  background: transparent;
  border: 1px solid var(--accent);
  outline: none;
  padding: 2px var(--space-1);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-focus);
  width: 100%;
  max-width: 600px;
}
```

- [ ] **步骤 2：修改 Page/index.vue 移除 @import**
修改 `comind/src/components/Page/index.vue` 第 139 行：
```diff
- <style scoped>
- @import './styles.css';
- </style>
+ <style scoped lang="scss">
+ </style>
```

---

## 任务 9：创建组件样式 - Sidebar

**涉及文件**：
- 新建：`comind/src/styles/components/_sidebar.scss`

- [ ] **步骤 1：创建 _sidebar.scss**
新建文件 `comind/src/styles/components/_sidebar.scss`：
```scss
// Sidebar 组件样式

.sidebar {
  width: var(--sidebar-width);
  height: 100vh;
  background: var(--color-sidebar-bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  @include custom-scrollbar;
}

.sidebar-section {
  padding: var(--space-2) 0;
}

.sidebar-section-title {
  padding: var(--space-1) var(--space-4);
  font-size: var(--text-xs);
  font-weight: $font-medium;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.sidebar-footer {
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border);
}

// Sidebar 项目
.sidebar-item {
  display: flex;
  align-items: center;
  height: var(--sidebar-item-height);
  padding: 0 var(--sidebar-item-padding);
  margin: 0 var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  @include transition-base;
  @include text-ellipsis;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .sidebar-icon {
    width: var(--sidebar-icon-size);
    height: var(--sidebar-icon-size);
    margin-right: var(--space-2);
    flex-shrink: 0;
  }

  .sidebar-text {
    flex: 1;
    min-width: 0;
    @include text-ellipsis;
  }
}

// 收藏项
.sidebar-favorite {
  .favorite-icon {
    color: var(--warning);
  }
}

// 日记项
.sidebar-journal {
  .journal-date {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin-right: var(--space-2);
  }

  .journal-title {
    @include text-ellipsis;
  }
}

// 最近访问项
.sidebar-recent {
  .recent-icon {
    opacity: 0.7;
  }
}
```

---

## 任务 10：创建组件样式 - Common

**涉及文件**：
- 新建：`comind/src/styles/components/_common.scss`

- [ ] **步骤 1：创建 _common.scss**
新建文件 `comind/src/styles/components/_common.scss`：
```scss
// 通用组件样式

// 应用布局
.app-layout {
  display: flex;
  flex-direction: row;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg-base);
}

.page-scroll-wrapper {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
  position: relative;
  @include custom-scrollbar;
}

// 导航按钮
.nav-controls {
  position: sticky;
  top: $space-3;
  left: $space-3;
  display: flex;
  gap: $space-1;
  z-index: 10;
  width: fit-content;
}

.nav-btn {
  width: 32px;
  height: 32px;
  @include button-base;

  &.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.nav-icon {
  font-size: 14px;
  line-height: 1;
}

// 通用按钮
.btn {
  @include button-base;
}

.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);

  &:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: white;
  }
}

.btn-icon {
  width: 32px;
  height: 32px;
  padding: 0;
}

// 输入框
.input {
  @include input-base;
}

// 对话框
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: $z-modal;
}

.dialog {
  @include card;
  padding: var(--space-6);
  min-width: 320px;
  max-width: 480px;
  box-shadow: var(--shadow-modal);
}

.dialog-title {
  font-size: var(--text-lg);
  font-weight: $font-semibold;
  color: var(--text-primary);
  margin-bottom: var(--space-3);
}

.dialog-message {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-bottom: var(--space-4);
  line-height: $leading-relaxed;
}

.dialog-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

// 菜单
.menu {
  position: fixed;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-elevation-2);
  padding: var(--space-1);
  min-width: 180px;
  z-index: $z-dropdown;
  @include custom-scrollbar;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
  @include transition-base;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--accent-subtle);
    color: var(--accent);
  }
}

.menu-separator {
  height: 1px;
  background: var(--border);
  margin: var(--space-1) 0;
}

// 工具提示
.tooltip {
  position: absolute;
  background: var(--color-ink);
  color: white;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  white-space: nowrap;
  pointer-events: none;
  z-index: $z-toast;
}

// 空状态
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8);
  color: var(--text-tertiary);
  text-align: center;

  .empty-icon {
    width: 48px;
    height: 48px;
    margin-bottom: var(--space-4);
    opacity: 0.5;
  }

  .empty-title {
    font-size: var(--text-lg);
    font-weight: $font-medium;
    margin-bottom: var(--space-2);
  }

  .empty-description {
    font-size: var(--text-sm);
    max-width: 280px;
  }
}

// 加载状态
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-8);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

---

## 任务 11：创建入口文件 main.scss

**涉及文件**：
- 新建：`comind/src/styles/main.scss`

- [ ] **步骤 1：创建 main.scss**
新建文件 `comind/src/styles/main.scss`：
```scss
// comind 主样式入口
// 使用 @use 导入所有模块

// 设计令牌
@use 'tokens/primitives' as *;
@use 'tokens/semantic';
@use 'tokens/components';

// 基础样式
@use 'base/reset';

// Mixins
@use 'mixins';

// 组件样式
@use 'components/block';
@use 'components/page';
@use 'components/sidebar';
@use 'components/common';
```

---

## 任务 12：更新入口文件

**涉及文件**：
- 修改：`comind/src/main.ts`

- [ ] **步骤 1：修改 main.ts 导入主样式**
修改 `comind/src/main.ts`：
```diff
- import './style.css'
+ import './styles/main.scss'
```

---

## 任务 13：清理废弃文件

**涉及文件**：
- 删除：`comind/src/style.css`
- 删除：`comind/src/components/Block/styles.css`
- 删除：`comind/src/components/Page/styles.css`

- [ ] **步骤 1：删除废弃的 CSS 文件**
执行命令：
```bash
rm comind/src/style.css
rm comind/src/components/Block/styles.css
rm comind/src/components/Page/styles.css
```

---

## 任务 14：验证构建

**涉及文件**：
- 验证：`package.json`, `vite.config.ts`

- [ ] **步骤 1：运行构建验证**
执行命令：
```bash
cd comind && npm run build
```
预期结果：构建成功，无错误

- [ ] **步骤 2：运行测试验证**
执行命令：
```bash
cd comind && npm run test
```
预期结果：所有测试通过

---

## 验收检查清单

- [ ] 所有 CSS 变量统一使用 semantic tokens
- [ ] 无重复的颜色值定义
- [ ] 所有组件样式可从 main.scss 导出
- [ ] 项目构建成功（npm run build）
- [ ] 单元测试通过（npm run test）
- [ ] 手动验证核心功能正常
