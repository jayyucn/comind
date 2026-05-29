# 暗色主题设计方案

**日期**: 2026-05-29
**状态**: 已审核

## 1. 背景与目标

当前 comind 仅支持浅色主题。CSS 系统重构已完成三层设计令牌体系（Primitives → Semantic → Components），所有组件已广泛使用 CSS 变量，为暗色主题的实现奠定了基础。SettingsModal 中已有"主题"占位项。

**目标**：添加暗色主题支持，用户可在浅色/暗色/跟随系统三种模式间切换。

## 2. 需求确认

- 三选一模式：浅色 / 暗色 / 跟随系统
- 即时切换，无过渡动画
- CodeMirror 代码编辑器同步切换暗色主题
- 主题偏好存储在 localStorage
- 防止页面加载时 FOUC（闪白）

## 3. 技术方案：`[data-theme]` 属性 + CSS 变量覆盖

在 `<html>` 元素上设置 `data-theme` 属性，在 `_semantic.scss` 和 `_components.scss` 中新增 `[data-theme="dark"]` 选择器覆盖 CSS 变量。

**切换机制**：
- `data-theme="light"` → 浅色
- `data-theme="dark"` → 暗色
- 用户选择"跟随系统"时，监听 `matchMedia('(prefers-color-scheme: dark)')` 的 `change` 事件，自动同步 `data-theme` 属性

**选择理由**：
- 与现有三层令牌架构完美契合——只需在语义化层加一组暗色覆盖值
- 零 JS 运行时开销，纯 CSS 变量切换
- 浏览器原生支持 `prefers-color-scheme` 媒体查询
- 不需要额外的 JS 运行时库

## 4. 暗色令牌值

### 4.1 背景层级（层级反转）

| 令牌 | 浅色 | 暗色 |
|------|------|------|
| `--bg-base` | `#FAFAFE` | `#1A1A1E` |
| `--bg-sidebar` | `#F3F4F8` | `#222225` |
| `--bg-hover` | `#E7E5E4` | `#2E2E32` |
| `--bg-active` | `#D6D3D1` | `#3A3A3F` |

### 4.2 文字层级

| 令牌 | 浅色 | 暗色 |
|------|------|------|
| `--text-primary` | `#1C1917` | `#E4E4E7` |
| `--text-secondary` | `#78716C` | `#A1A1AA` |
| `--text-tertiary` | `#A8A29E` | `#71717A` |
| `--text-disabled` | `#C9C8C3` | `#52525B` |

### 4.3 侧边栏文字层级

| 令牌 | 浅色 | 暗色 |
|------|------|------|
| `--sidebar-text-primary` | `#44403C` | `#D4D4D8` |
| `--sidebar-text-secondary` | `#78716C` | `#A1A1AA` |
| `--sidebar-text-hint` | `#524F4B` | `#8B8B8E` |

### 4.4 强调色（提亮一档）

| 令牌 | 浅色 | 暗色 |
|------|------|------|
| `--accent` | `#6366F1` (Indigo-500) | `#818CF8` (Indigo-400) |
| `--accent-hover` | `#4F46E5` (Indigo-600) | `#6366F1` (Indigo-500) |
| `--accent-subtle` | `#EEF2FF` | `rgba(129,140,248,0.08)` |
| `--accent-bg` | `#E0E7FF` | `rgba(129,140,248,0.15)` |

### 4.5 透明度变体

