<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'
import { useBlockCardStore } from '../../stores/blockCard'
import type { PropertyValue } from '../../types/property'
import { getAllPropertyDefinitions } from '../../types/property'
import { Icon } from '../Icons'
import BasePopover from '@/components/common/BasePopover.vue'

const editorStore = useEditorStore()
const propertyStore = usePropertyStore()
const blockCardStore = useBlockCardStore()

const builtInProperties = getAllPropertyDefinitions()

const visible = computed(() => editorStore.quickPropertyEditor?.visible ?? false)
const blockId = computed(() => editorStore.quickPropertyEditor?.blockId ?? '')
const key = computed(() => editorStore.quickPropertyEditor?.key ?? '')
const position = computed(() => editorStore.quickPropertyEditor?.position ?? null)

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

/** 以"搜索框+已有值列表"弹层交互的内置属性（project / area） */
const pickerKey = computed<string | null>(() => {
  const k = currentDef.value?.key
  return k === 'project' || k === 'area' ? k : null
})

const pickerTitle = computed(() => currentDef.value?.title ?? '')
const pickerIcon = computed(() => (pickerKey.value === 'project' ? '📁' : '🌐'))
const pickerPlaceholder = computed(() => `搜索${pickerTitle.value}或输入新${pickerTitle.value}名`)
const pickerEmptyHint = computed(() =>
  refUsage.value.length === 0
    ? `暂无${pickerTitle.value}，输入名称回车创建`
    : `无匹配${pickerTitle.value}，回车创建「${textValue.value.trim()}」`
)

interface RefUsage {
  name: string
  count: number
}

/** 从全量块快照派生已有值：去重 + 计数，次数降序、同频按名称 */
const refUsage = computed<RefUsage[]>(() => {
  const key = pickerKey.value
  if (!key) return []
  const usage = new Map<string, number>()
  for (const card of blockCardStore.cards) {
    const val = (card.properties ?? {})[key]
    if (typeof val === 'string' && val.trim()) {
      usage.set(val, (usage.get(val) ?? 0) + 1)
    }
  }
  return [...usage.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
})

const filteredRefs = computed<RefUsage[]>(() => {
  const q = textValue.value.trim().toLowerCase()
  if (!q) return refUsage.value
  return refUsage.value.filter(p => p.name.toLowerCase().includes(q))
})

const highlightIndex = ref(-1)

function moveHighlight(delta: number) {
  const len = filteredRefs.value.length
  if (len === 0) return
  const base = highlightIndex.value === -1 ? (delta > 0 ? -1 : 0) : highlightIndex.value
  highlightIndex.value = ((base + delta) % len + len) % len
}

function onPickerInput(e: Event) {
  handleTextChange(e)
  highlightIndex.value = -1
}

function handlePickerKeydown(e: KeyboardEvent) {
  const k = e.key
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault()
    e.stopPropagation()
    moveHighlight(k === 'ArrowDown' ? 1 : -1)
    return
  }
  if (k === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    const highlighted = highlightIndex.value >= 0 ? filteredRefs.value[highlightIndex.value] : undefined
    if (highlighted) {
      saveValue(highlighted.name)
    } else if (textValue.value.trim()) {
      saveValue(textValue.value.trim())
    }
  }
}

async function saveValue(value: PropertyValue) {
  await propertyStore.setProperty(blockId.value, key.value, value, currentDef.value?.type)
  editorStore.hideQuickPropertyEditor()
}

// 无锚点时回退到视口居中，保持原 quick-editor 居中行为（生产调用方均会传 position）
const popoverPosition = computed(() => {
  return position.value ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
})

watch(visible, async (v) => {
  if (!v) return
  if (pickerKey.value) {
    textValue.value = (currentValue.value as string) || ''
    highlightIndex.value = -1
    // 保证"已有值"来自全量快照（懒加载/脏刷新由 blockCardStore 负责）
    blockCardStore.getCards()
    await nextTick()
    textInputRef.value?.focus()
    textInputRef.value?.select()
  } else if (currentDef.value?.type === 'string' && !currentDef.value?.closedValues) {
    textValue.value = (currentValue.value as string) || ''
    await nextTick()
    textInputRef.value?.focus()
    textInputRef.value?.select()
  } else if (currentDef.value?.type === 'array') {
    newTag.value = ''
    await nextTick()
    tagInputRef.value?.focus()
  }
})

function isSvgIcon(icon: string): boolean {
  return icon.startsWith('status-') || icon.startsWith('priority-') || icon.startsWith('icon-')
}
</script>

<template>
  <BasePopover
    :visible="visible && !!currentDef"
    :position="popoverPosition"
    @close="editorStore.hideQuickPropertyEditor()"
  >
    <template v-if="currentDef">
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
            <Icon
              v-if="isSvgIcon(cv.icon)"
              :name="cv.icon"
              :size="16"
            />
            <span v-else>{{ cv.icon }}</span>
          </span>
          <div class="option-text">
            <span class="option-label">{{ cv.label }}</span>
            <span v-if="cv.description" class="option-description">{{ cv.description }}</span>
          </div>
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

      <!-- Ref-List Picker (project/area：搜索已有值 / 回车新建) -->
      <template v-else-if="pickerKey">
        <input
          ref="textInputRef"
          type="text"
          :value="textValue"
          :placeholder="pickerPlaceholder"
          @input="onPickerInput"
          @keydown="handlePickerKeydown"
          @click.stop
          class="text-input project-search"
        />
        <div class="project-list">
          <div
            v-for="(p, idx) in filteredRefs"
            :key="p.name"
            class="quick-option project-option"
            :class="{ selected: p.name === currentValue, highlighted: idx === highlightIndex }"
            @mousedown.prevent
            @click.stop="saveValue(p.name)"
            @mouseenter="highlightIndex = idx"
          >
            <span class="option-icon">{{ pickerIcon }}</span>
            <div class="option-text">
              <span class="option-label">{{ p.name }}</span>
            </div>
          </div>
          <div v-if="filteredRefs.length === 0" class="project-empty">
            {{ pickerEmptyHint }}
          </div>
        </div>
      </template>

      <!-- Text Input (其他 string 属性) -->
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
    </template>
  </BasePopover>
</template>

<style scoped>
.quick-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
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
  font-size: var(--text-sm);
}

.option-text {
  display: flex;
  flex-direction: row;
  gap: 8px;
}

.option-label {
  font-size: var(--text-sm);
}

.option-description {
  margin-top: auto;
  font-size: var(--text-xs);
  color: #9ca3af;
}

.date-input,
.text-input {
  width: 100%;
  padding: 10px 12px;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--text-sm);
  color: var(--text-primary);
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
  font-size: var(--text-sm);
}

.tag-remove {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--text-sm);
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
  font-size: var(--text-sm);
}

.project-list {
  max-height: 208px;
  overflow-y: auto;
  border-top: 1px solid var(--border);
}

.project-option.highlighted {
  background: var(--accent-subtle, rgba(59, 130, 246, 0.08));
}

.project-empty {
  padding: 10px 12px;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}
</style>
