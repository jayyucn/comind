import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive } from 'vue'
import { format } from 'date-fns'

// Mock the page store; useIdeas delegates all persistence to it.
// We wrap the store in `reactive` so the computeds in useIdeas
// (which read `pageStore.pages.filter(...)`) re-run whenever the
// `pages` array is replaced.
const mockPageStore = reactive({
  pages: [] as any[],
  currentPageId: '',
  openPage: vi.fn(async (id: string) => {
    mockPageStore.currentPageId = id
  }),
  createPage: vi.fn(),
  loadAllPages: vi.fn(async () => {}),
  getPageByTitle: vi.fn(),
})

vi.mock('../stores/pages', () => ({
  usePageStore: () => mockPageStore,
}))

import { useIdeas } from './useIdeas'

function makePage(overrides: Partial<{
  id: string
  title: string
  type: 'normal' | 'ideas' | 'journal'
  updatedAt: number
  deleted: boolean
}> = {}) {
  return {
    id: overrides.id ?? `page-${Math.random().toString(36).slice(2)}`,
    title: overrides.title ?? 'Untitled',
    type: overrides.type ?? 'normal',
    updatedAt: overrides.updatedAt ?? Date.now(),
    deleted: overrides.deleted ?? false,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockPageStore.pages = []
  mockPageStore.currentPageId = ''
  mockPageStore.openPage.mockClear()
  mockPageStore.createPage.mockReset()
  mockPageStore.loadAllPages.mockClear()
  mockPageStore.getPageByTitle.mockReset()
})

