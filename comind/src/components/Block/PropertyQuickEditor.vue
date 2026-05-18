<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'
import type { PropertyValue } from '../../types/property'
import { getAllPropertyDefinitions } from '../../types/property'
import { TaskIcon } from '../Icons'

const editorStore = useEditorStore()
const propertyStore = usePropertyStore()

const builtInProperties = getAllPropertyDefinitions()

const visible = computed(() => editorStore.quickPropertyEditor?.visible ?? false)
const blockId = computed(() => editorStore.quickPropertyEditor?.blockId ?? '')
const key = computed(() => editorStore.quickPropertyEditor?.key ?? '')
const position = computed(() => editorStore.quickPropertyEditor?.position ?? null)

const dropdownRef = ref<HTMLDivElement | null>(null)
const textInputRef = ref<HTMLInputElement | null>(null)
const tagInputRef = ref<HTMLInputElement | null>(null)

const currentDef = computed(() => {
  return builtInProperties.find(p => p.key === key.value)
})

const currentValue = computed(() => {
  const prop = propertyStore.getBlockProperty(blockId.value, key.value)
  return prop?.value ?? ''
})

const tagList = computed(() => {
  const val = currentValue.value
  return Array.isArray(val) ? val : []
})

const newTag = ref('')
const textValue = ref('')

function handleSelectClosedValue(value: string) {
  saveValue(value)
}

function handleDateChange(e: Event) {
  const target = e.target as HTMLInputElement
  saveValue(target.value)
}

function addTag() {
  if (newTag.value.trim()) {
    const newTags = [...tagList.value, newTag.value.trim()]
    saveValue(newTags)
    newTag.value = ''
  }
}

function removeTag(tag: string) {
  const newTags = tagList.value.filter(t => t !== tag)
  saveValue(newTags)
}

function handleTextChange(e: Event) {
  const target = e.target as HTMLInputElement
  textValue.value = target.value
}

function handleTextSave() {
  saveValue(textValue.value)
}

async function saveValue(value: PropertyValue) {
  await propertyStore.setProperty(blockId.value, key.value, value, currentDef.value?.type)
  editorStore.hideQuickPropertyEditor()
}

function handleClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    editorStore.hideQuickPropertyEditor()
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    editorStore.hideQuickPropertyEditor()
  } else if (e.key === 'Enter') {
    if (currentDef.value?.type === 'string' && !currentDef.value?.closedValues) {
      handleTextSave()
    } else if (currentDef.value?.type === 'array') {
      addTag()
    }
  }
}

watch(visible, async (v) => {
  if (v) {
    if (currentDef.value?.type === 'string' && !currentDef.value?.closedValues) {
      textValue.value = (currentValue.value as string) || ''
      await nextTick()
      textInputRef.value?.focus()
      textInputRef.value?.select()
    } else if (currentDef.value?.type === 'array') {
      newTag.value = ''
      await nextTick()
      tagInputRef.value?.focus()
    }
    
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
  } else {
    document.removeEventListener('click', handleClickOutside)
    document.removeEventListener('keydown', handleKeyDown)
  }
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeyDown)
})

function getEditorPosition() {
  if (position.value) {
    return {
      left: `${position.value.x}px`,
      top: `${position.value.y}px`
    }
  }
  return {
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)'
  }
}

function isSvgIcon(icon: string): boolean {
  return icon.startsWith('status-') || icon.startsWith('priority-') || icon.startsWith('icon-')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="quick-editor-overlay">
        <div
          v-if="currentDef"
          ref="dropdownRef"
          class="quick-editor-dropdown"
          :style="getEditorPosition()"
        >
          <!-- Closed Values Dropdown (status, priority) -->
          <template v-if="currentDef.closedValues">
            <div
              v-for="cv in currentDef.closedValues"
              :key="String(cv.value as string)"
              class="quick-option"
              :class="{ selected: cv.value === currentValue }"
              @click.stop="handleSelectClosedValue(cv.value as string)"
            >
              <span v-if="cv.icon" class="option-icon">
                <TaskIcon 
                  v-if="isSvgIcon(cv.icon)"
                  :name="cv.icon"
                  :size="16"
                />
                <span v-else>{{ cv.icon }}</span>
              </span>
              <span class="option-label">{{ cv.label }}</span>
            </div>
          </template>

          <!-- Date Picker -->
          <template v-else-if="currentDef.type === 'date'">
            <input
              type="date"
              class="date-input"
              :value="currentValue as string"
              @change.stop="handleDateChange"
              @click.stop
            />
          </template>

          <!-- Tags Input -->
          <template v-else-if="currentDef.type === 'array'">
            <div class="tags-editor">
              <div v-if="tagList.length > 0" class="tags-list">
                <span
                  v-for="tag in tagList"
                  :key="tag"
                  class="tag-item"
                >
                  {{ tag }}
                  <button @click.stop="removeTag(tag)" class="tag-remove">×</button>
                </span>
              </div>
              <input
                ref="tagInputRef"
                v-model="newTag"
                type="text"
                placeholder="输入标签，回车添加"
                @keydown.enter.prevent.stop="addTag"
                @click.stop
              />
            </div>
          </template>

          <!-- Text Input (project, area) -->
          <template v-else>
            <input
              ref="textInputRef"
              type="text"
              :value="textValue"
              @input="handleTextChange"
              @keydown.enter.prevent.stop="handleTextSave"
              @click.stop
              class="text-input"
              placeholder="输入内容，回车保存"
            />
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.quick-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 1001;
}

.quick-editor-dropdown {
  position: absolute;
  min-width: 100px;
  background: var(--color-paper, #ffffff);
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.quick-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.quick-option:hover {
  background: var(--accent-subtle, rgba(59, 130, 246, 0.08));
}

.quick-option.selected {
  background: var(--accent-subtle, rgba(59, 130, 246, 0.12));
}

.option-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 14px;
}

.option-label {
  font-size: 14px;
}

.date-input,
.text-input {
  width: 100%;
  padding: 10px 12px;
  border: none;
  outline: none;
  font-size: 14px;
  box-sizing: border-box;
}

.tags-editor {
  padding: 8px 12px;
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.tag-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--accent-subtle, rgba(59, 130, 246, 0.12));
  border-radius: 4px;
  font-size: 13px;
}

.tag-remove {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  color: #6b7280;
}

.tag-remove:hover {
  color: #374151;
}

.tags-editor input {
  width: 100%;
  padding: 6px 0;
  border: none;
  outline: none;
  font-size: 14px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
