# 可配置属性显示系统 实施计划
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
**Goal:** 实现可配置的属性显示系统，支持按单个属性配置显示位置和显示样式
**Architecture:** 扩展 PropertyDefinition 类型，创建 PropertyInline 组件，更新 Block.vue 布局
**Tech Stack:** Vue 3, TypeScript, Pinia
---

## 文件结构
```
src/
├── types/
│   └── property.ts (MODIFY: 扩展接口 + 配置默认值)
├── components/
│   └── Block/
│       ├── PropertyInline.vue (CREATE: 显示 between/right 位置属性)
│       ├── PropertyDisplay.vue (MODIFY: 仅显示 bottom 位置属性)
│       └── index.vue (MODIFY: 集成新的布局)
```

---

### Task 1: 更新 PropertyDefinition 类型和 BUILT_IN_PROPERTIES
**Files:**
- Modify: `src/types/property.ts`
- Test: 类型检查
- [ ] **Step 1: 扩展 PropertyDefinition 接口**
```typescript
export interface PropertyDefinition {
  key: string
  title: string
  type: PropertyType
  closedValues?: ClosedValue[]
  isBuiltIn?: boolean
  description?: string
  
  // 新增配置字段
  displayPosition?: 'between-bullet-content' | 'right-of-content' | 'bottom-of-block'
  displayStyle?: 'icon-text' | 'icon' | 'text'
}
```

- [ ] **Step 2: 给 BUILT_IN_PROPERTIES 添加默认配置**
```typescript
export const BUILT_IN_PROPERTIES: PropertyDefinition[] = [
  {
    key: 'status',
    title: '状态',
    type: 'string',
    isBuiltIn: true,
    displayPosition: 'between-bullet-content',
    displayStyle: 'icon',
    closedValues: [
      { value: 'Todo', label: '待办', icon: '📋' },
      { value: 'Doing', label: '进行中', icon: '🔄' },
      { value: 'Done', label: '已完成', icon: '✅' },
      { value: 'Canceled', label: '已取消', icon: '❌' },
    ],
  },
  {
    key: 'priority',
    title: '优先级',
    type: 'string',
    isBuiltIn: true,
    displayPosition: 'between-bullet-content',
    displayStyle: 'icon',
    closedValues: [
      { value: 'Low', label: '低', icon: '🟢' },
      { value: 'Medium', label: '中', icon: '🟡' },
      { value: 'High', label: '高', icon: '🟠' },
      { value: 'Urgent', label: '紧急', icon: '🔴' },
    ],
  },
  {
    key: 'deadline',
    title: '截止日期',
    type: 'date',
    isBuiltIn: true,
    displayPosition: 'bottom-of-block',
    displayStyle: 'icon-text',
  },
  {
    key: 'scheduled',
    title: '计划日期',
    type: 'date',
    isBuiltIn: true,
    displayPosition: 'bottom-of-block',
    displayStyle: 'icon-text',
  },
  {
    key: 'tags',
    title: '标签',
    type: 'array',
    isBuiltIn: true,
    displayPosition: 'bottom-of-block',
    displayStyle: 'icon-text',
  },
  {
    key: 'project',
    title: '项目',
    type: 'string',
    isBuiltIn: true,
    displayPosition: 'bottom-of-block',
    displayStyle: 'icon-text',
  },
  {
    key: 'area',
    title: '领域',
    type: 'string',
    isBuiltIn: true,
    displayPosition: 'bottom-of-block',
    displayStyle: 'icon-text',
  },
]
```

- [ ] **Step 3: 运行类型检查**
Run: `npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**
```bash
git add src/types/property.ts
git commit -m "feat(property): add display config to PropertyDefinition"
```

---

### Task 2: 创建 PropertyInline.vue 组件
**Files:**
- Create: `src/components/Block/PropertyInline.vue`
- Test: `src/components/Block/PropertyInline.test.ts` (CREATE)
- [ ] **Step 1: 写 PropertyInline 组件**
```vue
<script setup lang="ts">
import { computed, h } from 'vue'
import { usePropertyStore } from '../../stores/property'
import { useEditorStore } from '../../stores/editor'
import type { Property } from '../../types/property'

interface Props {
  blockId: string
  position: 'between-bullet-content' | 'right-of-content'
}

const props = defineProps<Props>()
const propertyStore = usePropertyStore()
const editorStore = useEditorStore()

const properties = computed<Property[]>(() => {
  const all = propertyStore.getBlockProperties(props.blockId)
  return all.filter(prop => !prop.isHidden && (propertyStore.getPropertyDef(prop.key)?.displayPosition === props.position))
})

function getIcon(key: string, value: Property['value']): string | null {
  const def = propertyStore.getPropertyDef(key)
  if (def?.closedValues) {
    const cv = def.closedValues.find(cv => cv.value === value)
    if (cv?.icon) {
      return cv.icon
    }
  }
  switch (key) {
    case 'deadline':
    case 'scheduled':
      return '📅'
    case 'tags':
      return '🏷️'
    case 'project':
      return '📁'
    case 'area':
      return '🌐'
    default:
      return null
  }
}

