<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'
import type { PropertyValue, PropertyType } from '../../types/property'

const editorStore = useEditorStore()
const propertyStore = usePropertyStore()

const visible = computed(() => editorStore.propertyEditor?.visible ?? false)
const blockId = computed(() => editorStore.propertyEditor?.blockId ?? '')
const initialKey = computed(() => editorStore.propertyEditor?.initialKey ?? null)

// 自定义属性的状态
const customKey = ref<string>('')
const selectedType = ref<PropertyType>('string')
const currentValue = ref<PropertyValue>('')
const arrayInput = ref('')

const propertyTypes: { type: PropertyType; label: string }[] = [
  { type: 'string', label: '文本' },
  { type: 'number', label: '数字' },
  { type: 'boolean', label: '布尔值' },
  { type: 'date', label: '日期' },
  { type: 'array', label: '数组/标签' },
]

const currentArrayValue = computed<string[]>({
  get: () => Array.isArray(currentValue.value) ? currentValue.value : [],
  set: (val) => { currentValue.value = val }
})

const canSave = computed(() => {
  if (!customKey.value.trim()) return false
  if (selectedType.value === 'array' && currentArrayValue.value.length === 0) return false
  if (selectedType.value !== 'array' && currentValue.value === '') return false
  return true
})

function open() {
  if (initialKey.value) {
    // 编辑模式
    customKey.value = initialKey.value
    const existing = propertyStore.getBlockProperty(blockId.value, initialKey.value)
    if (existing) {
      selectedType.value = existing.type
      currentValue.value = existing.value
    } else {
      currentValue.value = selectedType.value === 'array' ? [] : ''
    }
  } else {
    // 新建模式
    customKey.value = ''
    selectedType.value = 'string'
    currentValue.value = ''
    arrayInput.value = ''
  }
}

function close() {
  editorStore.hidePropertyEditor()
  customKey.value = ''
  selectedType.value = 'string'
  currentValue.value = ''
  arrayInput.value = ''
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
      customKey.value.trim(),
      currentValue.value,
      selectedType.value
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
            <h3>{{ initialKey ? '编辑自定义属性' : '添加自定义属性' }}</h3>
            <button @click="close" class="close-btn">×</button>
          </div>
          
          <div class="dialog-body">
            <div class="form-group">
              <label>属性名称</label>
              <input
                v-model="customKey"
                type="text"
                placeholder="输入属性名称"
                :disabled="!!initialKey"
              >
            </div>

            <div class="form-group">
              <label>类型</label>
              <select v-model="selectedType" :disabled="!!initialKey">
                <option v-for="t in propertyTypes" :key="t.type" :value="t.type">
                  {{ t.label }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label>值</label>
              
              <!-- Boolean -->
              <div v-if="selectedType === 'boolean'" class="boolean-options">
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
              <input v-else-if="selectedType === 'date'" type="date" v-model="currentValue">

              <!-- Number -->
              <input v-else-if="selectedType === 'number'" type="number" v-model.number="currentValue">

              <!-- Array (tags) -->
              <div v-else-if="selectedType === 'array'" class="array-input">
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
              <input v-else type="text" v-model="currentValue" placeholder="输入值">
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
  z-index: var(--z-dialog);
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
  font-size: var(--heading-5);
  font-weight: var(--font-semibold);
  color: var(--color-ink);
}

.close-btn {
  background: none;
  border: none;
  font-size: var(--text-2xl);
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
  font-weight: var(--font-medium);
  font-size: var(--text-sm);
  color: var(--color-ink);
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: var(--text-sm);
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
  font-size: var(--text-sm);
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
  font-size: var(--text-sm);
}

.remove-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--text-sm);
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
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
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
