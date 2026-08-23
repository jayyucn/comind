<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePropertyStore } from '../../stores/property'
import { useEditorStore } from '../../stores/editor'
import type { Property } from '../../types/property'
import { Icon } from '../Icons'

interface Props {
  blockId: string
  position: 'between-bullet-content' | 'right-of-content'
}

const props = defineProps<Props>()
const propertyStore = usePropertyStore()
const editorStore = useEditorStore()

const properties = computed<Property[]>(() => {
  const all = propertyStore.getBlockProperties(props.blockId)
  return all.filter(prop => {
    if (prop.isHidden) return false
    // priority 不再显示在 content 右侧（删除入口已移至斜杠命令面板）
    if (props.position === 'right-of-content' && prop.key === 'priority') return false
    const def = propertyStore.getPropertyDef(prop.key)
    return def?.displayPosition === props.position
  })
})

const hoveredPropertyId = ref<string | null>(null)

function isBuiltIn(key: string): boolean {
  const def = propertyStore.getPropertyDef(key)
  return def?.isBuiltIn ?? false
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
    default:
      return String(value)
  }
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

function isSvgIcon(icon: string): boolean {
  return icon.startsWith('status-') || icon.startsWith('priority-') || icon.startsWith('icon-')
}
</script>

<template>
  <div class="property-inline">
    <div
      v-for="prop in properties"
      :key="prop.id"
      class="property-inline-item"
      :class="{ 
        'built-in': isBuiltIn(prop.key),
        'icon-only': propertyStore.getPropertyDef(prop.key)?.displayStyle === 'icon'
      }"
      @mouseenter="hoveredPropertyId = prop.id"
      @mouseleave="hoveredPropertyId = null"
      @click.stop="editProperty(prop, $event)"
    >
      <template v-if="getIcon(prop.key, prop.value) as string">
        <span class="property-icon">
          <Icon 
            v-if="isSvgIcon(getIcon(prop.key, prop.value) as string)"
            :name="getIcon(prop.key, prop.value) as string"
            :size="18"
          />
          <span v-else>{{ getIcon(prop.key, prop.value) as string }}</span>
        </span>
        <span
          v-if="
            propertyStore.getPropertyDef(prop.key)?.displayStyle !== 'icon'
          "
          class="property-label"
        >
          {{ getLabel(prop.key, prop.value) }}
        </span>
      </template>
      <template v-else>
        <span>{{ getLabel(prop.key, prop.value) }}</span>
      </template>
      <button
        v-if="position === 'right-of-content' && hoveredPropertyId === prop.id"
        class="delete-button"
        @click.stop="deleteProperty(prop, $event)"
        title="删除属性"
      >
        ×
      </button>
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
  padding-right: 20px;
  transition: background 120ms ease;
  font-size: var(--text-sm);
  position: relative;
  /* 确保内部所有元素的基线对齐 */
  line-height: var(--leading-normal);
}

.property-inline-item.built-in {
  font-weight: var(--font-medium);
}

.property-inline-item.icon-only {
  padding: 2px 0;
  padding-right: 0;
}

.property-inline-item.icon-only .property-icon {
  margin-right: 0;
  font-size: var(--text-lg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.property-inline-item:hover {
  transform: scale(1.15);
}

.property-icon {
  margin-right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 确保 icon 和文本的垂直对齐 */
  line-height: var(--leading-none);
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
