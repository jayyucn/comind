<script setup lang="ts">
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
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
import { computed } from 'vue'
import StatusArchived from './StatusIcons/StatusArchived.vue'
import StatusCanceled from './StatusIcons/StatusCanceled.vue'
import StatusDoing from './StatusIcons/StatusDoing.vue'
import StatusDone from './StatusIcons/StatusDone.vue'
import StatusTodo from './StatusIcons/StatusTodo.vue'

const STATUS_ICONS: Record<string, any> = {
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

const PRIORITY_ICONS: Record<string, any> = {
  'priority-low': ArrowDown,
  'priority-medium': Minus,
  'priority-high': ArrowUp,
  'priority-urgent': AlertTriangle,
}

/**
 * 优先级图标默认语义色：与 block 底色 / 左侧色条共用同一组 --priority-*-fg，
 * 使斜杠命令面板与快捷属性菜单里的四档一眼可辨。
 * 调用处若显式传 `color` 则覆盖此默认值。
 */
const PRIORITY_DEFAULT_COLORS: Record<string, string> = {
  'priority-low': 'var(--priority-low-fg)',
  'priority-medium': 'var(--priority-medium-fg)',
  'priority-high': 'var(--priority-high-fg)',
  'priority-urgent': 'var(--priority-urgent-fg)',
}

const GENERAL_ICONS: Record<string, any> = {
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