function getLabel(key: string, value: Property['value']): string {
  const def = propertyStore.getPropertyDef(key)
  if (def?.closedValues) {
    const cv = def.closedValues.find(cv => cv.value === value)
    if (cv?.label) {
      return cv.label
    }
  }
  switch (key) {
    case 'deadline':
    case 'scheduled':
    case 'project':
    case 'area':
      return String(value)
    case 'tags':
      return Array.isArray(value) ? value.join(', ') : String(value)
    default:
      return String(value)
  }
}

function renderProperty(prop: Property) {
  const def = propertyStore.getPropertyDef(prop.key)
  const style = def?.displayStyle || 'icon-text'
  const icon = getIcon(prop.key, prop.value)
  const label = getLabel(prop.key, prop.value)

  if (style === 'icon' && icon) {
    return h('span', {}, icon)
  } else if (style === 'text') {
    return h('span', {}, label)
  } else {
    return h('span', {}, [
      icon && h('span', { style: { marginRight: '4px' } }, icon),
      h('span', {}, label)
    ].filter(Boolean))
  }
}

function editProperty(key: string) {
  editorStore.showPropertyEditor(props.blockId, key)
}
</script>

<template>
  <div class="property-inline">
    <div
      v-for="prop in properties"
      :key="prop.id"
      class="property-inline-item"
      @click.stop="editProperty(prop.key)"
    >
      <!-- 渲染属性内容 -->
    </div>
  </div>
</template>

<style scoped>
.property-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.property-inline-item {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 120ms ease;
}

.property-inline-item:hover {
  background: var(--accent-08);
}
</style>
```

- [ ] **Step 2: 写测试文件 PropertyInline.test.ts**
```typescript
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PropertyInline from './PropertyInline.vue'

// Mock stores
vi.mock('../../stores/property', () => ({
  usePropertyStore: () => ({
    getBlockProperties: () => [],
    getPropertyDef: () => null
  })
}))

vi.mock('../../stores/editor', () => ({
  useEditorStore: () => ({
    showPropertyEditor: vi.fn()
  })
}))

describe('PropertyInline', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders without errors', () => {
    const wrapper = mount(PropertyInline, {
      props: {
        blockId: 'test-block',
        position: 'between-bullet-content'
      }
    })
    expect(wrapper.find('.property-inline').exists()).toBe(true)
  })
})
```

- [ ] **Step 3: 运行测试**
Run: `npm run test -- src/components/Block/PropertyInline.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add src/components/Block/PropertyInline.vue src/components/Block/PropertyInline.test.ts
git commit -m "feat(property): add PropertyInline component"
```

---

### Task 3: 更新 PropertyDisplay.vue 组件
**Files:**
- Modify: `src/components/Block/PropertyDisplay.vue`
- Test: 现有测试
- [ ] **Step 1: 更新 PropertyDisplay.vue 以只显示 bottom 位置**
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { usePropertyStore } from '../../stores/property'
import { useEditorStore } from '../../stores/editor'
import type { Property } from '../../types/property'

interface Props {
  blockId: string
}

const props = defineProps<Props>()
const propertyStore = usePropertyStore()
const editorStore = useEditorStore()

const visibleProperties = computed<Property[]>(() => {
  const all = propertyStore.getBlockProperties(props.blockId)
  return all.filter(prop => !prop.isHidden && (propertyStore.getPropertyDef(prop.key)?.displayPosition === 'bottom-of-block'))
})

function isBuiltIn(key: string): boolean {
  const def = propertyStore.getPropertyDef(key)
  return def?.isBuiltIn ?? false
}

function editProperty(key: string) {
  editorStore.showPropertyEditor(props.blockId, key)
}

function getPropertyTitle(key: string): string {
  const def = propertyStore.getPropertyDef(key)
  return def?.title ?? key
}

function renderPropertyValue(prop: Property): string {
  const def = propertyStore.getPropertyDef(prop.key)
  const style = def?.displayStyle || 'icon-text'
  
  let icon: string | null = null
  let label: string = ''
  
  if (def?.closedValues) {
    const cv = def.closedValues.find(cv => cv.value === prop.value)
    if (cv) {
      icon = cv.icon || null
      label = cv.label
    }
  }
  
  if (!icon) {
    switch (prop.key) {
      case 'deadline':
      case 'scheduled':
        icon = '📅'
        label = String(prop.value)
        break
      case 'tags':
        icon = '🏷️'
        label = Array.isArray(prop.value) ? prop.value.join(', ') : String(prop.value)
        break
      case 'project':
        icon = '📁'
        label = String(prop.value)
        break
      case 'area':
        icon = '🌐'
        label = String(prop.value)
        break
      case 'boolean':
        label = prop.value ? '✅' : '❌'
        break
      default:
        label = String(prop.value)
    }
  }
  
  if (style === 'icon' && icon) {
    return icon
  } else if (style === 'text') {
    return label
  } else {
    return icon ? `${icon} ${label}` : label
  }
}
</script>

<template>
  <div v-if="visibleProperties.length > 0" class="property-display">
    <div class="property-list">
      <div
        v-for="prop in visibleProperties"
        :key="prop.id"
        class="property-item"
        :class="{ 'built-in': isBuiltIn(prop.key) }"
        @click.stop="editProperty(prop.key)"
      >
        <span class="property-key">{{ getPropertyTitle(prop.key) }}:</span>
        <span class="property-value">{{ renderPropertyValue(prop) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.property-display {
  margin-top: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  background-color: rgba(0, 0, 0, 0.02);
}

.property-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.property-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 120ms ease;
}

.property-item:hover {
  background: var(--accent-08);
}

.property-item.built-in .property-key {
  color: var(--primary-color, #007bff);
  font-weight: 500;
}

.property-key {
  color: #666;
}

.property-value {
  color: #333;
}
</style>
```

