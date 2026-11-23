<script setup lang="ts">
import { AlertTriangle, Ban, CircleCheck, Info } from 'lucide-vue-next'
import { computed } from 'vue'

import type { CalloutTone } from '../../../utils/callout'

/**
 * 高亮块的语义字形 —— 语义与图标**一一固定**，不开放自定义。
 *
 * 开放换图标会让同一种语义出现四种样子，之后任何按语义扫视（或聚合）都不成立；
 * 语义的辨识成本必须由「固定的形状」承担，颜色只是辅助（暗色四色仍可分，但形状更快）。
 *
 * 用法两处：块内那个可点的语义图标、切换语义的浮层里的四个选项 —— 同一份映射，
 * 避免「选的图标」与「显示出来的图标」对不上。
 */
const ICONS = {
  info: Info,
  warn: AlertTriangle,
  success: CircleCheck,
  danger: Ban,
} as const

const props = withDefaults(
  defineProps<{
    tone: CalloutTone
    size?: number
  }>(),
  { size: 15 },
)

const icon = computed(() => ICONS[props.tone])
</script>

<template>
  <component
    :is="icon"
    :size="size"
    :stroke-width="2"
  />
</template>
