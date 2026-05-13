# Property System Phase 3: Property Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
**Goal:** 实现属性编辑功能，包括 PropertyEditor 组件、点击编辑支持、和斜杠命令集成
**Architecture:** 在现有架构上扩展 editor store 管理属性编辑器状态，PropertyEditor 组件处理所有属性类型的编辑逻辑
**Tech Stack:** Vue 3, TypeScript, Pinia, Tiptap

---

## File Structure

```
src/
├── components/
│   └── Block/
│       ├── PropertyDisplay.vue      (MODIFY - 添加点击编辑)
│       ├── PropertyEditor.vue        (CREATE - 属性编辑器组件)
│       └── index.vue                 (MODIFY - 集成 PropertyEditor)
├── stores/
│   └── editor.ts                     (MODIFY - 添加属性编辑器状态)
├── composables/
│   └── useSlashCommands.ts           (MODIFY - 添加属性命令)
└── components/
    └── SlashCommandMenu.vue          (MODIFY - 处理属性命令)
```

---

## Task 1: Update Editor Store

**Files:**
- Modify: `src/stores/editor.ts`

- [ ] **Step 1: Add property editor state to editor store**

修改 `src/stores/editor.ts`，在 `return` 语句之前添加：

```typescript
/** 属性编辑器状态 */
const propertyEditor = ref<{
  visible: boolean
  blockId: string | null
  initialKey: string | null
} | null>(null)

function showPropertyEditor(blockId: string, initialKey?: string) {
  propertyEditor.value = {
    visible: true,
    blockId,
    initialKey: initialKey ?? null
  }
}

function hidePropertyEditor() {
  if (propertyEditor.value) {
    propertyEditor.value.visible = false
  }
}
```

- [ ] **Step 2: Update return statement**

在 `return {` 语句中添加：

```typescript
propertyEditor,
showPropertyEditor,
hidePropertyEditor,
```

完整 return 语句应该是：

```typescript
return {
  activeBlockId,
  pendingCursorPos,
  activeEditor,
  slashCommand,
  propertyEditor,
  activateBlock,
  deactivateBlock,
  consumeCursorPos,
  setCursorPos,
  setActiveEditor,
  showSlashCommand,
  hideSlashCommand,
  updateSlashQuery,
  updateSlashSelectedIndex,
  showPropertyEditor,
  hidePropertyEditor
}
```

- [ ] **Step 3: Commit**

```bash
git add src/stores/editor.ts
git commit -m "feat(property): add property editor state management"
```

---

## Task 2: Create PropertyEditor Component

**Files:**
- Create: `src/components/Block/PropertyEditor.vue`

- [ ] **Step 1: Write PropertyEditor component**

创建 `src/components/Block/PropertyEditor.vue`：

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'
import type { PropertyValue, PropertyDefinition } from '../../types/property'

const editorStore = useEditorStore()
const propertyStore = usePropertyStore()

const visible = computed(() => editorStore.propertyEditor?.visible ?? false)
const blockId = computed(() => editorStore.propertyEditor?.blockId ?? '')
const initialKey = computed(() => editorStore.propertyEditor?.initialKey ?? null)

const builtInProperties = computed(() => propertyStore.builtInProperties)
const selectedKey = ref<string>('')
const currentValue = ref<PropertyValue>('')
const arrayInput = ref('')

const currentDef = computed<PropertyDefinition | undefined>(() => {
  if (!selectedKey.value) return undefined
  return propertyStore.getPropertyDef(selectedKey.value)
})

const hasClosedValues = computed(() => (currentDef.value?.closedValues?.length ?? 0) > 0)

const currentArrayValue = computed<string[]>({
  get: () => Array.isArray(currentValue.value) ? currentValue.value : [],
  set: (val) => { currentValue.value = val }
})

const canSave = computed(() => selectedKey.value && currentValue.value !== '')

