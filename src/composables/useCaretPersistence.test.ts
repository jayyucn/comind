import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { useEditorStore } from '../stores/editor'
import { usePanesStore } from '../stores/panes'
import { setupCaretPersistence } from './useCaretPersistence'

/**
 * ADR-0070 光标持久化的决策矩阵：
 * 记录（focusin）× 恢复触发（空白点击）× 让位（块内/右栏/弹层/pane 不匹配/拖选/弹窗）。
 */

const editorMock = { commands: { focus: vi.fn() } }

function mountPaneWorld(paneId = 'pane-1') {
  // pane 容器 + 一块 ProseMirror + 一个 pane 内输入框 + 一个无 pane 输入框
  const pane = document.createElement('div')
  pane.dataset.paneId = paneId
  document.body.appendChild(pane)

  const pm = document.createElement('div')
  pm.className = 'ProseMirror'
  pane.appendChild(pm)

  const fieldInput = document.createElement('input')
  fieldInput.type = 'text'
  pane.appendChild(fieldInput)

  const orphanInput = document.createElement('input')
  orphanInput.type = 'text'
  document.body.appendChild(orphanInput)

  return { pane, pm, fieldInput, orphanInput }
}

function fireFocusIn(el: Element) {
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
}

function fireClickSequence(x: number, y: number, target: Element, dx = 0, dy = 0) {
  target.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y,
  }))
  target.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, cancelable: true, button: 0, clientX: x + dx, clientY: y + dy,
  }))
}

describe('useCaretPersistence（ADR-0070）', () => {
  let stop: (() => void) | null = null
  let world: ReturnType<typeof mountPaneWorld>

  beforeEach(() => {
    setActivePinia(createPinia())
    editorMock.commands.focus.mockClear()
    world = mountPaneWorld()
    const panes = usePanesStore()
    panes.activePaneId = 'pane-1'
    const editorStore = useEditorStore()
    editorStore.activateBlock('b1')
    editorStore.setActiveEditor(editorMock as never)
  })

  afterEach(() => {
    stop?.()
    stop = null
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  test('PM 编辑器 focusin：记录活动块与 pane（偏移信任 PM 内部）', () => {
    stop = setupCaretPersistence()
    const editorStore = useEditorStore()

    fireFocusIn(world.pm)

    expect(editorStore.lastEditPoint).toMatchObject({
      kind: 'pm', paneId: 'pane-1', blockId: 'b1',
    })
  })

  test('pane 内输入框 focusin：显式记录 selectionStart/End', () => {
    stop = setupCaretPersistence()
    const editorStore = useEditorStore()

    world.fieldInput.value = 'hello world'
    world.fieldInput.setSelectionRange(3, 5)
    fireFocusIn(world.fieldInput)

    const point = editorStore.lastEditPoint
    expect(point?.kind).toBe('input')
    if (point?.kind === 'input') {
      expect(point.el.deref()).toBe(world.fieldInput)
      expect(point.start).toBe(3)
      expect(point.end).toBe(5)
    }
  })

  test('无 pane 语境的输入框（顶栏搜索等）不记录', () => {
    stop = setupCaretPersistence()
    const editorStore = useEditorStore()

    fireFocusIn(world.orphanInput)
    expect(editorStore.lastEditPoint).toBeNull()
  })

  test('空白处单击：把光标还给活动块编辑器（rAF 后 focus）', async () => {
    stop = setupCaretPersistence()
    const editorStore = useEditorStore()
    fireFocusIn(world.pm)
    document.body.focus()

    fireClickSequence(10, 20, document.body)
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    expect(editorMock.commands.focus).toHaveBeenCalledTimes(1)
  })

  test('拖选（位移 >4px）：跨块选区起手，不恢复', async () => {
    stop = setupCaretPersistence()
    const editorStore = useEditorStore()
    fireFocusIn(world.pm)

    fireClickSequence(10, 20, document.body, 30, 0)
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    expect(editorMock.commands.focus).not.toHaveBeenCalled()
    void editorStore
  })

  test('抬起时选区非空（双击选词）：选字优先，不恢复', async () => {
    stop = setupCaretPersistence()
    fireFocusIn(world.pm)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
    } as unknown as Selection)

    fireClickSequence(10, 20, document.body)
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    expect(editorMock.commands.focus).not.toHaveBeenCalled()
  })

  test('落点在块内 / 右栏 / 弹层：让位给各自的点击语义，不恢复', async () => {
    stop = setupCaretPersistence()
    const editorStore = useEditorStore()
    fireFocusIn(world.pm)

    for (const cls of ['block', 'right-sidebar', 'base-popover-overlay', 'block-modal-overlay']) {
      const zone = document.createElement('div')
      zone.className = cls
      document.body.appendChild(zone)
      fireClickSequence(10, 20, zone)
    }
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    expect(editorMock.commands.focus).not.toHaveBeenCalled()
    void editorStore
  })

  test('记录的 pane 不是当前活动 pane：不抢光标', async () => {
    stop = setupCaretPersistence()
    const editorStore = useEditorStore()
    fireFocusIn(world.pm)
    usePanesStore().activePaneId = 'pane-2'

    fireClickSequence(10, 20, document.body)
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    expect(editorMock.commands.focus).not.toHaveBeenCalled()
    void editorStore
  })

  test('BlockModal 打开中：恢复挂起', async () => {
    stop = setupCaretPersistence()
    const editorStore = useEditorStore()
    fireFocusIn(world.pm)
    editorStore.openBlockModal('b1')

    fireClickSequence(10, 20, document.body)
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    expect(editorMock.commands.focus).not.toHaveBeenCalled()
  })

  test('窗口 focus 事件：焦点丢了（activeElement 是 body）才补', async () => {
    stop = setupCaretPersistence()
    const editorStore = useEditorStore()
    fireFocusIn(world.pm)

    // 焦点还持有在输入框上：不抢
    world.orphanInput.focus()
    window.dispatchEvent(new Event('focus'))
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    expect(editorMock.commands.focus).not.toHaveBeenCalled()

    // 焦点真丢了（activeElement 退回 body）：补回
    world.orphanInput.blur()
    window.dispatchEvent(new Event('focus'))
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    expect(editorMock.commands.focus).toHaveBeenCalledTimes(1)
    void editorStore
  })

  test('Esc 之外：记录的块已不激活时不恢复（记录自然失效）', async () => {
    stop = setupCaretPersistence()
    const editorStore = useEditorStore()
    fireFocusIn(world.pm)
    editorStore.deactivateBlock()

    fireClickSequence(10, 20, document.body)
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    expect(editorMock.commands.focus).not.toHaveBeenCalled()
  })
})
