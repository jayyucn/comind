# comind 风格重新设计 实施方案

> **面向智能体执行者：必须使用子技能**：通过 subagent‑driven‑development（推荐）或 executing‑plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。

**目标**：将 comind 视觉风格从 Amber + 紧凑精致 切换为 Indigo + 柔和清新

**架构**：修改 SCSS 设计 Token 三层体系（primitives → semantic → components）替换色阶和圆角，更新 mixin 中的间距，安装 Lucide 图标库替换手工 SVG Sprite

**技术栈**：SCSS、Vue 3、lucide-vue-next

---

### 任务1：安装 Lucide 依赖

**涉及文件：**
- 修改：`comind/package.json`

- [ ] **步骤1：安装 lucide-vue-next**
执行命令：
```bash
cd comind && npm install lucide-vue-next
```
预期结果：`package.json` 中新增 `lucide-vue-next` 依赖，`package-lock.json` 更新

- [ ] **步骤2：验证安装**
执行命令：
```bash
cd comind && node -e "require('lucide-vue-next'); console.log('OK')"
```
预期结果：输出 `OK`

- [ ] **步骤3：提交代码**
```bash
cd comind && git add package.json package-lock.json && git commit -m "chore: add lucide-vue-next dependency"
```

---

### 任务2：替换 primitives 色阶和阴影

**涉及文件：**
- 修改：`comind/src/styles/tokens/_primitives.scss`

- [ ] **步骤1：替换 Amber 色阶为 Indigo 色阶**

将文件中第4-12行的 Amber 色阶注释和变量：
```scss
// 颜色 - Amber（强调色系）
$color-amber-50: #FFFBEB;
$color-amber-100: #FEF3C7;
$color-amber-200: #FDE68A;
$color-amber-300: #FCD34D;
$color-amber-400: #FBBF24;
$color-amber-500: #B45309;
$color-amber-600: #92400E;
$color-amber-700: #78350F;
```

替换为：
```scss
// 颜色 - Indigo（强调色系）
$color-indigo-50: #EEF2FF;
$color-indigo-100: #E0E7FF;
$color-indigo-200: #C7D2FE;
$color-indigo-400: #818CF8;
$color-indigo-500: #6366F1;
$color-indigo-600: #4F46E5;
$color-indigo-700: #4338CA;
```

- [ ] **步骤2：更新透明度变体**

将文件中第37-44行的透明度变体：
```scss
$accent-03: rgba(180, 83, 9, 0.03);
$accent-06: rgba(180, 83, 9, 0.06);
$accent-08: rgba(180, 83, 9, 0.08);
$accent-10: rgba(180, 83, 9, 0.10);
$accent-40: rgba(180, 83, 9, 0.40);
```

替换为：
```scss
$accent-03: rgba(99, 102, 241, 0.03);
$accent-06: rgba(99, 102, 241, 0.06);
$accent-08: rgba(99, 102, 241, 0.08);
$accent-10: rgba(99, 102, 241, 0.10);
$accent-40: rgba(99, 102, 241, 0.40);
```

- [ ] **步骤3：更新功能色**

将文件中第27行的链接色：
```scss
$color-link: #1D4ED8;
$color-link-hover: #1E40AF;
```

替换为：
```scss
$color-link: #4F46E5;
$color-link-hover: #4338CA;
```

将文件中第29行的标签色：
```scss
$color-tag-text: #047857;
$color-tag-bg: #ECFDF5;
```

替换为：
```scss
$color-tag-text: #6366F1;
$color-tag-bg: #EEF2FF;
```

- [ ] **步骤4：更新圆角**

将文件中第59-61行：
```scss
$radius-sm: 4px;
$radius-md: 6px;
$radius-lg: 8px;
```

替换为：
```scss
$radius-sm: 6px;
$radius-md: 10px;
$radius-lg: 14px;
```

- [ ] **步骤5：更新阴影**

将文件中第83-86行：
```scss
$shadow-focus: 0 0 0 3px rgba(180, 83, 9, 0.10);
$shadow-modal: 0 8px 32px rgba(28, 25, 23, 0.12);
$shadow-elevation-1: 0 1px 3px rgba(28, 25, 23, 0.08);
$shadow-elevation-2: 0 4px 12px rgba(28, 25, 23, 0.10);
```

