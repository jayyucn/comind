<script setup lang="ts">
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Calendar,
  Droplet,
  Folder,
  History,
  Highlighter,
  Link,
  Maximize2,
  Menu,
  Minus,
  Network,
  PanelLeft,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  Square,
  Star,
  Tag,
  Trash,
  Trash2,
  Undo2,
  X
} from 'lucide-vue-next'
import { computed, defineComponent, h } from 'vue'
import type { Component } from 'vue'
import StatusArchived from './StatusIcons/StatusArchived.vue'
import StatusCanceled from './StatusIcons/StatusCanceled.vue'
import StatusDoing from './StatusIcons/StatusDoing.vue'
import StatusDone from './StatusIcons/StatusDone.vue'
import StatusTodo from './StatusIcons/StatusTodo.vue'
import PriorityQuadrant from './PriorityIcons/PriorityQuadrant.vue'

const STATUS_ICONS: Record<string, Component> = {
  'status-todo': StatusTodo,
  'status-doing': StatusDoing,
  'status-done': StatusDone,
  'status-canceled': StatusCanceled,
  'status-archived': StatusArchived,
}

/**
 * 状态图标默认语义色：形状为主、颜色为辅。
 * 复用项目既有 token（零新增变量），CSS 变量自动跟随明暗主题。
 * 调用处若显式传 `color` 则覆盖此默认值。
 */
const STATUS_DEFAULT_COLORS: Record<string, string> = {
  'status-todo': 'var(--text-tertiary)',
  'status-doing': 'var(--accent)',
  'status-done': 'var(--success)',
  'status-canceled': 'var(--error)',
  'status-archived': 'var(--text-secondary)',
}

/**
 * 优先级图标（ADR-0054 D3）：统一图元 = 2×2 象限方格，四档仅点亮格不同。
 *
 * 旧实现（ArrowDown / Minus / ArrowUp / AlertTriangle）与 Jira 旧图标同类
 * —— 前三个同属横线族、仅靠长度与方向微差分档，在小尺寸与色觉障碍下并档。
 *
 * 点亮格即象限位置，**位置本身携带语义**，读者无需记图例。
 *
 * 轴向（ADR-0054 D1）：**横轴 = 紧急（向右递增）、纵轴 = 重要（向上递增）**
 * —— 与 `QuadrantView` 的网格布局同一套读法（同一字段禁止两种轴向）：
 *   Urgent  重要且紧急 → 右上
 *   Medium  重要但不紧急 → 左上
 *   High    不重要但紧急 → 右下
 *   Low     不重要且不紧急 → 左下
 */
const PRIORITY_QUADRANT: Record<string, 'tl' | 'tr' | 'bl' | 'br'> = {
  'priority-urgent': 'tr',
  'priority-medium': 'tl',
  'priority-high': 'br',
  'priority-low': 'bl',
}

/**
 * 按档位包装象限网格图标。
 *
 * ⚠️ 必须透传 attrs：`h()` 的第二个参数是**硬编码 props**，`color` / `size` /
 * strokeWidth 等由本组件模板通过 attrs 传入，若不展开就会丢失 —— 表现为
 * priority 图标退回 `currentColor`（文字色），四档看起来没有对应颜色。
 */
function priorityIcon(key: string): Component {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs }) {
      return () => h(PriorityQuadrant, { ...attrs, quadrant: PRIORITY_QUADRANT[key] })
    },
  })
}

const PRIORITY_ICONS: Record<string, Component> = {
  'priority-low': priorityIcon('priority-low'),
  'priority-medium': priorityIcon('priority-medium'),
  'priority-high': priorityIcon('priority-high'),
  'priority-urgent': priorityIcon('priority-urgent'),
}

/**
 * 优先级图标默认语义色：点承载颜色通道（--priority-*-fg），
 * 使斜杠命令面板与快捷属性菜单里的四档一眼可辨。
 * 调用处若显式传 `color` 则覆盖此默认值。
 */
const PRIORITY_DEFAULT_COLORS: Record<string, string> = {
  'priority-low': 'var(--priority-low-fg)',
  'priority-medium': 'var(--priority-medium-fg)',
  'priority-high': 'var(--priority-high-fg)',
  'priority-urgent': 'var(--priority-urgent-fg)',
}

const GENERAL_ICONS: Record<string, Component> = {
  'icon-calendar': Calendar,
  'icon-tag': Tag,
  'icon-folder': Folder,
  'icon-network': Network,
  'icon-link': Link,
  'icon-menu': Menu,
  'icon-star': Star,
  'icon-star-filled': Star,
  'icon-trash': Trash,
  'icon-trash2': Trash2,
  'icon-trash-permanent': Trash2,
  'icon-restore': Undo2,
  'icon-settings': Settings,
  'icon-arrow-right': ArrowRight,
  'icon-arrow-left': ArrowLeft,
  'icon-panel-left': PanelLeft,
  'icon-panel-left-close': PanelLeftClose,
  'icon-panel-left-open': PanelLeft,
  'icon-panel-right-open': PanelRightOpen,
  'icon-panel-right-close': PanelRightClose,
  'icon-minimize': Minus,
  'icon-square': Square,
  'icon-maximize': Maximize2,
  'icon-close': X,
  'icon-droplet': Droplet,
  'icon-bell': Bell,
  'icon-search': Search,
  'icon-history': History,
  'icon-highlighter': Highlighter,
}

const ALL_ICONS = { ...STATUS_ICONS, ...PRIORITY_ICONS, ...GENERAL_ICONS }

const props = defineProps<{
  name: string
  size?: number
  color?: string
  strokeWidth?: number
  /** 状态图标的容器形状，默认方（由 StatusIcons 组件的默认值决定）；传 'round' 切圆形 */
  shape?: 'round' | 'square'
}>()

const iconComponent = computed(() => ALL_ICONS[props.name])

const isFilled = computed(() => props.name === 'icon-star-filled')

// shape 仅状态图标消费，不透传给 lucide 组件以免落到多余 DOM 属性上
const isStatusIcon = computed(() => props.name in STATUS_ICONS)

/** 未显式传 color 时：status / priority 按 name 注入语义色，其余图标回退到文本主色 */
const resolvedColor = computed(() => {
  if (props.color) return props.color
  if (isStatusIcon.value) return STATUS_DEFAULT_COLORS[props.name] ?? 'var(--text-primary)'
  return PRIORITY_DEFAULT_COLORS[props.name] ?? 'var(--text-primary)'
})
</script>

<template>
  <component
    :is="iconComponent"
    v-if="iconComponent"
    :size="size || 24"
    :color="resolvedColor"
    :stroke-width="strokeWidth ?? 2"
    v-bind="isStatusIcon ? { shape } : {}"
    :style="isFilled ? { fill: resolvedColor } : {}"
  />
</template>
