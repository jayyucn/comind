# comind 纯净极简主义样式重新设计

**日期**: 2026-05-27\
**范围**: 字体、颜色、样式、图标（**不涉及布局调整**）\
**状态**: 设计阶段

***

## 1. 概述

本次设计重新定义 comind 的视觉风格，采用**纯净极简主义**设计语言。重点更新字体系统、颜色系统和组件样式，保持现有的左侧边栏 + 右侧内容区的布局不变。

### 设计目标

- **纯净感**：大量留白，让内容成为焦点
- **专业性**：中性灰色调，稳重而不单调
- **层次感**：通过灰度差异建立清晰的视觉层级
- **一致性**：统一的间距、圆角、阴影系统
- **可读性**：优化的行高和字号，适合长时间阅读

***

## 2. 字体系统

### 主字体

```css
--font-sans: 'SF Pro', 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

**说明**：优先使用系统字体，提供最佳的系统集成体验和性能。

### 代码字体

```css
--font-mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
```

### 字号系统

基于 15px 基准：

| 名称            | 字号               | 用途       |
| ------------- | ---------------- | -------- |
| `--text-xs`   | 12px (0.75rem)   | 标签、次要信息  |
| `--text-sm`   | 13px (0.8125rem) | 辅助文字、侧边栏 |
| `--text-base` | 15px (0.9375rem) | 主内容区基准   |
| `--text-lg`   | 18px (1.125rem)  | 标题 H2    |
| `--text-xl`   | 24px (1.5rem)    | 页面标题 H1  |

### 字重

| 名称       | 字重  | 用途        |
| -------- | --- | --------- |
| Regular  | 400 | 正文        |
| Medium   | 500 | 按钮、次要标题   |
| Semibold | 600 | 主要标题、重要内容 |

***

## 3. 颜色系统

### 背景层级

```css
--bg-base: #FFFFFF;        /* 主内容区背景 - 纯白 */
--bg-sidebar: #F7F7F7;     /* 侧边栏背景 - 极淡灰 */
--bg-hover: #F0F0F0;       /* Hover 态背景 */
--bg-active: #E8E8E8;      /* Active / 已选中背景 */
```

### 文字层级

```css
--text-primary: #666666;   /* 主文字 - 中性灰 */
--text-secondary: #999999; /* 次要文字 - 浅灰 */
--text-tertiary: #CCCCCC;  /* 最低层级 - 极浅灰 */
--text-title: #333333;     /* 标题文字 - 深灰 */
```

### 边框层级

```css
--border: #E5E5E5;         /* 主分割线 - 柔和灰 */
--border-strong: #D0D0D0;   /* 强分割 - 略深灰 */
```

### 强调色

```css
--accent: #2563EB;         /* 主强调色 - 纯净蓝 */
--accent-hover: #1D4ED8;    /* 强调色 hover */
--accent-subtle: #EFF6FF;   /* 强调色浅底 */
```

### 功能色

```css
--link: #2563EB;           /* 链接蓝 */
--tag-text: #059669;       /* 标签文字 - 绿色 */
--tag-bg: #ECFDF5;         /* 标签背景 - 薄荷绿 */
--success: #10B981;        /* 成功 */
--warning: #F59E0B;        /* 警告 */
--error: #EF4444;          /* 错误 */
```

### 兼容性别名

保留现有的别名系统以兼容所有组件：

```css
--color-paper: #FFFFFF;
--color-ink: #333333;
--color-ink-secondary: #666666;
--color-ink-muted: #999999;
--color-ink-faint: #CCCCCC;
--color-accent: #2563EB;
--color-accent-deep: #1D4ED8;
--color-accent-bg: #EFF6FF;
--color-border: #E5E5E5;
--color-border-light: #E5E5E5;
--color-border-strong: #D0D0D0;
--color-hover: #F0F0F0;
--color-surface: #F0F0F0;
--color-sidebar-bg: #F7F7F7;
--color-highlight: #DBEAFE;
--color-white: #FFFFFF;
--color-tag: #059669;
--color-external: #64748B;
--color-scrollbar: #D0D0D0;
```

***

## 4. 组件样式

### 4.1 按钮

**默认按钮**：

- 背景：`transparent`
- Hover：`#F0F0F0`
- Active：`#E8E8E8`
- 文字颜色：`#666666`
- 圆角：4px
- 内边距：8px 12px