替换为：
```scss
$shadow-focus: 0 0 0 3px rgba(99, 102, 241, 0.12);
$shadow-modal: 0 8px 32px rgba(30, 27, 57, 0.10);
$shadow-elevation-1: 0 1px 3px rgba(30, 27, 57, 0.06);
$shadow-elevation-2: 0 4px 12px rgba(30, 27, 57, 0.08);
```

- [ ] **步骤6：验证编译**
执行命令：
```bash
cd comind && npm run build
```
预期结果：编译通过（此步骤仅修改 SCSS 变量名，semantic 层尚未更新，可能报变量未定义错误——这是预期的，任务3会修复）

- [ ] **步骤7：提交代码**
```bash
cd comind && git add src/styles/tokens/_primitives.scss && git commit -m "style: replace amber with indigo color scale in primitives"
```

---

### 任务3：更新 semantic 层 CSS 变量

**涉及文件：**
- 修改：`comind/src/styles/tokens/_semantic.scss`

- [ ] **步骤1：更新强调色变量**

将 `:root` 中所有 `$color-amber-*` 引用替换为 `$color-indigo-*`：

```scss
  --accent: #{$color-indigo-500};
  --accent-hover: #{$color-indigo-600};
  --accent-subtle: #{$color-indigo-50};
  --accent-bg: #{$color-indigo-100};
```

- [ ] **步骤2：更新背景色变量**

```scss
  --bg-base: #FAFAFE;
  --bg-sidebar: #F3F4F8;
```

- [ ] **步骤3：更新兼容别名**

```scss
  --color-paper: #FAFAFE;
  --color-accent: #{$color-indigo-500};
  --color-accent-deep: #{$color-indigo-600};
  --color-accent-bg: #{$color-indigo-100};
  --color-highlight: #{$color-indigo-200};
```

- [ ] **步骤4：验证编译**
执行命令：
```bash
cd comind && npm run build
```
预期结果：编译通过

- [ ] **步骤5：提交代码**
```bash
cd comind && git add src/styles/tokens/_semantic.scss && git commit -m "style: update semantic CSS variables to indigo palette"
```

---

### 任务4：更新 components 层变量

**涉及文件：**
- 修改：`comind/src/styles/tokens/_components.scss`

- [ ] **步骤1：更新 Block 编辑器变量**

```scss
  --block-bullet-size: 6px;
  --block-chevron-size: 8px;
  --block-bullet-opacity: 0.30;
  --block-chevron-opacity: 0.40;
```

- [ ] **步骤2：更新侧边栏变量**

```scss
  --sidebar-item-padding: #{$space-2};
```
（保持不变，确认无需修改）

- [ ] **步骤3：验证编译**
执行命令：
```bash
cd comind && npm run build
```
预期结果：编译通过

- [ ] **步骤4：提交代码**
```bash
cd comind && git add src/styles/tokens/_components.scss && git commit -m "style: update block editor and component token values"
```

---

### 任务5：更新 mixin 中的间距和圆角

**涉及文件：**
- 修改：`comind/src/styles/_mixins.scss`

- [ ] **步骤1：更新 button-base mixin 的 padding**

将 `button-base` mixin 中：
```scss
  padding: var(--space-1) var(--space-2);
```

替换为：
```scss
  padding: var(--space-1) #{$space-3};
```

（`var(--space-1)` = 4px 垂直，`$space-3` = 12px 水平，接近 6px 14px 效果；使用 `$space-3` 而非硬编码保持与间距系统一致）

- [ ] **步骤2：更新 input-base mixin 的 padding**

将 `input-base` mixin 中：
```scss
  padding: var(--space-2);
```

替换为：
```scss
  padding: var(--space-1) #{$space-2};
```

- [ ] **步骤3：更新 card mixin 的 radius**

将 `card` mixin 中：
```scss
  border-radius: var(--radius-md);
```

保持不变（radius-md 已从 6px 变为 10px，自动生效）

- [ ] **步骤4：验证编译**
执行命令：
```bash
cd comind && npm run build
```
预期结果：编译通过

- [ ] **步骤5：提交代码**
```bash
cd comind && git add src/styles/_mixins.scss && git commit -m "style: update button and input padding in mixins"
```