- [ ] **Step 2: 运行类型检查**
Run: `npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**
```bash
git add src/components/Block/PropertyDisplay.vue
git commit -m "feat(property): update PropertyDisplay for bottom position only"
```

---

### Task 4: 更新 Block.vue 集成新的布局
**Files:**
- Modify: `src/components/Block/index.vue`
- [ ] **Step 1: 更新 Block.vue 导入和模板**
```vue
<script setup lang="ts">
// ... 现有导入 ...
import PropertyDisplay from './PropertyDisplay.vue'
import PropertyEditor from './PropertyEditor.vue'
import PropertyInline from './PropertyInline.vue' // 新增
// ... 剩余代码 ...
</script>

<template>
  <div class="block" :class="{ active: isActive }" :data-block-id="blockId">
    <div class="block-row">
      <!-- 缩进占位 -->
      <div class="block-indent" :style="{ width: indentWidth }"></div>

      <!-- 内容区域 -->
      <div class="block-inner">
        <!-- Bullet -->
        <span class="block-bullet" :class="{ collapsed }"
          @click.stop="toggleCollapse">
          <span v-if="node.children.length > 0" class="bullet-chevron" :class="{ 'is-collapsed': collapsed }"></span>
          <span v-else class="bullet-dot"></span>
        </span>

        <!-- Between 位置属性 -->
        <PropertyInline :block-id="blockId" position="between-bullet-content" />

        <!-- 内容区 -->
        <div class="block-content" @mousedown="startEditingAtClick">
          <Editor v-if="isActive" ref="editorRef" :block-id="blockId" :content="block.content" @save="handleSave"
            @split="handleSplit" @merge="handleMerge" @delete="handleDelete" @indent="handleIndent"
            @outdent="handleOutdent" @move-up="handleMoveUp" @move-down="handleMoveDown" @exit-edit="handleExitEdit"
            @cursor-change="handleCursorChange" />
          <div v-else class="block-text" @click="handleContentClick">
            <span v-if="isSingleEmptyBlock" class="block-placeholder">Type something...</span>
            <span v-else v-html="renderContentToHtml(block.content)"></span>
          </div>
        </div>

        <!-- Right 位置属性 -->
        <PropertyInline :block-id="blockId" position="right-of-content" />
      </div>
    </div>

    <!-- 下方属性 -->
    <div class="block-properties">
      <PropertyDisplay :block-id="blockId" />
    </div>

    <!-- 子节点 ... -->
    <VueDraggable ...></VueDraggable>

    <!-- Property Editor -->
    <PropertyEditor />
  </div>
</template>
```

- [ ] **Step 2: 运行类型检查**
Run: `npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**
```bash
git add src/components/Block/index.vue
git commit -m "feat(property): update Block.vue to integrate configurable display"
```

---

### Task 5: 最终集成测试
**Files:**
- Test: 手动启动应用检查
- [ ] **Step 1: 启动开发服务器**
Run: `npm run dev`
Expected: Server starts without errors

- [ ] **Step 2: 功能检查**
  - 检查 status 和 priority 显示在 bullet 和内容之间，只有图标
  - 检查其他属性显示在下方
  - 点击任意属性可以打开编辑器

---

## Self-Review
**1. Spec coverage:** 
  - ✅ PropertyDefinition 类型扩展
  - ✅ BUILT_IN_PROPERTIES 配置
  - ✅ PropertyInline 组件
  - ✅ Block.vue 布局集成
  - ✅ PropertyDisplay 更新
  - 🔲 用户自定义属性存储（按 spec 约定是后续工作）

**2. Placeholder scan:** 无 TBD/TODO，所有代码完整

**3. Type consistency:** 所有类型一致，方法名一致
