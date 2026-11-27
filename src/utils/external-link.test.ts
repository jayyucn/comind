import { beforeEach, describe, expect, test, vi } from 'vitest'

const { isTauriMock, openUrlMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => false),
  openUrlMock: vi.fn(async () => undefined),
}))

vi.mock('../wasm/tauri-platform', () => ({
  isTauriEnvironment: isTauriMock,
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: openUrlMock,
}))

import { openExternalUrl } from './external-link'

describe('openExternalUrl', () => {
  let openSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    isTauriMock.mockReturnValue(false)
    openUrlMock.mockResolvedValue(undefined)
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  test('浏览器环境：走 window.open 新标签页（e2e 仍能断言 popup）', async () => {
    await expect(openExternalUrl('https://example.com')).resolves.toBe(true)
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    expect(openUrlMock).not.toHaveBeenCalled()
  })

  test('Tauri 环境：交给系统浏览器，且不再走 window.open', async () => {
    isTauriMock.mockReturnValue(true)
    await expect(openExternalUrl('https://example.com/a?b=1')).resolves.toBe(true)
    expect(openUrlMock).toHaveBeenCalledWith('https://example.com/a?b=1')
    expect(openSpy).not.toHaveBeenCalled()
  })

  test('系统浏览器报错：静默（只记控制台），返回 false', async () => {
    isTauriMock.mockReturnValue(true)
    openUrlMock.mockRejectedValueOnce(new Error('no browser'))
    await expect(openExternalUrl('https://example.com')).resolves.toBe(false)
    expect(errorSpy).toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  test('非 http(s) 协议一律拒绝：不进系统打开器，也不开标签页', async () => {
    isTauriMock.mockReturnValue(true)
    for (const bad of ['javascript:alert(1)', 'file:///C:/x.txt', 'tauri://localhost', '']) {
      await expect(openExternalUrl(bad)).resolves.toBe(false)
    }
    expect(openUrlMock).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
  })

  test('空值直接返回 false（字段为空 / 数据集缺失）', async () => {
    await expect(openExternalUrl(null)).resolves.toBe(false)
    await expect(openExternalUrl(undefined)).resolves.toBe(false)
    expect(openSpy).not.toHaveBeenCalled()
  })
})
