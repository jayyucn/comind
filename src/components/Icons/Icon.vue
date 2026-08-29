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

const PRIORITY_ICONS: Record<string, any> = {
  'priority-low': ArrowDown,
  'priority-medium': Minus,
  'priority-high': ArrowUp,
  'priority-urgent': AlertTriangle,
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
</script>

<template>
  <component
    :is="iconComponent"
    v-if="iconComponent"
    :size="size || 24"
    :color="color || 'var(--text-primary)'"
    :stroke-width="strokeWidth ?? 2"
    v-bind="isStatusIcon ? { shape } : {}"
    :style="isFilled ? { fill: color || 'var(--text-primary)' } : {}"
  />
</template>
