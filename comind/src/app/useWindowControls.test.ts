import { describe, it, expect, vi } from 'vitest'

const { tauri, getCurrentWindow } = vi.hoisted(() => ({
  tauri: {
    isTauriEnvironment: vi.fn(() => false),
    isAndroidPlatformSync: vi.fn(() => false),
    tauriAutoReconnect: vi.fn(() => Promise.resolve(false)),
    tauriCloseWindow: vi.fn(() => Promise.resolve()),
    tauriIsMaximized: vi.fn(() => Promise.resolve(false)),
    tauriMinimizeWindow: vi.fn(() => Promise.resolve()),
    tauriToggleMaximizeWindow: vi.fn(() => Promise.resolve()),
  },
  getCurrentWindow: vi.fn(() => ({ startDragging: vi.fn(), listen: vi.fn() })),
}))

vi.mock('../wasm/tauri-client', () => ({ ...tauri }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow }))

import { useWindowControls } from './useWindowControls'

function setup() {
  return useWindowControls()
}

describe('useWindowControls', () => {
  it('非 Tauri 环境各方法早退', () => {
    const api = setup()
    api.minimize()
    api.maximize()
    api.close()
    expect(tauri.tauriMinimizeWindow).not.toHaveBeenCalled()
    expect(tauri.tauriCloseWindow).not.toHaveBeenCalled()
    expect(api.isMaximized.value).toBe(false)
  })

  it('startDragging 非 Tauri 环境早退（不触 Tauri 窗口）', () => {
    const api = setup()
    api.startDragging({ target: { closest: () => null } } as unknown as MouseEvent)
    expect(getCurrentWindow).not.toHaveBeenCalled()
  })

  it('Tauri 环境 minimize 调 tauri', () => {
    tauri.isTauriEnvironment.mockReturnValue(true)
    const api = setup()
    api.minimize()
    expect(tauri.tauriMinimizeWindow).toHaveBeenCalled()
    tauri.isTauriEnvironment.mockReturnValue(false)
  })
})