---

### 任务6：更新组件样式中的硬编码值

**涉及文件：**
- 修改：`comind/src/styles/components/_common.scss`

- [ ] **步骤1：更新 .btn-icon 尺寸**

将：
```scss
.btn-icon {
  width: 32px;
  height: 32px;
  padding: 0;
}
```

替换为：
```scss
.btn-icon {
  width: 30px;
  height: 30px;
  padding: 0;
}
```

- [ ] **步骤2：更新 .nav-btn 尺寸**

将：
```scss
.nav-btn {
  width: 32px;
  height: 32px;
```

替换为：
```scss
.nav-btn {
  width: 30px;
  height: 30px;
```

- [ ] **步骤3：验证编译**
执行命令：
```bash
cd comind && npm run build
```
预期结果：编译通过

- [ ] **步骤4：提交代码**
```bash
cd comind && git add src/styles/components/_common.scss && git commit -m "style: update icon button and nav button sizes"
```

---

### 任务7：重写 TaskIcon.vue 使用 Lucide

**涉及文件：**
- 修改：`comind/src/components/Icons/TaskIcon.vue`
- 修改：`comind/src/components/Icons/index.ts`

- [ ] **步骤1：重写 TaskIcon.vue**

将整个文件内容替换为：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import {
  Circle,
  Loader,
  CheckCircle2,
  XCircle,
  ArrowDown,
  Minus,
  ArrowUp,
  AlertTriangle,
  Calendar,
  Tag,
  Folder,
  Link,
  Menu,
  Star,
  Trash2,
  Undo2,
  Settings,
  ArrowRight,
} from 'lucide-vue-next'

const STATUS_ICONS: Record<string, any> = {
  'status-todo': Circle,
  'status-doing': Loader,
  'status-done': CheckCircle2,
  'status-canceled': XCircle,
}

const PRIORITY_ICONS: Record<string, any> = {
  'priority-low': ArrowDown,
  'priority-medium': Minus,
  'priority-high': ArrowUp,
  'priority-urgent': AlertTriangle,
}

const GENERAL_ICONS: Record<string, any> = {
  'icon-calendar': Calendar,
  'icon-tag': Tag,
  'icon-folder': Folder,
  'icon-link': Link,
  'icon-menu': Menu,
  'icon-star': Star,
  'icon-star-filled': Star,
  'icon-trash': Trash2,
  'icon-trash-permanent': Trash2,
  'icon-restore': Undo2,
  'icon-settings': Settings,
  'icon-arrow-right': ArrowRight,
}

const ALL_ICONS = { ...STATUS_ICONS, ...PRIORITY_ICONS, ...GENERAL_ICONS }

const props = defineProps<{
  name: string
  size?: number
  color?: string
}>()

const iconComponent = computed(() => ALL_ICONS[props.name])

const isFilled = computed(() => props.name === 'icon-star-filled')
</script>

<template>
  <component
    :is="iconComponent"
    v-if="iconComponent"
    :size="size || 16"
    :color="color"
    :style="isFilled ? { fill: color || 'currentColor' } : {}"
  />
</template>
```

- [ ] **步骤2：更新 index.ts**

将文件内容替换为：

```ts
export { default as TaskIcon } from './TaskIcon.vue'

export const TASK_STATUS_ICONS = {
  Todo: 'status-todo',
  Doing: 'status-doing',
  Done: 'status-done',
  Canceled: 'status-canceled',
}

export const TASK_PRIORITY_ICONS = {
  Low: 'priority-low',
  Medium: 'priority-medium',
  High: 'priority-high',
  Urgent: 'priority-urgent',
}

