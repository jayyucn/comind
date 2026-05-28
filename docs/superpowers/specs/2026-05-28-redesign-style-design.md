# comind 风格重新设计规格

## 概述

将 comind 的视觉风格从当前的 Amber + 紧凑精致，重新设计为 **Indigo + 柔和清新** 方向。核心变化：强调色从暖色琥珀切换到冷色薰衣草紫，组件圆角从 4-8px 增大到 6-14px，图标从手工 SVG Sprite 迁移到 Lucide 图标库。

## 设计决策摘要

| 维度 | 当前 | 新方案 |
|------|------|--------|
| 视觉气质 | 紧凑精致 | 柔和清新 |
| 强调色 | Amber #B45309 | Indigo #6366F1 |
| 字体 | 系统字体栈（保持不变） | 系统字体栈 |
| 组件风格 | 4/6/8px 圆角，紧凑间距 | 6/10/14px 圆角，适度间距 |
| 图标 | 手工 SVG Sprite (26个) | Lucide 图标库 |

---

## 1. 色彩体系

### 1.1 强调色 — Indigo 薰衣草系

| Token | 当前值 | 新值 | 用途 |
|-------|--------|------|------|
| `$color-amber-500` | #B45309 | → 删除，替换为 `$color-indigo-500` | 主强调色 |
| `$color-amber-600` | #92400E | → 删除，替换为 `$color-indigo-600` | 悬停态 |
| `$color-amber-100` | #FEF3C7 | → 删除，替换为 `$color-indigo-100` | 浅底色 |
| `$color-amber-200` | #FDE68A | → 删除，替换为 `$color-indigo-200` | 高亮色 |

新增 Indigo 色阶（替换 primitives 中的 Amber 色阶）：

```
$color-indigo-50:  #EEF2FF
$color-indigo-100: #E0E7FF
$color-indigo-200: #C7D2FE
$color-indigo-400: #818CF8
$color-indigo-500: #6366F1
$color-indigo-600: #4F46E5
$color-indigo-700: #4338CA
```

### 1.2 语义层变量变更

| CSS 变量 | 当前值 | 新值 |
|----------|--------|------|
| `--accent` | #B45309 | #6366F1 |
| `--accent-hover` | #92400E | #4F46E5 |
| `--accent-subtle` | #FEF3C7 | #EEF2FF |
| `--accent-bg` | #FEF3C7 | #E0E7FF |
| `--accent-03` | rgba(180,83,9,0.03) | rgba(99,102,241,0.03) |
| `--accent-06` | rgba(180,83,9,0.06) | rgba(99,102,241,0.06) |
| `--accent-08` | rgba(180,83,9,0.08) | rgba(99,102,241,0.08) |
| `--accent-10` | rgba(180,83,9,0.10) | rgba(99,102,241,0.10) |
| `--accent-40` | rgba(180,83,9,0.40) | rgba(99,102,241,0.40) |
| `--link` | #1D4ED8 | #4F46E5 |
| `--link-hover` | #1E40AF | #4338CA |
| `--tag-text` | #047857 | #6366F1 |
| `--tag-bg` | #ECFDF5 | #EEF2FF |
| `--bg-base` | #FAFAF9 | #FAFAFE |
| `--bg-sidebar` | #F5F5F4 | #F3F4F8 |

### 1.3 兼容别名变更

| CSS 变量 | 当前值 | 新值 |
|----------|--------|------|
| `--color-accent` | #B45309 | #6366F1 |
| `--color-accent-deep` | #92400E | #4F46E5 |
| `--color-accent-bg` | #FEF3C7 | #E0E7FF |
| `--color-highlight` | #FDE68A | #C7D2FE |
| `--color-paper` | #FFFBF5 | #FAFAFE |
| `--color-tag` | #6366F1 | 保持不变 |

### 1.4 阴影变更

| Token | 当前值 | 新值 |
|-------|--------|------|
| `$shadow-focus` | 0 0 0 3px rgba(180,83,9,0.10) | 0 0 0 3px rgba(99,102,241,0.12) |
| `$shadow-modal` | 0 8px 32px rgba(28,25,23,0.12) | 0 8px 32px rgba(30,27,57,0.10) |
| `$shadow-elevation-1` | 0 1px 3px rgba(28,25,23,0.08) | 0 1px 3px rgba(30,27,57,0.06) |
| `$shadow-elevation-2` | 0 4px 12px rgba(28,25,23,0.10) | 0 4px 12px rgba(30,27,57,0.08) |

### 1.5 不变项

- 中性色 Stone 色阶保持不变
- 功能色 success/warning/error 保持不变
- 优先级背景色保持不变
- 外部链接色 `--color-external` / `$color-external` 保持不变

---

## 2. 字体

保持当前系统字体栈不变：

