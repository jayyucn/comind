<script setup lang="ts">
import { Check, PencilLine, RefreshCw } from 'lucide-vue-next'

import {
  WEB_LINK_VIEW_LABELS,
  WEB_LINK_VIEWS,
  type WebLinkView,
} from '../../../../utils/web-link'
import BlockMenuItem from '../../../common/BlockMenuItem.vue'

/**
 * 网页链接块的**类型专属菜单项**（ADR-0066 D10）：四视图切换 | 编辑链接 | 重新获取。
 *
 * 菜单宿主是 Block 外壳一层（ADR-0039 D9），所以这里只上报意图，不关菜单。
 * 与悬停浮出的「显示为」面板是同一组能力的两条入口：菜单常驻可发现，
 * 面板贴着手（贴飞书手感）。
 */
defineProps<{ view: WebLinkView }>()

const emit = defineEmits<{
  (e: 'select', view: WebLinkView): void
  (e: 'edit'): void
  (e: 'refetch'): void
}>()
</script>

<template>
  <BlockMenuItem
    v-for="item in WEB_LINK_VIEWS"
    :key="item"
    :data-block-menu-item="`view-${item}`"
    :label="`显示为${WEB_LINK_VIEW_LABELS[item]}`"
    @click="emit('select', item)"
  >
    <template #trailing>
      <Check
        v-if="view === item"
        :size="13"
      />
    </template>
  </BlockMenuItem>
  <BlockMenuItem
    data-block-menu-item="web-link-edit"
    :icon="PencilLine"
    label="编辑链接"
    @click="emit('edit')"
  />
  <BlockMenuItem
    data-block-menu-item="web-link-refetch"
    :icon="RefreshCw"
    label="重新获取网页信息"
    @click="emit('refetch')"
  />
</template>