function open() {
  if (initialKey.value) {
    selectedKey.value = initialKey.value
    const existing = propertyStore.getBlockProperty(blockId.value, initialKey.value)
    if (existing) {
      currentValue.value = existing.value
    } else {
      currentValue.value = currentDef.value?.closedValues?.[0]?.value ?? ''
    }
  } else {
    selectedKey.value = builtInProperties.value[0]?.key || ''
    currentValue.value = ''
  }
}

function close() {
  editorStore.hidePropertyEditor()
  selectedKey.value = ''
  currentValue.value = ''
  arrayInput.value = ''
}

function onKeyChange() {
  if (blockId.value && selectedKey.value) {
    const existing = propertyStore.getBlockProperty(blockId.value, selectedKey.value)
    if (existing) {
      currentValue.value = existing.value
    } else {
      currentValue.value = currentDef.value?.closedValues?.[0]?.value ?? ''
    }
  }
}

function addArrayItem() {
  const val = arrayInput.value.trim()
  if (val && !currentArrayValue.value.includes(val)) {
    currentArrayValue.value = [...currentArrayValue.value, val]
  }
  arrayInput.value = ''
}

function removeArrayItem(idx: number) {
  currentArrayValue.value = currentArrayValue.value.filter((_, i) => i !== idx)
}

async function save() {
  if (!canSave.value || !blockId.value) return

  try {
    await propertyStore.setProperty(
      blockId.value,
      selectedKey.value,
      currentValue.value,
      currentDef.value?.type
    )
    close()
  } catch (error) {
    console.error('Failed to save property:', error)
  }
}

watch(visible, (val) => {
  if (val) {
    open()
  }
}, { immediate: true })
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="property-editor-overlay" @click.self="close">
        <div class="property-editor-dialog">
          <div class="dialog-header">
            <h3>{{ initialKey ? '编辑属性' : '添加属性' }}</h3>
            <button @click="close" class="close-btn">×</button>
          </div>
          
          <div class="dialog-body">
            <div class="form-group">
              <label>属性</label>
              <select v-model="selectedKey" @change="onKeyChange">
                <option v-for="def in builtInProperties" :key="def.key" :value="def.key">
                  {{ def.title }}
                </option>
              </select>
            </div>

            <div v-if="selectedKey" class="form-group">
              <label>值</label>
              
              <!-- Closed values dropdown (status, priority) -->
              <select v-if="hasClosedValues" v-model="currentValue">
                <option
                  v-for="cv in currentDef?.closedValues"
                  :key="String(cv.value)"
                  :value="cv.value"
                >
                  {{ cv.icon ? `${cv.icon} ` : '' }}{{ cv.label }}
                </option>
              </select>

              <!-- Boolean -->
              <div v-else-if="currentDef?.type === 'boolean'" class="boolean-options">
                <label class="boolean-option">
                  <input type="radio" v-model="currentValue" :value="true">
                  <span>是</span>
                </label>
                <label class="boolean-option">
                  <input type="radio" v-model="currentValue" :value="false">
                  <span>否</span>
                </label>
              </div>

              <!-- Date -->
              <input v-else-if="currentDef?.type === 'date'" type="date" v-model="currentValue">

              <!-- Number -->
              <input v-else-if="currentDef?.type === 'number'" type="number" v-model.number="currentValue">

              <!-- Array (tags) -->
              <div v-else-if="currentDef?.type === 'array'" class="array-input">
                <input
                  v-model="arrayInput"
                  @keydown.enter.prevent="addArrayItem"
                  placeholder="输入标签，回车添加"
                >
                <div class="array-items">
                  <span
                    v-for="(item, idx) in currentArrayValue"
                    :key="idx"
                    class="array-item"
                  >
                    {{ item }}
                    <button @click="removeArrayItem(idx)" class="remove-btn">×</button>
                  </span>
                </div>
              </div>

              <!-- Default: string -->
              <input v-else type="text" v-model="currentValue">
            </div>
          </div>

          <div class="dialog-footer">
            <button @click="close" class="btn btn-secondary">取消</button>
            <button @click="save" class="btn btn-primary" :disabled="!canSave">保存</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.property-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.property-editor-dialog {
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px;
  min-width: 400px;
  max-width: 90vw;
  box-shadow: var(--shadow-modal);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink);
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  padding: 4px 8px;
  color: var(--color-ink-secondary);
  transition: color 120ms ease;
}

