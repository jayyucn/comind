# CSS 系统重构设计方案

**日期**: 2026-05-27
**状态**: 已审核

## 1. 背景与目标

当前项目的 CSS 系统存在以下问题：
- CSS 变量命名不一致（`--bg-base` vs `--color-paper` 双套别名）
- 设计令牌与组件样式混合
- 样式复用性不高
- 缺乏明确的样式分类体系

**改造目标**：
1. 建立统一的设计令牌（Design Tokens）体系
2. 实现 CSS 变量 + SCSS 混合架构
3. 将组件样式从 `.vue` 文件中提取集中管理
4. 为未来主题切换（暗色模式）做准备

## 2. 技术选型

| 技术 | 用途 |
|------|------|
| CSS 变量 | 设计令牌（颜色、间距、字体等） |
| SCSS | 选择器嵌套、mixin、样式复用 |

**职责划分**：
- CSS 变量：只负责**设计令牌**（Primitive / Semantic / Component 三层）
- SCSS：负责**所有样式逻辑**（选择器、嵌套、mixin），不使用 SCSS 变量

## 3. 目标架构

```
src/styles/
├── tokens/
│   ├── _primitives.scss    # 原始值（颜色、间距等具体数值）
│   ├── _semantic.scss      # 语义化令牌（CSS 变量，引用原始值）
│   └── _components.scss    # 组件级令牌（block、sidebar 等）
├── base/
│   └── _reset.scss         # CSS 重置 + 基础元素样式
├── components/
│   ├── _block.scss         # Block 相关样式
│   ├── _page.scss          # Page 相关样式
│   ├── _sidebar.scss       # Sidebar 相关样式
│   └── _common.scss        # 通用组件（按钮、对话框等）
├── _mixins.scss            # SCSS mixin（响应式、动画等）
└── main.scss               # 统一入口，导出所有样式
```

## 4. 设计令牌三层结构

### 4.1 Primitive Tokens（原始值）

```scss
// tokens/_primitives.scss
// 颜色
$color-amber-50: #FFFBEB;
$color-amber-100: #FEF3C7;
$color-amber-200: #FDE68A;
$color-amber-500: #B45309;
$color-amber-600: #92400E;

$color-stone-50: #FAFAF9;
$color-stone-100: #F5F5F4;
$color-stone-200: #E7E5E4;
$color-stone-300: #D6D3D1;
$color-stone-400: #C9C8C3;
$color-stone-500: #A8A29E;
$color-stone-600: #78716C;
$color-stone-900: #1C1917;

// 间距
$space-1: 4px;
$space-2: 8px;
$space-3: 12px;
$space-4: 16px;
$space-6: 24px;
$space-8: 32px;

// 圆角
$radius-sm: 4px;
$radius-md: 6px;
$radius-lg: 8px;

// 字号
$text-xs: 0.75rem;
$text-sm: 0.875rem;
$text-base: 0.9375rem;
$text-xl: 1.25rem;
```

### 4.2 Semantic Tokens（语义化令牌）

```scss
// tokens/_semantic.scss
:root {
  // 背景层级
  --bg-base: var(--color-stone-50);
  --bg-sidebar: var(--color-stone-100);
  --bg-hover: var(--color-stone-200);
  --bg-active: var(--color-stone-300);

  // 文字层级
  --text-primary: var(--color-stone-900);
  --text-secondary: var(--color-stone-600);
  --text-tertiary: var(--color-stone-500);

  // 边框层级
  --border: var(--color-stone-200);
  --border-strong: var(--color-stone-400);

  // 强调色
  --accent: var(--color-amber-500);
  --accent-hover: var(--color-amber-600);
  --accent-subtle: var(--color-amber-100);

  // 间距
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  // 圆角
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  // 字号
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 0.9375rem;
  --text-xl: 1.25rem;
}
```

### 4.3 Component Tokens（组件级令牌）

```scss
// tokens/_components.scss
:root {
  // Block 组件
  --block-bullet-color: var(--accent);
  --block-bullet-opacity: 0.35;
  --block-bullet-size: 5px;
  --block-chevron-size: 7px;

  // Sidebar 组件
  --sidebar-width: 260px;
  --sidebar-bg: var(--bg-sidebar);

  // 链接
  --link-color: #1D4ED8;
  --link-hover: #1E40AF;

  // 标签
  --tag-text: #047857;
  --tag-bg: #ECFDF5;

  // 状态色
  --success: #059669;
  --warning: #D97706;
  --error: #DC2626;
}
```

## 5. SCSS Mixin 设计

```scss
// _mixins.scss

// 响应式断点
@mixin tablet {
  @media (min-width: 768px) { @content; }
}

@mixin desktop {
  @media (min-width: 1024px) { @content; }
}

// Focus Ring
@mixin focus-ring {
  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 3px;
  }
}

// 过渡动画
@mixin transition-base {
  transition: all 150ms ease;
}

// 滚动条
@mixin custom-scrollbar {
  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--border-strong);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--text-tertiary);
  }
}
```

## 6. 迁移计划

### 阶段一：建立基础设施
1. 安装 `sass` 依赖
2. 创建 `src/styles/` 目录结构
3. 创建 `tokens/_primitives.scss`
4. 创建 `tokens/_semantic.scss`
5. 创建 `tokens/_components.scss`

### 阶段二：创建基础样式
1. 创建 `base/_reset.scss`
2. 创建 `_mixins.scss`
3. 创建 `main.scss` 入口文件

### 阶段三：迁移组件样式
1. 创建 `components/_block.scss`
2. 创建 `components/_page.scss`
3. 创建 `components/_sidebar.scss`
4. 创建 `components/_common.scss`

### 阶段四：更新入口
1. 修改 `main.ts` 导入 `main.scss`
2. 更新 Vue 组件，移除原有的 `<style>` 或 `@import`
3. 清理废弃的 `.css` 文件

## 7. 验收标准

- [ ] 所有 CSS 变量统一使用 semantic tokens
- [ ] 无重复的颜色值定义
- [ ] 所有组件样式可从 `main.scss` 导出
- [ ] 项目构建成功（`npm run build`）
- [ ] 单元测试通过
- [ ] 手动验证核心功能正常
