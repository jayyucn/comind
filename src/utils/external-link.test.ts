import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { isTauriMock, openUrlMock, invokeMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => false),
  openUrlMock: vi.fn(async () => undefined),
  invokeMock: vi.fn(async () => undefined),
}))

vi.mock('../wasm/tauri-platform', () => ({
  isTauriEnvironment: isTauriMock,
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: openUrlMock,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

import { openExternalUrl } from './external-link'

describe('openExternalUrl', () => {
  let openSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // 全用例统一假定时器：抢焦点用的是 setTimeout，真定时器会漏到后续用例里造成串扰
    vi.useFakeTimers()
    vi.clearAllMocks()
    isTauriMock.mockReturnValue(false)
    openUrlMock.mockResolvedValue(undefined)
    invokeMock.mockResolvedValue(undefined)
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('浏览器环境：走 window.open 新标签页（e2e 仍能断言 popup）', async () => {
    await expect(openExternalUrl('https://example.com')).resolves.toBe(true)
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    expect(openUrlMock).not.toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  test('Tauri 环境：交给系统浏览器，且不再走 window.open', async () => {
    isTauriMock.mockReturnValue(true)
    await expect(openExternalUrl('https://example.com/a?b=1')).resolves.toBe(true)
    expect(openUrlMock).toHaveBeenCalledWith('https://example.com/a?b=1')
    expect(openSpy).not.toHaveBeenCalled()
  })

  test('Tauri 环境：打开后多次补调 focus_main_window（浏览器冷启动也会被抢回焦点）', async () => {
    isTauriMock.mockReturnValue(true)

    await openExternalUrl('https://example.com')
    // 0ms 那一次在宏任务里，先让出一次事件循环
    await vi.advanceTimersByTimeAsync(0)
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('focus_main_window')

    await vi.advanceTimersByTimeAsync(3200)
    // 慢启动兜底：累计 7 次（0 / 150 / 400 / 800 / 1300 / 2000 / 3000）
    expect(invokeMock).toHaveBeenCalledTimes(7)
    for (const call of invokeMock.mock.calls) {
      expect(call).toEqual(['focus_main_window'])
    }
  })

  test('系统浏览器报错：静默（只记控制台），返回 false，且不再抢焦点', async () => {
    isTauriMock.mockReturnValue(true)
    openUrlMock.mockRejectedValueOnce(new Error('no browser'))
    await expect(openExternalUrl('https://example.com')).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(3200)
    expect(errorSpy).toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  test('抢焦点失败不影响结果（命令不可用/被拒时静默）', async () => {
    isTauriMock.mockReturnValue(true)
    invokeMock.mockRejectedValue(new Error('command not found'))
    await expect(openExternalUrl('https://example.com')).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(3200)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  test('非 http(s) 协议一律拒绝：不进系统打开器，也不开标签页', async () => {
    isTauriMock.mockReturnValue(true)
    for (const bad of ['javascript:alert(1)', 'file:///C:/x.txt', 'tauri://localhost', '']) {
      await expect(openExternalUrl(bad)).resolves.toBe(false)
    }
    expect(openUrlMock).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  test('空值直接返回 false（字段为空 / 数据集缺失）', async () => {
    await expect(openExternalUrl(null)).resolves.toBe(false)
    await expect(openExternalUrl(undefined)).resolves.toBe(false)
    expect(openSpy).not.toHaveBeenCalled()
  })
})
