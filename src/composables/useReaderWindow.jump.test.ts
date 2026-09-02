// openReaderWindow 跳回原文扩展单测（票 06）：jumpCfi 参数的两条路径——
// 新建窗口（URL query 携带 CFI，规避「事件早于监听注册」竞态）/ 已存在窗口
// （setFocus + emitTo 'reader:jump-to'）。无 jumpCfi 时行为与票 03 完全一致。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSetFocus, WebviewWindowCtor, mockGetByLabel, mockEmitTo } = vi.hoisted(() => ({
  mockSetFocus: vi.fn(),
  WebviewWindowCtor: vi.fn(),
  mockGetByLabel: vi.fn(),
  mockEmitTo: vi.fn(),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => {
  WebviewWindowCtor.mockImplementation(function (
    this: Record<string, unknown>,
    label: string,
    options: Record<string, unknown>,
  ) {
    this.label = label
    this.options = options
    this.once = vi.fn()
    this.setFocus = mockSetFocus
  })
  ;(WebviewWindowCtor as unknown as { getByLabel: unknown }).getByLabel = mockGetByLabel
  return { WebviewWindow: WebviewWindowCtor }
})

vi.mock('@tauri-apps/api/event', () => ({ emitTo: mockEmitTo }))

import { openReaderWindow } from './useReaderWindow'

const CFI = 'epubcfi(/6/4!/4/10/2:0)'

beforeEach(() => {
  WebviewWindowCtor.mockClear()
  mockGetByLabel.mockReset()
  mockSetFocus.mockReset()
  mockEmitTo.mockReset()
  mockEmitTo.mockResolvedValue(undefined)
})

describe('openReaderWindow（jumpCfi 跳回原文）', () => {
  it('新建窗口：jumpCfi 经 URL query 携带（事件早于窗口监听注册会丢，URL 可靠）', async () => {
    mockGetByLabel.mockResolvedValue(null)

    await openReaderWindow('book-1', { jumpCfi: CFI })

    expect(WebviewWindowCtor).toHaveBeenCalledTimes(1)
    const [, options] = WebviewWindowCtor.mock.calls[0] as [string, Record<string, unknown>]
    expect(options.url).toBe(`/reader/book-1?cfi=${encodeURIComponent(CFI)}`)
    // 新建路径不用事件（窗口尚未加载，listen 未注册）
    expect(mockEmitTo).not.toHaveBeenCalled()
  })

  it('已存在窗口：setFocus 后 emitTo reader:jump-to（含 bookPageId 与 cfi）', async () => {
    const existing = { setFocus: mockSetFocus }
    mockGetByLabel.mockResolvedValue(existing)

    await openReaderWindow('book-1', { jumpCfi: CFI })

    expect(mockSetFocus).toHaveBeenCalledTimes(1)
    expect(mockEmitTo).toHaveBeenCalledTimes(1)
    expect(mockEmitTo).toHaveBeenCalledWith('reader-book-1', 'reader:jump-to', {
      bookPageId: 'book-1',
      cfi: CFI,
    })
    // 已存在窗口不重复创建
    expect(WebviewWindowCtor).not.toHaveBeenCalled()
  })

  it('不带 jumpCfi：URL 无 query（票 03 行为不变）', async () => {
    mockGetByLabel.mockResolvedValue(null)

    await openReaderWindow('book-1')

    const [, options] = WebviewWindowCtor.mock.calls[0] as [string, Record<string, unknown>]
    expect(options.url).toBe('/reader/book-1')
    expect(mockEmitTo).not.toHaveBeenCalled()
  })

  it('已存在窗口且无 jumpCfi：仅 setFocus（票 03 行为不变）', async () => {
    const existing = { setFocus: mockSetFocus }
    mockGetByLabel.mockResolvedValue(existing)

    await openReaderWindow('book-1')

    expect(mockSetFocus).toHaveBeenCalledTimes(1)
    expect(mockEmitTo).not.toHaveBeenCalled()
  })
})
