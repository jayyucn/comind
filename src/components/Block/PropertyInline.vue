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

/** status 单击循环顺序；环外值（Canceled / Archived 等）一律回到首个 */
const STATUS_CYCLE = ['Todo', 'Doing', 'Done'] as const
const LONG_PRESS_MS = 500

let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressHandled = false

function clearLongPress() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

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

/** 打开属性编辑菜单：内置属性走快捷菜单，自定义属性走完整属性编辑器 */
function openMenu(prop: Property, rect: DOMRect) {
  if (isBuiltIn(prop.key)) {
    editorStore.showQuickPropertyEditor(props.blockId, prop.key, {
      x: rect.left,
      y: rect.bottom + 4
    })
  } else {
    editorStore.showPropertyEditor(props.blockId, prop.key)
  }
}

/** status 专用：Todo → Doing → Done → Todo 循环，直接落库，不弹菜单 */
function cycleStatus(prop: Property) {
  const idx = STATUS_CYCLE.indexOf(prop.value as (typeof STATUS_CYCLE)[number])
  const next = idx === -1 ? STATUS_CYCLE[0] : STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
  void propertyStore.setProperty(props.blockId, prop.key, next, 'string')
}

function onPointerDown(prop: Property, event: PointerEvent) {
  clearLongPress()
  longPressHandled = false
  if (event.button !== 0) return
  // currentTarget 在 setTimeout 回调里已被置空，必须同步取 rect
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    longPressHandled = true
    openMenu(prop, rect)
  }, LONG_PRESS_MS)
}

function onClick(prop: Property, event: MouseEvent) {
  clearLongPress()
  // 长按已弹过菜单，吞掉随后的 click
  if (longPressHandled) {
    longPressHandled = false
    return
  }
  if (prop.key === 'status') {
    cycleStatus(prop)
    return
  }
  openMenu(prop, (event.currentTarget as HTMLElement).getBoundingClientRect())
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
      @pointerdown="onPointerDown(prop, $event)"
      @pointerup="clearLongPress"
      @pointerleave="clearLongPress"
      @pointercancel="clearLongPress"
      @click.stop="onClick(prop, $event)"
    >
      <template v-if="getIcon(prop.key, prop.value) as string">
        <span class="property-icon">
          <Icon
            v-if="isSvgIcon(getIcon(prop.key, prop.value) as string)"
            :name="getIcon(prop.key, prop.value) as string"
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
