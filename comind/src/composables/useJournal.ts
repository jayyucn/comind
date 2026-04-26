// composables/useJournal.ts
import { ref, computed } from 'vue'
import { format, isSameDay } from 'date-fns'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'
import type { Page } from '../types/page'
import { parseToDate } from '../utils/journal-detect'

// 判断 Page 是否为日记（信任持久化 type 字段）
function isJournalPage(page: Page): boolean {
  return page.type === 'journal'
}

export function useJournal() {
  const pageStore = usePageStore()
  const blockStore = useBlockStore()

  // ===== Session 级状态 =====
  // App 运行时标记：今天是否已处理过创建检查
  // 关闭 APP 后重开，状态重置，符合“首次访问”直觉
  const createdTodayThisSession = ref(false)

  // ===== readOnly 模式 =====
  // 当前打开的日记是否为只读（过往日记）
  const isReadOnly = ref(false)

  // 今天的日期字符串（yyyy-MM-dd，本地时区）
  const today = computed(() => {
    return format(new Date(), 'yyyy-MM-dd')
  })

  // 所有日记 Page（按日期倒序）
  // 规范化后标题统一为 yyyy-MM-dd，localeCompare 即可正确排序
  const journalPages = computed(() => {
    return pageStore.pages
      .filter(isJournalPage)
      .sort((a, b) => b.title.localeCompare(a.title))
  })

  // 判断某 Page title 是否为今天
  // 规范化后标题都是 yyyy-MM-dd，但用 parseToDate + isSameDay 更健壮（兼容旧数据）
  const isTodayTitle = (title: string): boolean => {
    const parsed = parseToDate(title)
    return parsed !== null && isSameDay(parsed, new Date())
  }

  // 今天的日记是否已存在
  const todayJournalExists = computed(() => {
    return journalPages.value.some(p => isTodayTitle(p.title))
  })

  // 确保今天的日记页面存在（若不存在则创建）
  async function ensureTodayJournalExists(): Promise<void> {
    const existing = journalPages.value.find(p => isTodayTitle(p.title))
    if (existing) return

    const newPage = await pageStore.createPage(today.value, 'journal')
    await blockStore.loadPageBlocks(newPage.id)
  }

  // 打开指定日记（仅当天可写）
  async function openJournal(pageId: string) {
    const page = pageStore.getPage(pageId)
    if (!page) return

    // 设置 readOnly 模式：过往日记不可编辑
    isReadOnly.value = !isTodayTitle(page.title)

    await pageStore.openPage(pageId)
  }

  // 检查并确保今天日记存在（Session 级，只触发一次）
  async function checkAndEnsureTodayJournal() {
    if (createdTodayThisSession.value) return
    createdTodayThisSession.value = true

    if (!todayJournalExists.value) {
      await ensureTodayJournalExists()
    }
  }

  // 兼容旧名称
  const checkAndOpenOrCreateTodayJournal = checkAndEnsureTodayJournal

  return {
    isReadOnly: computed(() => isReadOnly.value),
    today,
    journalPages,
    todayJournalExists,
    openJournal,
    checkAndEnsureTodayJournal,
    checkAndOpenOrCreateTodayJournal,
    ensureTodayJournalExists,
  }
}