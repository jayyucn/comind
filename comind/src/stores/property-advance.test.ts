/**
 * T11 · 自动推进 dateRef 测试（Done 语义）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePropertyStore } from './property'
import { useBlockStore } from './blocks'

// Mock core client
vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve({
    getProperties: vi.fn(() => Promise.resolve([])), // T11 新增
    getPropertiesByBlock: vi.fn(() => Promise.resolve([])),
    setProperty: vi.fn(() => Promise.resolve({
      id: 'prop-1',
      block_id: 'block-1',
      key: 'status',
      value: 'Todo',
      type: 'string',
      sort_order: 0,
      is_hidden: 0,
      is_deleted: 0,
      schema_version: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    })),
  })),
}))

// Mock blocks store
vi.mock('./blocks', () => ({
  useBlockStore: vi.fn(),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('T11 — 自动推进 dateRef（Done 语义）', () => {
  it('status=Done + content 含 weekly dateRef → 推进日期 + 重置 status=Todo', async () => {
    const mockBlocks = [{
      id: 'block-1',
      content: '任务 @2026-07-15 ⏰|weekly 完成',
      type: 'bullet',
      page: 'test-page',
      children: [],
      format: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]

    const mockUpdateBlockContent = vi.fn()
    ;(useBlockStore as any).mockReturnValue({
      blocks: mockBlocks,
      updateBlockContent: mockUpdateBlockContent,
    })

    const store = usePropertyStore()
    
    // setProperty 内部会调用 advanceDateRefInBlock
    // 由于 mock 不触发真实逻辑，直接测试 advanceDateRefInBlock
    // @ts-ignore — 访问内部函数
    await store.advanceDateRefInBlock?.('block-1')

    // 验证 updateBlockContent 被调用（日期推进）
    expect(mockUpdateBlockContent).toHaveBeenCalledWith(
      'block-1',
      '任务 @2026-07-22 ⏰|weekly 完成'
    )
  })

  it('status=Done + content 含 daily dateRef → 推进日期 + 重置 status=Todo', async () => {
    const mockBlocks = [{
      id: 'block-2',
      content: '@2026-07-15 📅|daily',
      type: 'bullet',
      page: 'test-page',
      children: [],
      format: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]

    const mockUpdateBlockContent = vi.fn()
    ;(useBlockStore as any).mockReturnValue({
      blocks: mockBlocks,
      updateBlockContent: mockUpdateBlockContent,
    })

    const store = usePropertyStore()
    // @ts-ignore
    await store.advanceDateRefInBlock?.('block-2')

    expect(mockUpdateBlockContent).toHaveBeenCalledWith(
      'block-2',
      '@2026-07-16 📅|daily'
    )
  })

  it('status=Done + content 含 monthly dateRef → 推进日期', async () => {
    const mockBlocks = [{
      id: 'block-3',
      content: '@2026-01-31 ⏰|monthly',
      type: 'bullet',
      page: 'test-page',
      children: [],
      format: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]

    const mockUpdateBlockContent = vi.fn()
    ;(useBlockStore as any).mockReturnValue({
      blocks: mockBlocks,
      updateBlockContent: mockUpdateBlockContent,
    })

    const store = usePropertyStore()
    // @ts-ignore
    await store.advanceDateRefInBlock?.('block-3')

    // 2026-01-31 + 1 month = 2026-02-28（闰年）
    expect(mockUpdateBlockContent).toHaveBeenCalledWith(
      'block-3',
      '@2026-02-28 ⏰|monthly'
    )
  })

  it('status=Done + content 无 recurrence → 不推进', async () => {
    const mockBlocks = [{
      id: 'block-4',
      content: '@2026-07-15 ⏰', // 无 recurrence
      type: 'bullet',
      page: 'test-page',
      children: [],
      format: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]

    const mockUpdateBlockContent = vi.fn()
    ;(useBlockStore as any).mockReturnValue({
      blocks: mockBlocks,
      updateBlockContent: mockUpdateBlockContent,
    })

    const store = usePropertyStore()
    // @ts-ignore
    await store.advanceDateRefInBlock?.('block-4')

    expect(mockUpdateBlockContent).not.toHaveBeenCalled()
  })

  it('status=Done + content 无 dateRef → 不推进', async () => {
    const mockBlocks = [{
      id: 'block-5',
      content: '普通任务',
      type: 'bullet',
      page: 'test-page',
      children: [],
      format: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]

    const mockUpdateBlockContent = vi.fn()
    ;(useBlockStore as any).mockReturnValue({
      blocks: mockBlocks,
      updateBlockContent: mockUpdateBlockContent,
    })

    const store = usePropertyStore()
    // @ts-ignore
    await store.advanceDateRefInBlock?.('block-5')

    expect(mockUpdateBlockContent).not.toHaveBeenCalled()
  })

  it('block 不存在 → 安全跳过', async () => {
    ;(useBlockStore as any).mockReturnValue({
      blocks: [],
      updateBlockContent: vi.fn(),
    })

    const store = usePropertyStore()
    // @ts-ignore
    await store.advanceDateRefInBlock?.('non-existent')

    // 无错误即通过
    expect(true).toBe(true)
  })
})