export const GENERAL_ICONS = {
  calendar: 'icon-calendar',
  tag: 'icon-tag',
  folder: 'icon-folder',
  link: 'icon-link',
}
```

（导出接口保持不变，消费方无需修改）

- [ ] **步骤3：验证编译**
执行命令：
```bash
cd comind && npm run build
```
预期结果：编译通过

- [ ] **步骤4：提交代码**
```bash
cd comind && git add src/components/Icons/ && git commit -m "feat: rewrite TaskIcon to use lucide-vue-next"
```

---

### 任务8：替换 Vue 组件中的 SVG sprite 引用

**涉及文件：**
- 修改：`comind/src/components/PageMenuButton.vue`
- 修改：`comind/src/components/Trash/TrashList.vue`

- [ ] **步骤1：更新 PageMenuButton.vue**

在 `<script setup>` 中添加 import：
```ts
import { TaskIcon } from './Icons'
```

将模板中所有 `<svg><use href="/icons.svg#..." /></svg>` 替换为 `<TaskIcon>` 组件：

- `/icons.svg#icon-menu` → `<TaskIcon name="icon-menu" :size="16" />`
- `/icons.svg#icon-star` → `<TaskIcon name="icon-star" :size="16" />`
- `/icons.svg#icon-star-filled` → `<TaskIcon name="icon-star-filled" :size="16" />`
- `/icons.svg#icon-trash` → `<TaskIcon name="icon-trash" :size="16" />`
- `/icons.svg#icon-trash-permanent` → `<TaskIcon name="icon-trash-permanent" :size="16" />`
- `/icons.svg#icon-arrow-right` → `<TaskIcon name="icon-arrow-right" :size="16" />`
- `/icons.svg#icon-settings` → `<TaskIcon name="icon-settings" :size="16" />`

每个替换的具体模式：
```html
<!-- 旧 -->
<svg ...><use href="/icons.svg#icon-menu" /></svg>

<!-- 新 -->
<TaskIcon name="icon-menu" :size="16" />
```

- [ ] **步骤2：更新 TrashList.vue**

在 `<script setup>` 中添加 import：
```ts
import { TaskIcon } from '../Icons'
```

将模板中所有 `<svg><use href="/icons.svg#..." /></svg>` 替换为 `<TaskIcon>` 组件：

- `/icons.svg#icon-restore` → `<TaskIcon name="icon-restore" :size="16" />`
- `/icons.svg#icon-trash-permanent` → `<TaskIcon name="icon-trash-permanent" :size="16" />`
- `/icons.svg#icon-trash` → `<TaskIcon name="icon-trash" :size="16" />`

- [ ] **步骤3：验证编译**
执行命令：
```bash
cd comind && npm run build
```
预期结果：编译通过

- [ ] **步骤4：提交代码**
```bash
cd comind && git add src/components/PageMenuButton.vue src/components/Trash/TrashList.vue && git commit -m "feat: replace SVG sprite refs with Lucide TaskIcon components"
```

---

### 任务9：清理旧 SVG sprite 文件

**涉及文件：**
- 删除：`comind/public/icons.svg`

- [ ] **步骤1：确认无残留引用**
执行命令：
```bash
cd comind && grep -r "icons.svg" src/ --include="*.vue" --include="*.ts"
```
预期结果：无输出（所有引用已替换）

- [ ] **步骤2：删除 icons.svg**
```bash
cd comind && rm public/icons.svg
```

- [ ] **步骤3：验证编译**
执行命令：
```bash
cd comind && npm run build
```
预期结果：编译通过

- [ ] **步骤4：提交代码**
```bash
cd comind && git add -A && git commit -m "chore: remove legacy icons.svg sprite file"
```

---

### 任务10：最终验证

**涉及文件：**
- 无新增修改

- [ ] **步骤1：执行完整编译**
执行命令：
```bash
cd comind && npm run build
```
预期结果：编译通过，无错误

- [ ] **步骤2：检查无残留 Amber 引用**
执行命令：
```bash
cd comind && grep -r "amber" src/ --include="*.scss" --include="*.vue" --include="*.ts"
```
预期结果：无输出

- [ ] **步骤3：检查无残留 icons.svg 引用**
执行命令：
```bash
cd comind && grep -r "icons.svg" src/ --include="*.scss" --include="*.vue" --include="*.ts"
```
预期结果：无输出

- [ ] **步骤4：检查圆角值正确**
执行命令：
```bash
cd comind && grep -n "radius-sm\|radius-md\|radius-lg" src/styles/tokens/_primitives.scss
```
预期结果：
```
$radius-sm: 6px;
$radius-md: 10px;
$radius-lg: 14px;
```

- [ ] **步骤5：提交最终状态**
```bash
cd comind && git add -A && git status
```
预期结果：工作区干净，无未提交变更
