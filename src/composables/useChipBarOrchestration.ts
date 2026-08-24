/**
 * chip-bar 编排（ADR-0022 Q6）——PagesLibrary 与 TaskHub 共享的 9 行编排：
 * 芯片行显隐 + Header 三按钮激活态 + 按钮点击转发。
 *
 * 设计说明：chipbar 的显隐与「toolbar 请求如何处理」的策略已内聚到 QueryChipBar
 * （openToolbarMenu：选中字段后由它自行显示并锚定 popover）。父级只把按钮点击转发给
 * chipBarRef.openToolbarMenu，并通过 visible-change 同步 chipBarVisible 给 QueryToolbar
 * 的描边态；hasFilter/hasSort/hasGroup 仅用于 QueryToolbar 的按钮描边态。
 */
import { computed, ref, useTemplateRef, type ComputedRef } from 'vue'
import QueryChipBar from '../components/query/QueryChipBar.vue'
import type { ViewQuery } from '../core/query'

export function useChipBarOrchestration(viewQuery: ComputedRef<ViewQuery>) {
  // 芯片行显隐（Filter 按钮切换展开/收起）
  const chipBarVisible = ref(false)
  // 模板 ref：消费方模板 <QueryChipBar ref="chipBarRef" .../> 关联（useTemplateRef 声明式绑定）。
  const chipBarRef = useTemplateRef<InstanceType<typeof QueryChipBar>>('chipBarRef')

  // Header 三按钮激活态
  const hasFilter = computed(() => viewQuery.value.filter.children.length > 0)
  const hasSort = computed(() => viewQuery.value.sort.length > 0)
  const hasGroup = computed(() => viewQuery.value.groupBy !== null)

  // Header 三按钮处理（筛选/排序/分组共用）
  function openChipMenu(kind: 'filter' | 'sort' | 'group', e: MouseEvent) {
    chipBarRef.value?.openToolbarMenu(kind, e.currentTarget as HTMLElement)
  }

  return { chipBarVisible, chipBarRef, hasFilter, hasSort, hasGroup, openChipMenu }
}
