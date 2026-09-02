// useReaderWindow 单测（票 03）：窗口复用（同名 setFocus）/ 新建（URL 与仿主窗口配置）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSetFocus, WebviewWindowCtor, mockGetByLabel } = vi.hoisted(() => ({
  mockSetFocus: vi.fn(),
  WebviewWindowCtor: vi.fn(),
  mockGetByLabel: vi.fn(),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => {
  // 普通函数实现，才能被 `new WebviewWindow(...)` 以构造器方式调用
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

import { openReaderWindow } from './useReaderWindow'

beforeEach(() => {
  WebviewWindowCtor.mockClear()
  mockGetByLabel.mockReset()
  mockSetFocus.mockReset()
})

describe('openReaderWindow', () => {
  it('窗口不存在：新建 WebviewWindow，URL 为相对路由 /reader/<bookId>，仿主窗口无边框/透明', async () => {
    mockGetByLabel.mockResolvedValue(null)

    await openReaderWindow('0a1b2c3d-e4f5-6789-abcd-ef0123456789')

    expect(WebviewWindowCtor).toHaveBeenCalledTimes(1)
    const [label, options] = WebviewWindowCtor.mock.calls[0] as [string, Record<string, unknown>]
    expect(label).toBe('reader-0a1b2c3d-e4f5-6789-abcd-ef0123456789')
    expect(options.url).toBe('/reader/0a1b2c3d-e4f5-6789-abcd-ef0123456789')
    expect(options.decorations).toBe(false)
    expect(options.transparent).toBe(true)
    expect(options.center).toBe(true)
  })

  it('同名窗口已存在：setFocus 复用，不重复创建', async () => {
    const existing = { setFocus: mockSetFocus }
    mockGetByLabel.mockResolvedValue(existing)

    await openReaderWindow('book-1')

    expect(mockGetByLabel).toHaveBeenCalledWith('reader-book-1')
    expect(mockSetFocus).toHaveBeenCalledTimes(1)
    expect(WebviewWindowCtor).not.toHaveBeenCalled()
  })

  it('不同书：label 不同（一书一窗）', async () => {
    mockGetByLabel.mockResolvedValue(null)

    await openReaderWindow('book-a')
    await openReaderWindow('book-b')

    expect(WebviewWindowCtor).toHaveBeenCalledTimes(2)
    const labels = WebviewWindowCtor.mock.calls.map(call => call[0])
    expect(labels).toEqual(['reader-book-a', 'reader-book-b'])
  })
})
