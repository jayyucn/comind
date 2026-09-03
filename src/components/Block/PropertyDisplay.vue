<script setup lang="ts">
import { Pin } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { openReaderWindow } from '../../composables/useReaderWindow'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'
import type { Property } from '../../types/property'
import { isTauriEnvironment } from '../../wasm/tauri-platform'
import { Icon } from '../Icons'

const props = defineProps<{
  blockId: string
}>()

const propertyStore = usePropertyStore()
const blockStore = useBlockStore()
const editorStore = useEditorStore()

const visibleProperties = computed<Property[]>(() => {
  const all = propertyStore.getBlockProperties(props.blockId)
  return all.filter(prop => {
    if (prop.isHidden) return false
    // T14: deadline/scheduled 已内联为 dateRef，不在属性面板展示
    if (prop.key === 'deadline' || prop.key === 'scheduled') return false
    const def = propertyStore.getPropertyDef(prop.key)
    // 显示内置属性（displayPosition === 'bottom-of-block'）和所有自定义属性
    return def?.displayPosition === 'bottom-of-block' || !def?.isBuiltIn
  })
})

// ---- 票 06：跳回原文（书笔记 Block） ----

/** block 的全部属性（供书笔记紧凑行读取 chapter/quote） */
const allProperties = computed(() => propertyStore.getBlockProperties(props.blockId))

/** cfi 属性值（「跳回原文」的数据源） */
const sourceCfi = computed<string | null>(() => {
  const prop = allProperties.value.find(p => p.key === 'cfi')
  return prop ? String(prop.value) : null
})

/** 父级章节属性值（卷/部，双层结构时使用） */
const part = computed(() => {
  const prop = allProperties.value.find(p => p.key === 'part')
  return prop ? String(prop.value) : ''
})

/** 章节属性值 */
const chapter = computed(() => {
  const prop = allProperties.value.find(p => p.key === 'chapter')
  return prop ? String(prop.value) : ''
})

/** 原文引用属性值 */
const quote = computed(() => {
  const prop = allProperties.value.find(p => p.key === 'quote')
  return prop ? String(prop.value) : ''
})

/** 章节展示：双层结构 part/chapter，单层仅 chapter */
const chapterLabel = computed(() => {
  if (!chapter.value) return ''
  if (part.value) return `${part.value} / ${chapter.value}`
  return chapter.value
})

/** 书笔记：存在原文引用属性（quote 是书笔记四件套的核心展示属性） */
const isBookNote = computed(() => !!quote.value)

/** 仅 Tauri 环境且 cfi 属性存在时显示（web/Android 无阅读器窗口） */
const canJumpToSource = computed(() => isTauriEnvironment() && !!sourceCfi.value)

/** 唤起（或聚焦）该书阅读器窗口并定位到高亮处：bookPageId 即 Block 所属书 Page */
async function jumpToSource(): Promise<void> {
  const cfi = sourceCfi.value
  if (!cfi) return
  const block = blockStore.getBlock(props.blockId)
  const bookPageId = block?.pageId
  if (!bookPageId) return
  await openReaderWindow(bookPageId, { jumpCfi: cfi })
}

const hoveredPropertyId = ref<string | null>(null)

function isBuiltIn(key: string): boolean {
  const def = propertyStore.getPropertyDef(key)
  return def?.isBuiltIn ?? false
}

function editProperty(prop: Property, event: MouseEvent) {
  if (isBuiltIn(prop.key)) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    editorStore.showQuickPropertyEditor(
      props.blockId,
      prop.key,
      { x: rect.left, y: rect.bottom + 4 }
    )
  } else {
    editorStore.showPropertyEditor(props.blockId, prop.key)
  }
}

function deleteProperty(prop: Property, event: MouseEvent) {
  event.stopPropagation()
  propertyStore.deleteProperty(prop.id, props.blockId)
}

function getPropertyTitle(key: string): string {
  const def = propertyStore.getPropertyDef(key)
  return def?.title ?? key
}

function getIcon(key: string, value: Property['value']): string | null {
  const def = propertyStore.getPropertyDef(key)
  if (def?.closedValues) {
    const cv = def.closedValues.find(cv => cv.value === value)
    if (cv?.icon) {
      return cv.icon
    }
  }
  switch (key) {
    case 'tags':
      return '🏷️'
    case 'project':
      return '📁'
    case 'area':
      return '🌐'
    case 'book':
      return '📖'
    case 'chapter':
      return '📄'
    case 'quote':
      return '❝'
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
    case 'project':
    case 'area':
      return String(value)
    case 'tags':
      return Array.isArray(value) ? value.join(', ') : String(value)
    case 'boolean':
      return value ? '是' : '否'
    default:
      return String(value)
  }
}

