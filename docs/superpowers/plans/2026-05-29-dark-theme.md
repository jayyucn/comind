# 暗色主题 实施方案
> **面向智能体执行者：必须使用子技能**：通过 subagent-driven-development（推荐）或 executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
**目标**：为 comind 添加暗色主题支持，用户可在浅色/暗色/跟随系统三种模式间切换
**架构**：在 `<html>` 元素上设置 `data-theme` 属性，通过 CSS 变量覆盖实现暗色主题；新增 `useTheme` composable 管理主题状态；SettingsModal 中添加三选一选择器；CodeMirror 根据 resolved 主题切换编辑器主题
**技术栈**：Vue 3 + SCSS + CSS 变量 + @codemirror/theme-one-dark
---

### 任务1：useTheme composable
**涉及文件：**
- 新建：`comind/src/composables/useTheme.ts`
- 测试：`comind/src/composables/useTheme.test.ts`

- [ ] **步骤1：编写失败测试用例**
```ts
// comind/src/composables/useTheme.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to system theme when no stored preference', () => {
    const { theme } = useTheme()
    expect(theme.value).toBe('system')
  })

  it('loads stored theme from localStorage', () => {
    localStorage.setItem('comind-theme', 'dark')
    const { theme } = useTheme()
    expect(theme.value).toBe('dark')
  })

  it('setTheme updates theme and localStorage', () => {
    const { theme, setTheme } = useTheme()
    setTheme('dark')
    expect(theme.value).toBe('dark')
    expect(localStorage.getItem('comind-theme')).toBe('dark')
  })

  it('setTheme applies data-theme attribute to document', () => {
    const { setTheme } = useTheme()
    setTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('setTheme with light applies data-theme="light"', () => {
    const { setTheme } = useTheme()
    setTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('setTheme with system resolves based on prefers-color-scheme', () => {
    const { setTheme } = useTheme()
    setTheme('system')
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    expect(document.documentElement.getAttribute('data-theme')).toBe(isDark ? 'dark' : 'light')
  })

  it('resolvedTheme reflects the actual applied theme', () => {
    const { resolvedTheme, setTheme } = useTheme()
    setTheme('dark')
    expect(resolvedTheme.value).toBe('dark')
    setTheme('light')
    expect(resolvedTheme.value).toBe('light')
  })
})
```

- [ ] **步骤2：运行测试，验证执行失败**
执行命令：`npx vitest run src/composables/useTheme.test.ts`
预期结果：执行失败，提示 `useTheme is not defined`

- [ ] **步骤3：编写实现代码**
```ts
// comind/src/composables/useTheme.ts
import { ref, computed } from 'vue'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'comind-theme'

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

const theme = ref<Theme>(loadTheme())
const resolvedTheme = ref<'light' | 'dark'>(resolve(theme.value))

applyTheme(theme.value)

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme.value === 'system') applyTheme('system')
})

export function useTheme() {
  function setTheme(t: Theme) {
    theme.value = t
    localStorage.setItem(STORAGE_KEY, t)
    applyTheme(t)
  }

  return {
    theme: computed(() => theme.value),
    resolvedTheme: computed(() => resolvedTheme.value),
    setTheme,
  }
}
```

- [ ] **步骤4：运行测试，验证执行通过**
执行命令：`npx vitest run src/composables/useTheme.test.ts`
预期结果：执行通过

- [ ] **步骤5：提交代码**
```bash
cd comind && git add src/composables/useTheme.ts src/composables/useTheme.test.ts && git commit -m "feat: add useTheme composable for dark theme support"
```

---

### 任务2：暗色语义化令牌
**涉及文件：**
- 修改：`comind/src/styles/tokens/_semantic.scss:1-104`

- [ ] **步骤1：在 `_semantic.scss` 末尾追加暗色覆盖块**

在文件第 104 行（`:root` 闭合花括号 `}` 之后）追加以下内容：

