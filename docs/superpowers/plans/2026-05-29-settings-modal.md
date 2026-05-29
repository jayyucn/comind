# 设置模态窗口实施方案

> **面向智能体执行者：必须使用子技能**：通过 subagent-driven-development（推荐）或 executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。

**目标**：将设置界面从独立路由页面改为模态窗口，采用左侧导航+右侧内容双栏布局。

**架构**：新建 `useSettingsModal` composable 管理模态开关状态（模块级单例，与 `useSidebar` 模式一致），新建 `SettingsModal.vue` 组件实现模态 UI（复用现有 `ConfirmDialog`/`MergeDialog` 的遮罩层+Teleport 模式，集成 `useModalKeyboard` 管理模态栈），修改两个入口点（PageMenuButton + SidebarFooter）调用 `open()`，移除 `/settings` 路由。

**技术栈**：Vue 3 + TypeScript + lucide-vue-next

---

### 任务1：创建 useSettingsModal composable

**涉及文件：**
- 新建：`src/composables/useSettingsModal.ts`
- 参考：`src/composables/useSidebar.ts`（模块级单例模式）

- [ ] **步骤1：创建 composable 文件**

```ts
import { ref, computed } from 'vue'

const isOpen = ref(false)

export function useSettingsModal() {
  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  return {
    isOpen: computed(() => isOpen.value),
    open,
    close,
  }
}
```

- [ ] **步骤2：提交代码**

```bash
git add src/composables/useSettingsModal.ts
git commit -m "feat: add useSettingsModal composable"
```

---

### 任务2：创建 SettingsModal 组件

**涉及文件：**
- 新建：`src/components/Settings/SettingsModal.vue`
- 参考：`src/components/ConfirmDialog.vue`（遮罩层+Teleport 模式）
- 参考：`src/components/MergeDialog.vue`（遮罩层+Teleport 模式）
- 参考：`src/components/Settings/Settings.vue`（设置项内容和样式）
- 参考：`src/composables/useModalKeyboard.ts`（模态栈管理）

- [ ] **步骤1：创建 SettingsModal.vue**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useSettingsModal } from '../../composables/useSettingsModal'
import { useModalKeyboard } from '../../composables/useModalKeyboard'
import { X } from 'lucide-vue-next'

const { isOpen, close } = useSettingsModal()
useModalKeyboard('settings-modal')

type Section = 'appearance' | 'editor' | 'data' | 'about'

const activeSection = ref<Section>('appearance')

const sections: { key: Section; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'editor', label: '编辑器' },
  { key: 'data', label: '数据管理' },
  { key: 'about', label: '关于' },
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

<template>
  <Teleport to="body">
    <Transition name="settings-modal">
      <div v-if="isOpen" class="settings-modal-overlay" @click.self="handleOverlayClick">
        <div class="settings-modal">
          <div class="settings-modal-nav">
            <div class="nav-title">设置</div>
            <button
              v-for="section in sections"
              :key="section.key"
              class="nav-item"
              :class="{ active: activeSection === section.key }"
              @click="activeSection = section.key"
            >
              {{ section.label }}
            </button>
          </div>

          <div class="settings-modal-content">
            <div class="content-header">
              <h2 class="content-title">{{ sections.find(s => s.key === activeSection)?.label }}</h2>
              <button class="close-btn" @click="close">
                <X :size="16" :stroke-width="1.75" />
              </button>
            </div>

            <div class="content-body">
              <template v-if="activeSection === 'appearance'">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">主题</span>
                    <span class="setting-desc">选择应用主题（即将推出）</span>
                  </div>
                  <span class="setting-value">浅色</span>
                </div>
              </template>

              <template v-if="activeSection === 'editor'">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">字体大小</span>
                    <span class="setting-desc">调整编辑器字体大小（即将推出）</span>
                  </div>
                  <span class="setting-value">默认</span>
                </div>
              </template>

              <template v-if="activeSection === 'data'">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">导出数据</span>
                    <span class="setting-desc">将所有页面和块导出为 JSON（即将推出）</span>
                  </div>
                  <button class="setting-btn" disabled>导出</button>
                </div>
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">导入数据</span>
                    <span class="setting-desc">从 JSON 文件导入数据（即将推出）</span>
                  </div>
                  <button class="setting-btn" disabled>导入</button>
                </div>
              </template>

              <template v-if="activeSection === 'about'">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">版本</span>
                    <span class="setting-desc">comind v0.1.0</span>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.settings-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.settings-modal {
  width: 720px;
  max-height: 70vh;
  min-height: 480px;
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: var(--shadow-modal);
  display: flex;
  overflow: hidden;
}