**主要按钮**：

- 背景：`#2563EB`
- 文字：`#FFFFFF`
- Hover：`#1D4ED8`

**图标按钮**：

- 尺寸：32px × 32px
- 居中对齐

### 4.2 输入框

```css
.input {
  background: #FFFFFF;
  border: 1px solid #E5E5E5;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 15px;
  color: #666666;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.input:focus {
  outline: none;
  border-color: #2563EB;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.input::placeholder {
  color: #CCCCCC;
}
```

### 4.3 卡片

```css
.card {
  background: #FFFFFF;
  border: 1px solid #E5E5E5;
  border-radius: 6px;
  padding: 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
```

### 4.4 菜单

```css
.menu {
  background: #FFFFFF;
  border: 1px solid #E5E5E5;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  padding: 4px;
  min-width: 180px;
}

.menu-item {
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
  color: #666666;
  transition: background 100ms ease;
}

.menu-item:hover {
  background: #F0F0F0;
}
```

### 4.5 标签

```css
.tag {
  display: inline-block;
  padding: 2px 8px;
  background: #ECFDF5;
  color: #059669;
  font-size: 12px;
  font-weight: 500;
  border-radius: 4px;
}
```

***

## 5. 阴影系统

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-md: 0 2px 8px rgba(0, 0, 0, 0.06);
--shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.08);
--shadow-focus: 0 0 0 3px rgba(37, 99, 235, 0.1);
```

***

## 6. 间距系统

保持现有的 4px 基准网格系统不变：

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-6: 24px;
--space-8: 32px;
--space-12: 48px;
```

***

## 7. 圆角系统

```css
--radius-sm: 4px;   /* 按钮、输入框 */
--radius-md: 6px;   /* 卡片、菜单 */
--radius-lg: 8px;   /* 模态框 */
```

***

## 8. 图标风格

图标风格保持现有设计不变，不做调整。

***

## 9. 不涉及的范围

以下内容**不在本次修改范围内**：

- ❌ 侧边栏宽度（保持 240px）
- ❌ 主内容区最大宽度（保持 720px）
- ❌ 布局结构（保持左侧边栏 + 右侧内容）
- ❌ 导航按钮位置（保持左上角）
- ❌ 响应式布局断点

***

## 10. 实施清单

### 10.1 全局样式 (style.css)

- [ ] 更新 CSS 变量定义
- [ ] 更新字体变量
- [ ] 更新字号变量
- [ ] 更新阴影变量
- [ ] 更新透明度变体

### 10.2 组件样式

- [ ] 更新按钮样式
- [ ] 更新输入框样式
- [ ] 更新卡片样式
- [ ] 更新菜单样式
- [ ] 更新标签样式

### 10.3 Sidebar 组件

- [ ] 更新侧边栏背景色
- [ ] 更新文字颜色
- [ ] 更新边框颜色
- [ ] 更新 hover/active 状态

### 10.4 Page 组件

- [ ] 更新页面标题样式
- [ ] 更新区块间距
- [ ] 更新边框样式

### 10.5 App.vue

- [ ] 更新主布局背景色
- [ ] 更新导航按钮样式
- [ ] 更新页面容器样式

***

## 11. 验证清单

- [ ] 运行 `npm run build` 确保编译通过
- [ ] 检查所有组件样式一致性
- [ ] 测试 hover/active/focus 状态
- [ ] 验证文字对比度和可读性
- [ ] 检查在不同页面下的显示效果