| 令牌 | 浅色 | 暗色 |
|------|------|------|
| `--accent-03` | `rgba(99,102,241,0.03)` | `rgba(129,140,248,0.03)` |
| `--accent-06` | `rgba(99,102,241,0.06)` | `rgba(129,140,248,0.06)` |
| `--accent-08` | `rgba(99,102,241,0.08)` | `rgba(129,140,248,0.08)` |
| `--accent-10` | `rgba(99,102,241,0.10)` | `rgba(129,140,248,0.10)` |
| `--accent-40` | `rgba(99,102,241,0.40)` | `rgba(129,140,248,0.40)` |
| `--tag-10` | `rgba(99,102,241,0.10)` | `rgba(129,140,248,0.10)` |
| `--tag-40` | `rgba(99,102,241,0.40)` | `rgba(129,140,248,0.40)` |
| `--ext-40` | `rgba(100,116,139,0.40)` | `rgba(148,163,184,0.40)` |
| `--overlay` | `rgba(28,25,23,0.30)` | `rgba(0,0,0,0.50)` |

### 4.6 边框

| 令牌 | 浅色 | 暗色 |
|------|------|------|
| `--border` | `#E7E5E4` | `#2E2E32` |
| `--border-light` | `#D6D3D1` | `#3A3A3F` |
| `--border-strong` | `#C9C8C3` | `#4A4A50` |

### 4.7 阴影（暗色下更深）

| 令牌 | 浅色 | 暗色 |
|------|------|------|
| `--shadow-focus` | `0 0 0 3px rgba(99,102,241,0.12)` | `0 0 0 3px rgba(129,140,248,0.15)` |
| `--shadow-modal` | `0 8px 32px rgba(30,27,57,0.10)` | `0 8px 32px rgba(0,0,0,0.30)` |
| `--shadow-elevation-1` | `0 1px 3px rgba(30,27,57,0.06)` | `0 1px 3px rgba(0,0,0,0.20)` |
| `--shadow-elevation-2` | `0 4px 12px rgba(30,27,57,0.08)` | `0 4px 12px rgba(0,0,0,0.25)` |

### 4.8 兼容别名

| 令牌 | 浅色 | 暗色 |
|------|------|------|
| `--color-paper` | `#FAFAFE` | `#1A1A1E` |
| `--color-ink` | `#1C1917` | `#E4E4E7` |
| `--color-ink-secondary` | `#78716C` | `#A1A1AA` |
| `--color-ink-muted` | `#78716C` | `#A1A1AA` |
| `--color-ink-faint` | `#A8A29E` | `#71717A` |
| `--color-accent` | `#6366F1` | `#818CF8` |
| `--color-accent-deep` | `#4F46E5` | `#6366F1` |
| `--color-accent-bg` | `#E0E7FF` | `rgba(129,140,248,0.15)` |
| `--color-border` | `#E7E5E4` | `#2E2E32` |
| `--color-border-light` | `#D6D3D1` | `#3A3A3F` |
| `--color-border-strong` | `#C9C8C3` | `#4A4A50` |
| `--color-hover` | `#E7E5E4` | `#2E2E32` |
| `--color-surface` | `#E7E5E4` | `#2E2E32` |
| `--color-sidebar-bg` | `#F3F4F8` | `#222225` |
| `--color-highlight` | `#C7D2FE` | `rgba(129,140,248,0.25)` |
| `--color-white` | `#FFFFFF` | `#1A1A1E` |
| `--color-tag` | `#6366F1` | `#818CF8` |
| `--color-external` | `#64748B` | `#94A3B8` |
| `--color-scrollbar` | `#C9C8C3` | `#4A4A50` |

### 4.9 组件令牌

| 令牌 | 浅色 | 暗色 |
|------|------|------|
| `--link` | `#4F46E5` | `#818CF8` |
| `--link-hover` | `#4338CA` | `#6366F1` |
| `--tag-text` | `#6366F1` | `#818CF8` |
| `--tag-bg` | `#EEF2FF` | `rgba(129,140,248,0.10)` |
| `--success` | `#059669` | `#34D399` |
| `--warning` | `#D97706` | `#FBBF24` |
| `--error` | `#DC2626` | `#F87171` |
| `--selection-bg` | `rgba(66,133,244,0.15)` | `rgba(129,140,248,0.15)` |
| `--priority-low-bg` | `rgba(148,163,184,0.12)` | `rgba(148,163,184,0.10)` |
| `--priority-medium-bg` | `rgba(234,179,8,0.14)` | `rgba(251,191,36,0.12)` |
| `--priority-high-bg` | `rgba(249,115,22,0.16)` | `rgba(251,146,60,0.14)` |
| `--priority-urgent-bg` | `rgba(239,68,68,0.18)` | `rgba(248,113,113,0.16)` |