function isSvgIcon(icon: string): boolean {
  return icon.startsWith('status-') || icon.startsWith('priority-') || icon.startsWith('icon-')
}
</script>

<template>
  <!-- 书笔记：紧凑一行展示来源信息（Pin + 章节/序号 + "原文引用" + 页码），不展开属性列表 -->
  <div
    v-if="isBookNote"
    class="property-display book-note-source"
    :class="{ 'can-jump': canJumpToSource }"
    :title="canJumpToSource ? '跳回原文（在阅读器中定位高亮）' : undefined"
    @click.stop="jumpToSource"
  >
    <Pin :size="14" class="source-pin" />
    <span v-if="chapterLabel" class="source-chapter">{{ chapterLabel }}</span>
    <span v-if="quote" class="source-quote">{{ quote }}</span>
  </div>

  <div v-else-if="visibleProperties.length > 0" class="property-display">
    <div class="property-list">
      <div
        v-for="prop in visibleProperties"
        :key="prop.id"
        class="property-item"
        :class="{ 'built-in': isBuiltIn(prop.key), 'quote-item': prop.key === 'quote' }"
        :title="prop.key === 'quote' ? String(prop.value) : undefined"
        @mouseenter="hoveredPropertyId = prop.id"
        @mouseleave="hoveredPropertyId = null"
        @click.stop="editProperty(prop, $event)"
      >
        <!-- project/area 直接以图标+名称展示，不渲染标签 -->
        <span v-if="prop.key !== 'project' && prop.key !== 'area'" class="property-key">{{ getPropertyTitle(prop.key) }}:</span>
        <span class="property-value">
          <template v-if="getIcon(prop.key, prop.value)">
            <Icon
              v-if="isSvgIcon(getIcon(prop.key, prop.value)!)"
              :name="getIcon(prop.key, prop.value)!"
            />
            <span v-else>{{ getIcon(prop.key, prop.value) }}</span>
            <span v-if="getLabel(prop.key, prop.value) && propertyStore.getPropertyDef(prop.key)?.displayStyle !== 'icon'">
              {{ getLabel(prop.key, prop.value) }}
            </span>
          </template>
          <span v-else>{{ getLabel(prop.key, prop.value) }}</span>
        </span>
        <button
          v-if="hoveredPropertyId === prop.id"
          class="delete-button"
          @click.stop="deleteProperty(prop, $event)"
          title="删除属性"
        >
          ×
        </button>
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

/* 书笔记紧凑来源行：Pin + [章节] + 原文引用（原文引用可完整换行） */
.book-note-source {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  /* 整体向右缩进，使来源行明显位于笔记内容之下（不在同一左对齐线上） */
  margin-left: 22px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  transition: background 120ms ease, color 120ms ease;
}

.book-note-source.can-jump {
  cursor: pointer;
}

.book-note-source.can-jump:hover {
  background: var(--accent-08, rgba(59, 130, 246, 0.08));
  color: var(--accent);
}

.source-pin {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.source-chapter {
  flex-shrink: 0;
  color: var(--text-primary);
  font-weight: 500;
}

/* 原文引用占满整行（换行到第二行），左对齐到章节之下 */
.source-quote {
  flex: 1 1 100%;
  margin-left: 14px;
  color: var(--text-tertiary);
  font-style: italic;
}

.property-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

/* 票 06：quote 属性（高亮原文）单行截断，悬浮 title 看全文 */
.property-item.quote-item .property-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 420px;
  display: inline-block;
  vertical-align: bottom;
}

.property-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
  cursor: pointer;
  padding: 2px 4px;
  padding-right: 20px;
  border-radius: 4px;
  transition: background 120ms ease;
  position: relative;
}

.property-item:hover {
  background: var(--accent-08, rgba(59, 130, 246, 0.08));
}

.property-item.built-in .property-key {
  color: var(--primary-color, #007bff);
  font-weight: var(--font-medium);
}

.property-key {
  color: #6b7280;
}

.property-value {
  color: #374151;
}

.delete-button {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--heading-5);
  line-height: var(--leading-none);
  color: #9ca3af;
  padding: 0 4px;
  border-radius: 4px;
  transition: color 120ms ease, background 120ms ease;
}

.delete-button:hover {
  color: #374151;
  background: rgba(0, 0, 0, 0.05);
}
</style>
