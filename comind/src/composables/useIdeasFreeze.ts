// composables/useIdeasFreeze.ts
import { computed, type Ref } from 'vue'
import { usePageStore } from '../stores/pages'
import { parse, isValid, isSameDay} from 'date-fns'

/**
 * 预定义日记日期格式列表
 * 仅用于检测（isJournalTitle / parseToDate / normalizeJournalTitle），
 * 不用于创建——创建时统一用 yyyy-MM-dd 规范格式
 */
const JOURNAL_FORMATS = [
  'yyyy-MM-dd',       // 2026-04-26（最常见，也是存储规范格式）
  'yyyy/MM/dd',       // 2026/04/26
  'yyyy_MM_dd',       // 2026_04_26
  'MMM do, yyyy',     // Apr 26th, 2026
  'EEEE, MMMM do, yyyy', // Saturday, April 26th, 2026
  'MM/dd/yyyy',       // 04/26/2026
  'dd.MM.yyyy',       // 26.04.2026
  'yyyy年M月d日',      // 2026年4月26日
] as const

/**
 * 尝试将标题解析为 Date（返回 null 表示不是有效日期）
 * 用 format 列表逐个尝试解析
 */
function parseToDate(title: string): Date | null {
  const trimmed = title.trim()
  if (!trimmed) return null
  for (const fmt of JOURNAL_FORMATS) {
    const parsed = parse(trimmed, fmt, new Date())
    if (isValid(parsed)) return parsed
  }
  return null
}

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