## 5. 状态管理

新增 `src/composables/useTheme.ts`，采用模块级单例模式：

```ts
type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'comind-theme'

const theme = ref<Theme>(loadTheme())
const resolvedTheme = ref<'light' | 'dark'>(resolve(theme.value))

function loadTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function resolve(t: Theme): 'light' | 'dark' {
  if (t !== 'system') return t
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(t: Theme) {
  const resolved = resolve(t)
  document.documentElement.setAttribute('data-theme', resolved)
  resolvedTheme.value = resolved
}

function setTheme(t: Theme) {
  theme.value = t
  localStorage.setItem(STORAGE_KEY, t)
  applyTheme(t)
}

// 初始化
applyTheme(theme.value)

// 监听系统偏好变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme.value === 'system') applyTheme('system')
})

export function useTheme() {
  return { theme, resolvedTheme, setTheme }
}
```

## 6. 设置 UI

在 SettingsModal 的"外观"分类中，将现有的占位项替换为三选一选择器：

```
主题
┌─────────────────────────────────────────────┐
│  ○ 浅色    ○ 暗色    ● 跟随系统              │
└─────────────────────────────────────────────┘
```

使用 `useTheme()` composable 读写当前主题，选择后即时生效。移除"即将推出"标注。

## 7. CodeMirror 暗色主题

在 `CodeMirrorEditor.vue` 中：
- 引入 `@codemirror/theme-one-dark`（已在 package.json 依赖中）
- 根据 `resolvedTheme` 的值切换 `githubTheme`（浅色）和 `oneDark`（暗色）
- 通过 `useTheme()` 获取当前 resolved 主题
- watch `resolvedTheme` 变化时重建编辑器扩展列表

## 8. FOUC 防护

在 `index.html` 的 `<head>` 中添加内联脚本，在 DOM 渲染前读取 localStorage 并设置 `data-theme`：

```html
<script>
  (function(){
    var t = localStorage.getItem('comind-theme');
    var d = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme:dark)').matches);
    document.documentElement.setAttribute('data-theme', d ? 'dark' : 'light');
  })();
</script>
```

此脚本必须放在 `<head>` 中、所有 CSS 之前，确保首次渲染时即应用正确的主题。

## 9. 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/styles/tokens/_semantic.scss` | 修改 | 新增 `[data-theme="dark"]` 覆盖块 |
| `src/styles/tokens/_components.scss` | 修改 | 新增暗色组件令牌覆盖 |
| `src/composables/useTheme.ts` | 新增 | 主题状态管理 composable |
| `src/components/Settings/SettingsModal.vue` | 修改 | 外观分类添加主题三选一选择器 |
| `src/components/Block/handlers/code/CodeMirrorEditor.vue` | 修改 | 支持暗色主题切换 |
| `index.html` | 修改 | 添加 FOUC 防护内联脚本 |

## 10. 验收标准

- [ ] 浅色/暗色/跟随系统三种模式可正常切换
- [ ] 切换即时生效，无闪烁
- [ ] 页面刷新后主题偏好保留
- [ ] 跟随系统模式下，切换操作系统主题后自动同步
- [ ] 所有组件在暗色主题下视觉正确（背景、文字、边框、强调色）
- [ ] CodeMirror 代码编辑器在暗色主题下使用 One Dark 主题
- [ ] 页面加载无 FOUC
- [ ] 项目构建成功（`npm run build`）
- [ ] 单元测试通过
