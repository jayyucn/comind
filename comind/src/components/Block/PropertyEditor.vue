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
