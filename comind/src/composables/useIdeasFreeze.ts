// composables/useIdeasFreeze.ts
import { computed, type Ref } from 'vue'
import { usePageStore } from '../stores/pages'
import { parseToDate } from '../utils/journal-detect'
import { isSameDay } from 'date-fns'

/**
 * 判断指定页面是否为冻结状态（非今日的 ideas 页面只读）
 *
 * 冻结规则：
 * - 页面类型为 'ideas'
 * - 且页面标题不是今天
 *
 * @param pageIdRef - 页面 ID 的 ref（可选）。若未提供则始终返回未冻结。
 *                    BlockList / Block 等组件应传入 props.pageId。
 */
export function useIdeasFreeze(pageIdRef?: Ref<string> | string) {
  const pageStore = usePageStore()

  // 当前页面
  const currentPage = computed(() => {
    const pageId = typeof pageIdRef === 'string' ? pageIdRef : pageIdRef?.value
    if (!pageId) return null
    return pageStore.getPage(pageId) ?? pageStore.getPageByTitle(pageId)
  })

  // 是否为 ideas 页面
  const isIdeasPage = computed(() => {
    return currentPage.value?.type === 'ideas'
  })

  // 是否为今日
  const isToday = computed(() => {
    if (!currentPage.value) return false
    const parsed = parseToDate(currentPage.value.title)
    return parsed !== null && isSameDay(parsed, new Date())
  })

  // 是否冻结（只读）
  const isFrozen = computed(() => {
    return isIdeasPage.value && !isToday.value
  })

  return {
    currentPage,
    isIdeasPage,
    isToday,
    isFrozen,
  }
}