```
$font-sans: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
$font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

---

## 3. 组件样式

### 3.1 圆角体系

| Token | 当前值 | 新值 |
|-------|--------|------|
| `$radius-sm` | 4px | 6px |
| `$radius-md` | 6px | 10px |
| `$radius-lg` | 8px | 14px |

### 3.2 组件间距调整

| 组件 | 当前 padding | 新 padding |
|------|-------------|------------|
| 按钮 (`button-base` mixin) | 4px 8px | 6px 14px |
| 输入框 (`input-base` mixin) | 8px | 6px 10px |
| 侧边栏项 | 0 8px | 0 10px |
| 图标按钮 (`.btn-icon`) | 0 (32x32) | 0 (30x30) |

### 3.3 Block 编辑器微调

| 属性 | 当前值 | 新值 |
|------|--------|------|
| `--block-bullet-size` | 5px | 6px |
| `--block-chevron-size` | 7px | 8px |
| `--block-bullet-opacity` | 0.35 | 0.30 |
| `--block-chevron-opacity` | 0.45 | 0.40 |

---

## 4. 图标

### 4.1 方案

从手工 SVG Sprite (`public/icons.svg`) 迁移到 **Lucide** 图标库（Vue 版本 `lucide-vue-next`）。

### 4.2 图标映射

| 当前 SVG Symbol ID | Lucide 图标名 | 用途 |
|---------------------|--------------|------|
| `icon-calendar` | `Calendar` | 日历 |
| `icon-tag` | `Tag` | 标签 |
| `icon-folder` | `Folder` | 文件夹 |
| `icon-link` | `Link` | 链接 |
| `icon-menu` | `Menu` | 菜单 |
| `icon-star` | `Star` | 收藏 |
| `icon-star-filled` | `Star` (CSS fill) | 收藏(填充) |
| `icon-trash` | `Trash2` | 删除 |
| `icon-trash-permanent` | `Trash2` | 永久删除 |
| `icon-restore` | `Undo2` | 恢复 |
| `icon-settings` | `Settings` | 设置 |
| `icon-arrow-right` | `ArrowRight` | 箭头 |
| `status-todo` | `Circle` | 待办 |
| `status-doing` | `Loader` | 进行中 |
| `status-done` | `CheckCircle2` | 已完成 |
| `status-canceled` | `XCircle` | 已取消 |
| `priority-low` | `ArrowDown` | 低优先级 |
| `priority-medium` | `Minus` | 中优先级 |
| `priority-high` | `ArrowUp` | 高优先级 |
| `priority-urgent` | `AlertTriangle` | 紧急 |

### 4.3 社交图标

社交图标（bluesky-icon、discord-icon、github-icon、x-icon、documentation-icon、social-icon）不在 Lucide 中，保留为自定义 SVG 组件。

### 4.4 TaskIcon.vue 重写

将 `TaskIcon.vue` 从 SVG sprite 引用改为 Lucide Vue 组件动态渲染。

---

## 5. 影响范围

### 5.1 需修改的文件

**设计 Token 层：**
- `src/styles/tokens/_primitives.scss` — 替换 Amber 色阶为 Indigo，更新阴影
- `src/styles/tokens/_semantic.scss` — 更新所有 CSS 变量
- `src/styles/tokens/_components.scss` — 更新组件级变量

**Mixin 层：**
- `src/styles/_mixins.scss` — 更新 `button-base`、`input-base`、`card` 的 padding 和 radius

**组件样式层：**
- `src/styles/components/_common.scss` — 更新 `.btn-icon` 尺寸
- `src/styles/components/_block.scss` — 无直接变更（通过 CSS 变量自动生效）
- `src/styles/components/_sidebar.scss` — 无直接变更（通过 CSS 变量自动生效）
- `src/styles/components/_page.scss` — 无直接变更

**基础样式层：**
- `src/styles/base/_reset.scss` — 更新 `::selection` 背景色（通过 CSS 变量自动生效）

**图标层：**
- `src/components/Icons/TaskIcon.vue` — 重写为 Lucide 组件
- `src/components/Icons/index.ts` — 更新导出
- `public/icons.svg` — 删除或保留仅社交图标

**依赖：**
- `package.json` — 新增 `lucide-vue-next` 依赖

### 5.2 不需要修改的文件

- Vue 组件模板中引用 CSS 变量的部分（通过变量自动生效）
- Block 编辑器组件（通过 `--block-*` 变量自动生效）
- 间距系统（保持 4px 基准网格不变）
- 过渡动画系统
- Z-index 层级
- 布局常量（max-width、sidebar-width）

---

## 6. 验收标准

1. 所有 Amber 色阶引用已替换为 Indigo 色阶
2. 所有组件圆角符合新的 radius 体系（6/10/14px）
3. Lucide 图标库已安装，所有图标正确渲染
4. `npm run build` 编译通过
5. 视觉效果与设计预览一致