.close-btn:hover {
  color: var(--color-ink);
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  font-size: 13px;
  color: var(--color-ink);
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  color: var(--color-ink);
  background: var(--bg-base);
  transition: border-color 150ms ease;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--color-accent);
}

.boolean-options {
  display: flex;
  gap: 24px;
}

.boolean-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
}

.array-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.array-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--accent-subtle);
  border-radius: 4px;
  font-size: 13px;
}

.remove-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
  color: var(--color-ink-secondary);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 120ms ease;
}

.btn-secondary {
  background: transparent;
  color: var(--color-ink-secondary);
  border: 1px solid var(--color-border-light);
}

.btn-secondary:hover {
  background: rgba(0, 0, 0, 0.04);
}

.btn-primary {
  background: var(--color-accent);
  color: var(--color-white);
}

.btn-primary:hover {
  background: var(--color-accent-deep);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 180ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Block/PropertyEditor.vue
git commit -m "feat(property): add PropertyEditor component"
```

---

## Task 3: Update Block Component

**Files:**
- Modify: `src/components/Block/index.vue`

- [ ] **Step 1: Import PropertyEditor component**

在 `<script setup>` 部分的 import 语句中添加：

```typescript
import PropertyEditor from './PropertyEditor.vue'
```

- [ ] **Step 2: Add PropertyEditor to template**

在 `<template>` 部分的最后（`</div>` 之前）添加：

```vue
<!-- Property Editor -->
<PropertyEditor />
```

完整结构应该是：

```vue
    <!-- 子节点容器... -->
    </VueDraggable>
    
    <!-- Property Editor -->
    <PropertyEditor />
  </div>
</template>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Block/index.vue
git commit -m "feat(property): integrate PropertyEditor into Block"
```

---

## Task 4: Update PropertyDisplay Component

**Files:**
- Modify: `src/components/Block/PropertyDisplay.vue`

- [ ] **Step 1: Import editor store and add click handler**

修改 `<script setup>` 部分：

```typescript
import { computed } from 'vue'
import { usePropertyStore } from '../../stores/property'
import { useEditorStore } from '../../stores/editor'
import type { Property } from '../../types/property'

const propertyStore = usePropertyStore()
const editorStore = useEditorStore()

// ... existing code ...

function editProperty(blockId: string, key: string) {
  editorStore.showPropertyEditor(blockId, key)
}
```

- [ ] **Step 2: Update template to add click handler**

修改 `.property-item` div：

```vue
<div
  v-for="prop in visibleProperties"
  :key="prop.id"
  class="property-item"
  :class="{ 'built-in': isBuiltIn(prop.key) }"
  @click.stop="editProperty(props.blockId, prop.key)"
>
```

- [ ] **Step 3: Add cursor style**

在 `<style scoped>` 部分添加：

```css
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
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Block/PropertyDisplay.vue
git commit -m "feat(property): add click to edit property"
```

---

## Task 5: Add Property Slash Command

**Files:**
- Modify: `src/composables/useSlashCommands.ts`

- [ ] **Step 1: Add property command to commands array**

在 `commands` 数组末尾（在 `search-page` 之前）添加：

```typescript
// 属性
{
  id: 'property',
  name: 'Add property',
  alias: ['属性', 'property', 'prop'],
  group: '属性',
  icon: '🏷️',
  action: () => {
    // 由 SlashCommandMenu.vue 特殊处理
  }
},
```

- [ ] **Step 2: Commit**

```bash
git add src/composables/useSlashCommands.ts
git commit -m "feat(property): add property slash command"
```

---

## Task 6: Update SlashCommandMenu

**Files:**
- Modify: `src/components/SlashCommandMenu.vue`

- [ ] **Step 1: Add import for editorStore**

在 `<script setup>` 顶部添加：

```typescript
const editorStore = useEditorStore()
```

- [ ] **Step 2: Update executeCommand function**

修改 `executeCommand` 函数，添加对 property 命令的处理：

```typescript
// 执行命令
function executeCommand(command: Command) {
  const editor = editorStore.activeEditor
  if (!editor || !range.value) return

  const currentRange = {
    from: range.value.from,
    to: editor.state.selection.from
  }

  // 关闭面板
  close()

  // 特殊处理属性命令
  if (command.id === 'property') {
    const blockId = editorStore.activeBlockId
    if (blockId) {
      editorStore.showPropertyEditor(blockId)
    }
    return
  }

  // 执行命令
  command.action({
    editor,
    range: currentRange
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/SlashCommandMenu.vue
git commit -m "feat(property): handle property command in slash menu"
```

---

## Task 7: Integration Test

**Files:**
- Create: `src/components/Block/PropertyEditor.test.ts`

- [ ] **Step 1: Write integration test**

创建 `src/components/Block/PropertyEditor.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PropertyEditor from './PropertyEditor.vue'

// Mock editor store
vi.mock('../../stores/editor', () => ({
  useEditorStore: () => ({
    propertyEditor: {
      visible: true,
      blockId: 'test-block-id',
      initialKey: null
    },
    hidePropertyEditor: vi.fn(),
    showPropertyEditor: vi.fn()
  })
}))

// Mock property store
vi.mock('../../stores/property', () => ({
  usePropertyStore: () => ({
    builtInProperties: [
      { key: 'status', title: '状态', type: 'string', closedValues: [
        { value: 'Todo', label: '待办', icon: '📋' }
      ]},
      { key: 'priority', title: '优先级', type: 'string' }
    ],
    getPropertyDef: (key: string) => {
      if (key === 'status') return {
        key: 'status',
        title: '状态',
        type: 'string',
        closedValues: [{ value: 'Todo', label: '待办', icon: '📋' }]
      }
      return undefined
    },
    getBlockProperty: () => undefined,
    setProperty: vi.fn().mockResolvedValue({ id: 'prop-1' })
  })
}))

describe('PropertyEditor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders property editor dialog', () => {
    const wrapper = mount(PropertyEditor, {
      global: {
        stubs: {
          Teleport: true
        }
      }
    })
    
    expect(wrapper.find('.property-editor-dialog').exists()).toBe(true)
    expect(wrapper.find('.dialog-header h3').text()).toBe('添加属性')
  })

  it('shows built-in properties in dropdown', () => {
    const wrapper = mount(PropertyEditor, {
      global: {
        stubs: {
          Teleport: true
        }
      }
    })
    
    const options = wrapper.findAll('select option')
    expect(options.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd d:\comind\comind
npm run test -- src/components/Block/PropertyEditor.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Block/PropertyEditor.test.ts
git commit -m "test(property): add PropertyEditor tests"
```

---

## Self-Review Checklist

✅ **1. Spec coverage:** 
- PropertyEditor 组件 ✓ (Task 2)
- 点击属性编辑 ✓ (Task 4)
- 斜杠命令添加 ✓ (Task 5)
- 斜杠命令处理 ✓ (Task 6)
- editor store 状态 ✓ (Task 1)
- Block 组件集成 ✓ (Task 3)

✅ **2. Placeholder scan:** 无 TBD 或 TODO，所有代码都是完整实现

✅ **3. Type consistency:** 
- 所有类型引用自 `../../types/property`
- editorStore 方法名一致: `showPropertyEditor`, `hidePropertyEditor`, `propertyEditor`
- propertyStore 方法名一致: `builtInProperties`, `getPropertyDef`, `getBlockProperty`, `setProperty`

---

## Execution Handoff

Plan complete and saved. Starting implementation with Subagent-Driven Development.