```scss
// 暗色主题覆盖
[data-theme="dark"] {
  // 背景层级
  --bg-base: #1A1A1E;
  --bg-sidebar: #222225;
  --bg-hover: #2E2E32;
  --bg-active: #3A3A3F;

  // 文字层级
  --text-primary: #E4E4E7;
  --text-secondary: #A1A1AA;
  --text-tertiary: #71717A;
  --text-disabled: #52525B;

  // 侧边栏文字层级
  --sidebar-text-primary: #D4D4D8;
  --sidebar-text-secondary: #A1A1AA;
  --sidebar-text-hint: #8B8B8E;

  // 边框层级
  --border: #2E2E32;
  --border-light: #3A3A3F;
  --border-strong: #4A4A50;

  // 强调色
  --accent: #818CF8;
  --accent-hover: #6366F1;
  --accent-subtle: rgba(129, 140, 248, 0.08);
  --accent-bg: rgba(129, 140, 248, 0.15);

  // 透明度变体
  --accent-03: rgba(129, 140, 248, 0.03);
  --accent-06: rgba(129, 140, 248, 0.06);
  --accent-08: rgba(129, 140, 248, 0.08);
  --accent-10: rgba(129, 140, 248, 0.10);
  --accent-40: rgba(129, 140, 248, 0.40);
  --tag-10: rgba(129, 140, 248, 0.10);
  --tag-40: rgba(129, 140, 248, 0.40);
  --ext-40: rgba(148, 163, 184, 0.40);
  --overlay: rgba(0, 0, 0, 0.50);

  // 阴影
  --shadow-focus: 0 0 0 3px rgba(129, 140, 248, 0.15);
  --shadow-modal: 0 8px 32px rgba(0, 0, 0, 0.30);
  --shadow-elevation-1: 0 1px 3px rgba(0, 0, 0, 0.20);
  --shadow-elevation-2: 0 4px 12px rgba(0, 0, 0, 0.25);

  // 兼容别名
  --color-paper: #1A1A1E;
  --color-ink: #E4E4E7;
  --color-ink-secondary: #A1A1AA;
  --color-ink-muted: #A1A1AA;
  --color-ink-faint: #71717A;
  --color-accent: #818CF8;
  --color-accent-deep: #6366F1;
  --color-accent-bg: rgba(129, 140, 248, 0.15);
  --color-border: #2E2E32;
  --color-border-light: #3A3A3F;
  --color-border-strong: #4A4A50;
  --color-hover: #2E2E32;
  --color-surface: #2E2E32;
  --color-sidebar-bg: #222225;
  --color-highlight: rgba(129, 140, 248, 0.25);
  --color-white: #1A1A1E;
  --color-tag: #818CF8;
  --color-external: #94A3B8;
  --color-scrollbar: #4A4A50;
}
```

- [ ] **步骤2：运行构建，验证编译通过**
执行命令：`cd comind && npm run build`
预期结果：构建成功，无错误

- [ ] **步骤3：提交代码**
```bash
cd comind && git add src/styles/tokens/_semantic.scss && git commit -m "feat: add dark theme semantic token overrides"
```

---

### 任务3：暗色组件令牌
**涉及文件：**
- 修改：`comind/src/styles/tokens/_components.scss:1-45`

- [ ] **步骤1：在 `_components.scss` 末尾追加暗色覆盖块**

在文件第 45 行（`:root` 闭合花括号 `}` 之后）追加以下内容：

```scss
// 暗色主题组件令牌覆盖
[data-theme="dark"] {
  // 链接与标签
  --link: #818CF8;
  --link-hover: #6366F1;
  --tag-text: #818CF8;
  --tag-bg: rgba(129, 140, 248, 0.10);

  // 状态色
  --success: #34D399;
  --warning: #FBBF24;
  --error: #F87171;
  --info: #818CF8;

  // 优先级背景色
  --priority-low-bg: rgba(148, 163, 184, 0.10);
  --priority-medium-bg: rgba(251, 191, 36, 0.12);
  --priority-high-bg: rgba(251, 146, 60, 0.14);
  --priority-urgent-bg: rgba(248, 113, 113, 0.16);

  // 选中状态
  --selection-bg: rgba(129, 140, 248, 0.15);
}
```