.settings-modal-nav {
  width: 180px;
  flex-shrink: 0;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 12px;
  padding: 0 10px;
}

.nav-item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  font-family: inherit;
  text-align: left;
  transition: background 80ms ease, color 80ms ease;
}

.nav-item:hover {
  background: var(--bg-hover);
}

.nav-item.active {
  background: var(--bg-active);
  font-weight: 500;
  color: var(--text-primary);
}

.settings-modal-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.content-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--text-tertiary);
  transition: background 80ms ease, color 80ms ease;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.content-body {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.setting-desc {
  font-size: 11px;
  color: var(--text-tertiary);
}

.setting-value {
  font-size: 13px;
  color: var(--text-secondary);
}

.setting-btn {
  padding: 6px 16px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: not-allowed;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: inherit;
}

.setting-btn:not(:disabled) {
  cursor: pointer;
  color: var(--text-secondary);
}

.setting-btn:not(:disabled):hover {
  background: var(--bg-active);
}

.settings-modal-enter-active,
.settings-modal-leave-active {
  transition: opacity 180ms ease;
}

.settings-modal-enter-active .settings-modal,
.settings-modal-leave-active .settings-modal {
  transition: transform 180ms ease;
}

.settings-modal-enter-from,
.settings-modal-leave-to {
  opacity: 0;
}

.settings-modal-enter-from .settings-modal {
  transform: translateY(8px);
}

@media (max-width: 768px) {
  .settings-modal {
    width: 95vw;
    flex-direction: column;
  }

  .settings-modal-nav {
    width: 100%;
    flex-direction: row;
    border-right: none;
    border-bottom: 1px solid var(--border);
    padding: 12px;
    overflow-x: auto;
  }

  .nav-title {
    display: none;
  }
}
</style>
```

- [ ] **步骤2：提交代码**

```bash
git add src/components/Settings/SettingsModal.vue
git commit -m "feat: add SettingsModal component"
```

---

### 任务3：在 App.vue 中引入 SettingsModal

**涉及文件：**
- 修改：`src/App.vue`

- [ ] **步骤1：在 App.vue 中添加 SettingsModal 导入和使用**

在 `<script setup>` 中添加导入：

```ts
import SettingsModal from './components/Settings/SettingsModal.vue'
```

在 `<template>` 中，在 `ConfirmDialog` 之后添加：

```html
<SettingsModal />
```

- [ ] **步骤2：提交代码**

```bash
git add src/App.vue
git commit -m "feat: integrate SettingsModal into App.vue"
```

---

### 任务4：在 SidebarFooter 中新增设置按钮

**涉及文件：**
- 修改：`src/components/Sidebar/SidebarFooter.vue`

- [ ] **步骤1：修改 SidebarFooter.vue，添加设置按钮**

完整替换为：

```vue
<script setup lang="ts">
import { Settings } from 'lucide-vue-next'
import { useSettingsModal } from '../../composables/useSettingsModal'

const { open } = useSettingsModal()
</script>

<template>
  <div class="sidebar-footer">
    <button class="settings-btn" title="设置" @click="open">
      <Settings :size="15" :stroke-width="1.75" />
    </button>
    <div class="shortcut-hint">
      <kbd>Ctrl</kbd>+<kbd>K</kbd>
      <span class="hint-text">命令与搜索</span>
    </div>
  </div>
</template>

<style scoped>
.sidebar-footer {
  padding: var(--space-3);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.settings-btn {
  width: 100%;
  height: 30px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  transition: background 80ms ease, color 80ms ease;
  margin-bottom: var(--space-2);
}

.settings-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.shortcut-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

kbd {
  display: inline-block;
  padding: 2px 4px;
  font-size: 10px;
  font-family: inherit;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 3px;
  box-shadow: 0 1px 0 var(--border);
}

.hint-text {
  margin-left: 6px;
  font-weight: 400;
}
</style>
```

- [ ] **步骤2：提交代码**

```bash
git add src/components/Sidebar/SidebarFooter.vue
git commit -m "feat: add settings button to SidebarFooter"
```

---

### 任务5：修改 PageMenuButton 使用 open() 替代路由跳转

**涉及文件：**
- 修改：`src/components/PageMenuButton.vue`

- [ ] **步骤1：修改 PageMenuButton.vue**

在 `<script setup>` 中：
1. 添加导入：

```ts
import { useSettingsModal } from '../composables/useSettingsModal'
```

2. 添加 composable 调用（在 `const { isFavorite, toggleFavorite } = useFavorites()` 之后）：

```ts
const { open: openSettings } = useSettingsModal()
```

3. 替换 `handleNavigateToSettings` 函数体：

```ts
function handleNavigateToSettings() {
  closeMenu()
  openSettings()
}
```

4. 移除 `useRouter` 中不再需要的路由导航（`router.push('/settings')` 已被替换）。检查 `useRouter` 是否仍被其他地方使用（`handleNavigateToTrash` 仍使用 `router.push('/trash')`），因此保留 `useRouter` 导入。

- [ ] **步骤2：提交代码**

```bash
git add src/components/PageMenuButton.vue
git commit -m "feat: change PageMenuButton settings to open modal"
```

---

### 任务6：移除 /settings 路由并更新路由守卫

**涉及文件：**
- 修改：`src/router/routes.ts`
- 修改：`src/router/index.ts`

- [ ] **步骤1：从 routes.ts 中移除 /settings 路由**

删除以下代码块（第31-34行）：

```ts
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../components/Settings/Settings.vue'),
  },
```

- [ ] **步骤2：从 index.ts 路由守卫中移除 settings 引用**

将第11行：

```ts
  if (to.name === 'journal-list' || to.name === 'trash' || to.name === 'settings') {
```

改为：

```ts
  if (to.name === 'journal-list' || to.name === 'trash') {
```

- [ ] **步骤3：提交代码**

```bash
git add src/router/routes.ts src/router/index.ts
git commit -m "feat: remove /settings route and update router guard"
```

---

### 任务7：更新路由测试

**涉及文件：**
- 修改：`src/router/index.test.ts`
- 修改：`src/router/router-guards.test.ts`

- [ ] **步骤1：更新 index.test.ts**

将所有出现的：

```ts
to.name === 'journal-list' || to.name === 'trash' || to.name === 'settings'
```

替换为：

```ts
to.name === 'journal-list' || to.name === 'trash'
```

删除 "settings 路由应被跳过" 测试用例（第90-94行）。

- [ ] **步骤2：更新 router-guards.test.ts**

将所有出现的：

```ts
toName === 'journal-list' || toName === 'trash' || toName === 'settings'
```

和

```ts
routeName === 'journal-list' || routeName === 'trash' || routeName === 'settings'
```

替换为对应的移除 settings 的版本。

删除 "settings 路由应被跳过" 测试用例。

- [ ] **步骤3：运行测试验证**

执行命令：`npm run test`
预期结果：所有测试通过

- [ ] **步骤4：提交代码**

```bash
git add src/router/index.test.ts src/router/router-guards.test.ts
git commit -m "test: update router tests to remove settings route"
```

---

### 任务8：删除旧 Settings.vue

**涉及文件：**
- 删除：`src/components/Settings/Settings.vue`

- [ ] **步骤1：删除文件**

```bash
git rm src/components/Settings/Settings.vue
```

- [ ] **步骤2：提交代码**

```bash
git commit -m "chore: remove old Settings.vue route page"
```

---

### 任务9：编译验证

**涉及文件：**
- 无新增修改

- [ ] **步骤1：运行 TypeScript 类型检查**

执行命令：`npx vue-tsc -b`
预期结果：无类型错误

- [ ] **步骤2：运行 Vite 构建**

执行命令：`npx vite build`
预期结果：构建成功

- [ ] **步骤3：运行全部测试**

执行命令：`npm run test`
预期结果：所有测试通过

- [ ] **步骤4：运行开发服务器进行功能验证**

执行命令：`npm run dev`
验证项：
1. 右上角菜单 → 点击"设置" → 模态窗口弹出
2. 侧边栏底部 → 点击设置图标 → 模态窗口弹出
3. 左侧导航切换分类 → 右侧内容切换
4. 点击遮罩层 → 模态关闭
5. 按 Esc 键 → 模态关闭
6. 点击关闭按钮 → 模态关闭
7. URL 直接访问 /settings → 应被重定向到 /journal
