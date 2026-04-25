// composables/useJournal.ts
import { ref, computed } from 'vue'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'
import type { Page } from '../types/page'

// 判断 Page 是否为日记（标题符合日期格式 YYYY-MM-DD）
function isJournalPage(page: Page): boolean {
  // return /^\d{4}-\d{2}-\d{2}$/.test(page.title)
  return page.type === 'journal'
}

export function useJournal() {
  const pageStore = usePageStore()
  const blockStore = useBlockStore()
  const isOpen = ref(false)  // 日记列表 Panel 展开状态

  // ===== Session 级状态 =====
  // App 运行时标记：今天是否已处理过创建检查
  // 关闭 APP 后重开，状态重置，符合"首次访问"直觉
  const createdTodayThisSession = ref(false)

  // ===== readOnly 模式 =====
  // 当前打开的日记是否为只读（过往日记）
  const isReadOnly = ref(false)

  // 今天的日期字符串（YYYY-MM-DD）
  const today = computed(() => {
    return new Date().toISOString().slice(0, 10)
  })

  // 所有日记 Page（按日期倒序）
  const journalPages = computed(() => {
    return pageStore.pages
      .filter(isJournalPage)
      .sort((a, b) => b.title.localeCompare(a.title))  // 日期倒序
  })

  // 今天的日记是否已存在
  const todayJournalExists = computed(() => {
    return journalPages.value.some(p => p.title === today.value)
  })

  // 打开日记列表 Panel（同时确保今天日记存在）
  async function openJournalList() {
    // 确保今天日记存在（不存在则自动创建）
    if (!todayJournalExists.value) {
      await ensureTodayJournalExists()
    }
    isOpen.value = true
  }

  // 确保今天的日记页面存在（若不存在则创建）
  async function ensureTodayJournalExists(): Promise<void> {
    const existing = journalPages.value.find(p => p.title === today.value)
    if (existing) return

    const newPage = await pageStore.createPage(today.value)
    await blockStore.createBlock({
      pageId: newPage.id,
      content: today.value,
      parentId: null,
    })
  }

  // 关闭日记列表 Panel
  function closeJournalList() {
    isOpen.value = false
  }

  // 打开指定日记（若不存在则创建，仅当天可写）
  async function openJournal(pageId: string) {
    const page = pageStore.getPage(pageId)
    if (!page) return

    const isToday = page.title === today.value

    // 设置 readOnly 模式：过往日记不可编辑
    isReadOnly.value = !isToday

    // 今天 → 可编辑 | 过往 → 只读（仍打开，但不进入编辑状态）
    await pageStore.openPage(pageId)

    closeJournalList()
  }

  // 打开今天的日记（若不存在则先创建）
  async function openOrCreateTodayJournal() {
    try {
      await ensureTodayJournalExists()
      const todayPage = journalPages.value.find(p => p.title === today.value)
      if (todayPage) {
        await pageStore.openPage(todayPage.id)
        closeJournalList()
      }
    } catch (error) {
      console.error('打开今日日记失败:', error)
    }
  }

  // 检查并确保今天日记存在（Session 级，只触发一次）
  async function checkAndEnsureTodayJournal() {
    if (createdTodayThisSession.value) return  // 已处理过
    createdTodayThisSession.value = true

    if (!todayJournalExists.value) {
      await ensureTodayJournalExists()
    }
  }

  // 兼容旧名称
  const checkAndOpenOrCreateTodayJournal = checkAndEnsureTodayJournal

  return {
    isOpen: computed(() => isOpen.value),
    isReadOnly: computed(() => isReadOnly.value),
    today,
    journalPages,
    todayJournalExists,
    openJournalList,
    closeJournalList,
    openJournal,
    openOrCreateTodayJournal,
    checkAndEnsureTodayJournal,
    checkAndOpenOrCreateTodayJournal,
  }
}