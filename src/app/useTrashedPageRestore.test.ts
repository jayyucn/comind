import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive, nextTick } from 'vue'

const blockStore = reactive<{
  trashedPageWarnings: string[]
  clearTrashedPageWarnings: ReturnType<typeof vi.fn>
}>({
  trashedPageWarnings: [],
  clearTrashedPageWarnings: vi.fn(),
})
const pageStore = {
  pages: [] as Array<{ title: string; deleted: boolean; id: string }>,
  restorePage: vi.fn(() => Promise.resolve()),
}

vi.mock('../stores/blocks', () => ({ useBlockStore: () => blockStore }))
vi.mock('../stores/pages', () => ({ usePageStore: () => pageStore }))

import { useTrashedPageRestore } from './useTrashedPageRestore'

beforeEach(() => {
  blockStore.trashedPageWarnings = []
  blockStore.clearTrashedPageWarnings.mockClear()
  pageStore.pages = []
  pageStore.restorePage.mockClear()
})

describe('useTrashedPageRestore', () => {
  it('warnings 非空 → visible + pageTitle', async () => {
    const { visible, pageTitle } = useTrashedPageRestore()
    blockStore.trashedPageWarnings = ['Old Page']
    await nextTick()
    expect(visible.value).toBe(true)
    expect(pageTitle.value).toBe('Old Page')
  })

  it('confirm → restorePage + clearTrashedPageWarnings', async () => {
    const { visible, confirm } = useTrashedPageRestore()
    blockStore.trashedPageWarnings = ['Old Page']
    pageStore.pages = [{ title: 'Old Page', deleted: true, id: 'p1' }]
    await nextTick()
    await confirm()
    expect(pageStore.restorePage).toHaveBeenCalledWith('p1')
    expect(blockStore.clearTrashedPageWarnings).toHaveBeenCalled()
    expect(visible.value).toBe(false)
  })

  it('cancel → clearTrashedPageWarnings', async () => {
    const { cancel } = useTrashedPageRestore()
    blockStore.trashedPageWarnings = ['X']
    await nextTick()
    cancel()
    expect(blockStore.clearTrashedPageWarnings).toHaveBeenCalled()
  })
})
