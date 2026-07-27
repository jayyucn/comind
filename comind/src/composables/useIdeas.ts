// composables/useIdeas.ts
import { ref, computed } from 'vue'
import { format, isSameDay } from 'date-fns'
import { usePageStore } from '../stores/pages'
import type { Page } from '../types/page'
import { parseToDate } from '../utils/journal-detect'

// 判断 Page 是否为点滴
// 兼容旧数据：'journal'（旧 type 值）与 'ideas' 均视为点滴
function isIdeasPage(page: Page): boolean {
  return page.type === 'ideas' || (page as any).type === 'journal'
}

export function useIdeas() {
  const pageStore = usePageStore()

  // ===== Session 级状态 =====
  // App 运行时标记：今天是否已处理过创建检查
  // 关闭 APP 后重开，状态重置，符合"首次访问"直觉
  const createdTodayThisSession = ref(false)

  // 今天的日期字符串（yyyy-MM-dd，本地时区）
  const today = computed(() => {
    return format(new Date(), 'yyyy-MM-dd')
  })

  // 所有点滴 Page（按日期倒序）
  // 规范化后标题统一为 yyyy-MM-dd，localeCompare 即可正确排序
  const ideasPages = computed(() => {
    return pageStore.pages
      .filter(isIdeasPage)
      .sort((a, b) => b.title.localeCompare(a.title))
  })

  // 判断某 Page title 是否为今天
  // 规范化后标题都是 yyyy-MM-dd，但用 parseToDate + isSameDay 更健壮（兼容旧数据）
  const isTodayTitle = (title: string): boolean => {
    const parsed = parseToDate(title)
    return parsed !== null && isSameDay(parsed, new Date())
  }

  // 今天的点滴是否已存在
  const todayIdeasExists = computed(() => {
    return ideasPages.value.some(p => isTodayTitle(p.title))
  })

  // 确保今天的点滴页面存在（若不存在则创建）
  async function ensureTodayIdeasExists(): Promise<void> {
    const existing = ideasPages.value.find(p => isTodayTitle(p.title))
    if (existing) {
      await pageStore.openPage(existing.id)
      return
    }

    try {
      const newPage = await pageStore.createPage(today.value, 'ideas')
      await pageStore.openPage(newPage.id)
    } catch (error) {
      const existingAfterError = ideasPages.value.find(p => isTodayTitle(p.title))
      if (existingAfterError) {
        await pageStore.openPage(existingAfterError.id)
      }
    }
  }

  // 检查并确保今天点滴存在（Session 级，只触发一次）
  async function checkAndEnsureTodayIdeas() {
    if (createdTodayThisSession.value) return
    createdTodayThisSession.value = true

    await pageStore.loadAllPages()

    if (!todayIdeasExists.value) {
      await ensureTodayIdeasExists()
    }
  }

  // 兼容旧名称

  return {
    today,
    ideasPages,
    todayIdeasExists,
    checkAndEnsureTodayIdeas,
    ensureTodayIdeasExists,
  }
}