describe('useIdeas', () => {

  // ===============================================================
  // today
  // ===============================================================
  describe('today', () => {
    test('returns today as yyyy-MM-dd in local time', () => {
      const { today } = useIdeas()
      expect(today.value).toBe(format(new Date(), 'yyyy-MM-dd'))
    })
  })

  // ===============================================================
  // ideasPages
  // ===============================================================
  describe('ideasPages', () => {
    test('includes pages with type="ideas"', () => {
      const idea = makePage({ id: 'p1', type: 'ideas' })
      const normal = makePage({ id: 'p2', type: 'normal' })
      mockPageStore.pages = [idea, normal]
      const { ideasPages } = useIdeas()
      expect(ideasPages.value.map(p => p.id)).toEqual(['p1'])
    })

    test('includes pages with legacy type="journal" for back-compat', () => {
      const legacy = makePage({ id: 'p1', type: 'journal' as any })
      mockPageStore.pages = [legacy]
      const { ideasPages } = useIdeas()
      expect(ideasPages.value.map(p => p.id)).toEqual(['p1'])
    })

    test('excludes normal-type pages', () => {
      const a = makePage({ id: 'a', type: 'normal' })
      const b = makePage({ id: 'b', type: 'normal' })
      mockPageStore.pages = [a, b]
      const { ideasPages } = useIdeas()
      expect(ideasPages.value).toEqual([])
    })

    test('sorts by title in descending (newest date first)', () => {
      const today = format(new Date(), 'yyyy-MM-dd')
      const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd')
      const lastWeek = format(new Date(Date.now() - 6 * 86400000), 'yyyy-MM-dd')
      mockPageStore.pages = [
        makePage({ id: 'lastWeek', title: lastWeek, type: 'ideas' }),
        makePage({ id: 'today', title: today, type: 'ideas' }),
        makePage({ id: 'yesterday', title: yesterday, type: 'ideas' }),
      ]
      const { ideasPages } = useIdeas()
      expect(ideasPages.value.map(p => p.id)).toEqual(['today', 'yesterday', 'lastWeek'])
    })
  })

  // ===============================================================
  // todayIdeasExists (also exercises the private isTodayTitle logic
  // — canonical yyyy-MM-dd, alternate parseable formats, yesterday,
  // and non-date strings)
  // ===============================================================
  describe('todayIdeasExists', () => {
    test('true for canonical yyyy-MM-dd of today', () => {
      mockPageStore.pages = [
        makePage({ id: 'today', title: format(new Date(), 'yyyy-MM-dd'), type: 'ideas' }),
      ]
      expect(useIdeas().todayIdeasExists.value).toBe(true)
    })

    test('true for non-canonical but parseable today title (yyyy/MM/dd)', () => {
      mockPageStore.pages = [
        makePage({ id: 'today', title: format(new Date(), 'yyyy/MM/dd'), type: 'ideas' }),
      ]
      expect(useIdeas().todayIdeasExists.value).toBe(true)
    })

    test('false for yesterday', () => {
      const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd')
      mockPageStore.pages = [makePage({ id: 'y', title: yesterday, type: 'ideas' })]
      expect(useIdeas().todayIdeasExists.value).toBe(false)
    })

    test('false for non-date titles', () => {
      mockPageStore.pages = [makePage({ id: 'x', title: 'My Note', type: 'ideas' })]
      expect(useIdeas().todayIdeasExists.value).toBe(false)
    })

    test('false for empty title', () => {
      mockPageStore.pages = [makePage({ id: 'x', title: '', type: 'ideas' })]
      expect(useIdeas().todayIdeasExists.value).toBe(false)
    })
  })

  // ===============================================================
  // ensureTodayIdeasExists
  // ===============================================================
  describe('ensureTodayIdeasExists', () => {
    test('opens the existing today ideas page instead of creating', async () => {
      const today = format(new Date(), 'yyyy-MM-dd')
      const existing = makePage({ id: 'today-1', title: today, type: 'ideas' })
      mockPageStore.pages = [existing]
      mockPageStore.createPage.mockResolvedValue(existing)

      await useIdeas().ensureTodayIdeasExists()

      expect(mockPageStore.createPage).not.toHaveBeenCalled()
      expect(mockPageStore.openPage).toHaveBeenCalledWith('today-1')
    })

    test('creates a new ideas page with today title and opens it', async () => {
      const today = format(new Date(), 'yyyy-MM-dd')
      const newPage = makePage({ id: 'new', title: today, type: 'ideas' })
      mockPageStore.createPage.mockResolvedValue(newPage)

      await useIdeas().ensureTodayIdeasExists()

      expect(mockPageStore.createPage).toHaveBeenCalledWith(today, 'ideas')
      expect(mockPageStore.openPage).toHaveBeenCalledWith('new')
    })

    test('falls back to opening the existing page if createPage fails but page appears concurrently', async () => {
      const today = format(new Date(), 'yyyy-MM-dd')
      // Simulate the race: while we tried to create, the page already appeared
      // in the store (e.g. another tab created it). createPage then throws.
      const newPage = makePage({ id: 'concurrent', title: today, type: 'ideas' })
      mockPageStore.createPage.mockImplementation(async () => {
        mockPageStore.pages = [newPage]
        throw new Error('Duplicate page')
      })

      await useIdeas().ensureTodayIdeasExists()

      // Recovery path: opens the page that appeared, doesn't propagate the error
      expect(mockPageStore.openPage).toHaveBeenCalledWith('concurrent')
    })
  })

  // ===============================================================
  // checkAndEnsureTodayIdeas
  // ===============================================================
  describe('checkAndEnsureTodayIdeas', () => {
    test('creates today page when none exists', async () => {
      const today = format(new Date(), 'yyyy-MM-dd')
      const newPage = makePage({ id: 'new', title: today, type: 'ideas' })
      mockPageStore.createPage.mockResolvedValue(newPage)

      await useIdeas().checkAndEnsureTodayIdeas()

      expect(mockPageStore.loadAllPages).toHaveBeenCalledTimes(1)
      expect(mockPageStore.createPage).toHaveBeenCalledWith(today, 'ideas')
    })

    test('does not create when today page already exists', async () => {
      const today = format(new Date(), 'yyyy-MM-dd')
      mockPageStore.pages = [makePage({ id: 'today', title: today, type: 'ideas' })]

      await useIdeas().checkAndEnsureTodayIdeas()

      expect(mockPageStore.loadAllPages).toHaveBeenCalledTimes(1)
      expect(mockPageStore.createPage).not.toHaveBeenCalled()
    })

    test('does not call createPage again if a previous check has run on the same composable instance', async () => {
      const today = format(new Date(), 'yyyy-MM-dd')
      const newPage = makePage({ id: 'new', title: today, type: 'ideas' })
      mockPageStore.createPage.mockResolvedValue(newPage)

      const { checkAndEnsureTodayIdeas } = useIdeas()

      // First call creates
      await checkAndEnsureTodayIdeas()
      expect(mockPageStore.createPage).toHaveBeenCalledTimes(1)
      expect(mockPageStore.loadAllPages).toHaveBeenCalledTimes(1)

      // Second call on the SAME instance must short-circuit
      await checkAndEnsureTodayIdeas()
      expect(mockPageStore.createPage).toHaveBeenCalledTimes(1)
      expect(mockPageStore.loadAllPages).toHaveBeenCalledTimes(1)
    })
  })
})