- [ ] **步骤2：运行构建，验证编译通过**
执行命令：`cd comind && npm run build`
预期结果：构建成功，无错误

- [ ] **步骤3：提交代码**
```bash
cd comind && git add src/styles/tokens/_components.scss && git commit -m "feat: add dark theme component token overrides"
```

---

### 任务4：FOUC 防护脚本
**涉及文件：**
- 修改：`comind/index.html:1-12`

- [ ] **步骤1：在 `<head>` 中添加内联脚本**

将 `comind/index.html` 修改为：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>comind</title>
    <script>
      (function(){
        var t = localStorage.getItem('comind-theme');
        var d = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme:dark)').matches);
        document.documentElement.setAttribute('data-theme', d ? 'dark' : 'light');
      })();
    </script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **步骤2：运行构建，验证编译通过**
执行命令：`cd comind && npm run build`
预期结果：构建成功，无错误

- [ ] **步骤3：提交代码**
```bash
cd comind && git add index.html && git commit -m "feat: add FOUC prevention script for dark theme"
```

---

### 任务5：SettingsModal 主题选择器
**涉及文件：**
- 修改：`comind/src/components/Settings/SettingsModal.vue:1-331`

- [ ] **步骤1：修改 script 部分，引入 useTheme**

将 `<script setup lang="ts">` 部分修改为：

```ts
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useSettingsModal } from '../../composables/useSettingsModal'
import { useModalKeyboard } from '../../composables/useModalKeyboard'
import { useTheme } from '../../composables/useTheme'
import { X, Sun, Moon, Monitor } from 'lucide-vue-next'

const { isOpen, close } = useSettingsModal()
useModalKeyboard('settings-modal')

const { theme, setTheme } = useTheme()

type Section = 'appearance' | 'editor' | 'data' | 'about'

const activeSection = ref<Section>('appearance')

const sections: { key: Section; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'editor', label: '编辑器' },
  { key: 'data', label: '数据管理' },
  { key: 'about', label: '关于' },
]

const themeOptions: { value: 'light' | 'dark' | 'system'; label: string; icon: any }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '暗色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

function handleOverlayClick() {
  close()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>
```

- [ ] **步骤2：修改 template 中的外观部分**

将 template 中 `activeSection === 'appearance'` 的部分替换为：

```html
<template v-if="activeSection === 'appearance'">
  <div class="setting-item">
    <div class="setting-info">
      <span class="setting-label">主题</span>
      <span class="setting-desc">选择应用主题</span>
    </div>
    <div class="theme-selector">
      <button
        v-for="option in themeOptions"
        :key="option.value"
        class="theme-option"
        :class="{ active: theme === option.value }"
        @click="setTheme(option.value)"
      >
        <component :is="option.icon" :size="14" :stroke-width="1.75" />
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
```

- [ ] **步骤3：在 `<style scoped>` 中追加主题选择器样式**

在 `.setting-btn:not(:disabled):hover` 规则之后、`.settings-modal-enter-active` 规则之前，追加：

```css
.theme-selector {
  display: flex;
  gap: 4px;
  background: var(--bg-hover);
  border-radius: 6px;
  padding: 2px;
}

.theme-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
  font-family: inherit;
  transition: background 80ms ease, color 80ms ease;
}

.theme-option:hover {
  color: var(--text-secondary);
}

.theme-option.active {
  background: var(--bg-base);
  color: var(--text-primary);
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
```

- [ ] **步骤4：运行构建，验证编译通过**
执行命令：`cd comind && npm run build`
预期结果：构建成功，无错误

- [ ] **步骤5：提交代码**
```bash
cd comind && git add src/components/Settings/SettingsModal.vue && git commit -m "feat: add theme selector to settings modal"
```

---

### 任务6：CodeMirror 暗色主题
**涉及文件：**
- 修改：`comind/src/components/Block/handlers/code/CodeMirrorEditor.vue:1-557`

- [ ] **步骤1：在 import 区域添加 oneDark 和 useTheme**

