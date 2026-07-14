<script setup lang="ts">
import { computed } from 'vue'
import {
  Circle,
  Loader,
  CheckCircle2,
  XCircle,
  ArrowDown,
  Minus,
  ArrowUp,
  AlertTriangle,
  Calendar,
  Tag,
  Folder,
  Link,
  Menu,
  Star,
  Trash2,
  Undo2,
  Settings,
  ArrowRight,
  ArrowLeft,
  PanelLeft,
  PanelLeftClose,
  PanelRightOpen,
  PanelRightClose,
  Maximize2,
  Square,
  X,
  Trash,
  Droplet
} from 'lucide-vue-next'

const STATUS_ICONS: Record<string, any> = {
  'status-todo': Circle,
  'status-doing': Loader,
  'status-done': CheckCircle2,
  'status-canceled': XCircle,
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
}

const ALL_ICONS = { ...STATUS_ICONS, ...PRIORITY_ICONS, ...GENERAL_ICONS }

const props = defineProps<{
  name: string
  size?: number
  color?: string
  strokeWidth?: number
}>()

const iconComponent = computed(() => ALL_ICONS[props.name])

const isFilled = computed(() => props.name === 'icon-star-filled')
</script>

<template>
  <component
    :is="iconComponent"
    v-if="iconComponent"
    :size="size || 16"
    :color="color"
    :stroke-width="strokeWidth ?? 2"
    :style="isFilled ? { fill: color || 'currentColor' } : {}"
  />
</template>
