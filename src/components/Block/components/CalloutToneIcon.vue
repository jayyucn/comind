<script setup lang="ts">
import { computed } from 'vue'

import type { CalloutTone } from '../../../utils/callout'
import { CALLOUT_TONE_ICONS } from '../../../utils/callout'

/**
 * 高亮块的语义字形 —— 语义与图标**一一固定**，不开放自定义（映射单源在
 * `utils/callout.ts` 的 `CALLOUT_TONE_ICONS`，入口胶囊字形也读同一份）。
 *
 * 用法两处：块内那个可点的语义图标、切换语义的浮层里的四个选项 —— 同一份映射，
 * 避免「选的图标」与「显示出来的图标」对不上。
 */
const props = withDefaults(
  defineProps<{
    tone: CalloutTone
    size?: number
  }>(),
  { size: 15 },
)

const icon = computed(() => CALLOUT_TONE_ICONS[props.tone])
</script>

<template>
  <component
    :is="icon"
    :size="size"
    :stroke-width="2"
  />
</template>