在文件第 2 行的 import 语句之后、第 15 行 `import { tags } from '@lezer/highlight'` 之后，添加：

```ts
import { oneDark } from '@codemirror/theme-one-dark'
import { useTheme } from '../../../composables/useTheme'
```

- [ ] **步骤2：在 props/emit 定义之后添加 useTheme 调用**

在第 46 行 `const showCopied = ref(false)` 之后，添加：

```ts
const { resolvedTheme } = useTheme()
```

- [ ] **步骤3：修改 createEditor 函数中的 extensions 数组**

将 `createEditor` 函数中第 220-221 行：

```ts
    githubTheme,
    syntaxHighlighting(githubHighlightStyle),
```

替换为：

```ts
    resolvedTheme.value === 'dark' ? oneDark : githubTheme,
    resolvedTheme.value === 'dark' ? syntaxHighlighting(oneDark.highlighting) : syntaxHighlighting(githubHighlightStyle),
```

- [ ] **步骤4：添加 watch resolvedTheme 变化时重建编辑器**

在现有的 `watch(() => props.readonly, ...)` 之后（约第 292 行），添加：

```ts
watch(resolvedTheme, () => {
  createEditor()
  nextTick(() => {
    view.value?.focus()
  })
})
```

- [ ] **步骤5：修改 scoped style 中的硬编码颜色为 CSS 变量**

将 `<style scoped>` 中的硬编码颜色替换为 CSS 变量引用：

将 `.code-editor-wrapper` 的样式替换为：
```css
.code-editor-wrapper {
  position: relative;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
```

将 `.code-lang-button` 的样式替换为：
```css
.code-lang-button {
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.2s;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
}
```

将 `.code-copy-button` 的样式替换为：
```css
.code-copy-button {
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 6px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
}
```

将 `.code-lang-button:hover, .code-copy-button:hover` 替换为：
```css
.code-lang-button:hover, .code-copy-button:hover {
  background-color: var(--bg-active);
  border-color: var(--border-strong);
}
```

将 `.lang-menu` 的样式替换为：
```css
.lang-menu {
  position: fixed;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-top: 4px;
  min-width: 140px;
  box-shadow: var(--shadow-elevation-2);
  z-index: 1000;
  overflow: hidden;
}
```

将 `.lang-item` 的样式替换为：
```css
.lang-item {
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.2s;
}
```

将 `.lang-item:hover` 替换为：
```css
.lang-item:hover {
  background: var(--bg-hover);
}
```

将 `.lang-item.active` 替换为：
```css
.lang-item.active {
  background: var(--accent-subtle);
  font-weight: 500;
  color: var(--accent);
  border-left: 2px solid var(--accent);
  padding-left: 10px;
}
```

- [ ] **步骤6：运行构建，验证编译通过**
执行命令：`cd comind && npm run build`
预期结果：构建成功，无错误

- [ ] **步骤7：提交代码**
```bash
cd comind && git add src/components/Block/handlers/code/CodeMirrorEditor.vue && git commit -m "feat: add dark theme support to CodeMirror editor"
```

---

### 任务7：全量验证
**涉及文件：** 无新增修改

- [ ] **步骤1：运行完整构建**
执行命令：`cd comind && npm run build`
预期结果：构建成功，无 TypeScript 错误、无 SCSS 编译错误

- [ ] **步骤2：运行全部单元测试**
执行命令：`cd comind && npm run test`
预期结果：所有测试通过

- [ ] **步骤3：运行 lint 检查**
执行命令：`cd comind && npm run lint`
预期结果：无 lint 错误

- [ ] **步骤4：启动开发服务器进行手动验证**
执行命令：`cd comind && npm run dev`
预期结果：
1. 打开设置 → 外观 → 主题选择器可见
2. 选择"暗色"→ 界面即时切换为暗色
3. 选择"浅色"→ 界面即时切换回浅色
4. 选择"跟随系统"→ 根据操作系统设置自动选择
5. 刷新页面后主题偏好保留
6. CodeMirror 代码块在暗色模式下使用 One Dark 主题
7. 页面加载无 FOUC
