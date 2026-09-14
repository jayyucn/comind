// useRightSidebar 面板回落单测（ADR-0047 D1）：
// 下架 block-version 面板后，旧 localStorage 里的 'block-version' 必须回落到首个已注册面板，
// 否则侧栏会出现空白面板区与无高亮的 tab。
// 模块级单例在加载时读 localStorage → 每用例 vi.resetModules 后动态 import 构造「旧会话」。
import { describe, it, expect, beforeEach } from 'vitest'

const STORAGE_KEY = 'comind-right-sidebar'

async function freshModule(stored?: unknown) {
  vi.resetModules()
  localStorage.clear()
  if (stored !== undefined) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  }
  return await import('./useRightSidebar')
}

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('useRightSidebar 面板回落', () => {
  it('持久化指向已注销面板时，defaultPanel / panelOrder / activePanelId 一并回落', async () => {
    const { useRightSidebar, reconcilePanels } = await freshModule({
      defaultPanel: 'block-version',
      panelOrder: ['block-version', 'graph'],
      width: 360,
    })

    reconcilePanels(['graph'])

    const { settings, activePanelId } = useRightSidebar()
    expect(settings.value.defaultPanel).toBe('graph')
    expect(settings.value.panelOrder).toEqual(['graph'])
    expect(activePanelId.value).toBe('graph')
  })

  it('panelOrder 剔除已注销 id 并保留已注册项的相对次序', async () => {
    const { useRightSidebar, reconcilePanels } = await freshModule({
      defaultPanel: 'panel-b',
      panelOrder: ['gone', 'panel-b', 'panel-a', 'also-gone'],
      width: 360,
    })

    reconcilePanels(['panel-a', 'panel-b', 'panel-c'])

    const { settings } = useRightSidebar()
    expect(settings.value.panelOrder).toEqual(['panel-b', 'panel-a'])
    expect(settings.value.defaultPanel).toBe('panel-b')
  })

  it('defaultPanel 失效时回落到首个已注册面板，当前面板同步跟随', async () => {
    const { useRightSidebar, reconcilePanels } = await freshModule({
      defaultPanel: 'gone',
      panelOrder: ['gone', 'panel-b'],
      width: 360,
    })

    reconcilePanels(['panel-a', 'panel-b'])

    const { settings, activePanelId } = useRightSidebar()
    expect(settings.value.defaultPanel).toBe('panel-a')
    expect(activePanelId.value).toBe('panel-a')
  })

  it('全部 id 均已注册时不改动设置', async () => {
    const { useRightSidebar, reconcilePanels } = await freshModule({
      defaultPanel: 'panel-b',
      panelOrder: ['panel-b', 'panel-a'],
      width: 480,
    })

    reconcilePanels(['panel-a', 'panel-b'])

    const { settings, activePanelId } = useRightSidebar()
    expect(settings.value.defaultPanel).toBe('panel-b')
    expect(settings.value.panelOrder).toEqual(['panel-b', 'panel-a'])
    expect(settings.value.width).toBe(480)
    expect(activePanelId.value).toBe('panel-b')
  })

  it('无面板注册时不动设置', async () => {
    const { useRightSidebar, reconcilePanels } = await freshModule({
      defaultPanel: 'gone',
      panelOrder: ['gone', 'graph'],
      width: 360,
    })

    reconcilePanels([])

    const { settings, activePanelId } = useRightSidebar()
    expect(settings.value.defaultPanel).toBe('gone')
    expect(settings.value.panelOrder).toEqual(['gone', 'graph'])
    expect(activePanelId.value).toBe('gone')
  })

  it('无旧持久化数据时默认面板为 graph', async () => {
    const { useRightSidebar } = await freshModule()

    const { settings, activePanelId } = useRightSidebar()
    expect(settings.value.defaultPanel).toBe('graph')
    expect(settings.value.panelOrder).toEqual(['graph'])
    expect(activePanelId.value).toBe('graph')
  })
})
