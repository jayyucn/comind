import { beforeEach, describe, expect, test, vi } from 'vitest'

import { useWebLinkChipToolbar, type WebLinkToolbarTarget } from './useWebLinkChipToolbar'

/**
 * 文本选区优先于 web-link 悬浮条：选区在时正文上方已有 InlineFormatToolbar，
 * 两条浮条叠在同一段文字上互相遮挡。块选区不参与判定（那种状态没有浮条竞争）。
 */

const TARGET: WebLinkToolbarTarget = {
  blockId: 'b1',
  kind: 'chip',
  url: 'https://example.com',
  title: 'example',
  left: 10,
  top: 20,
  view: 'title',
}

function mockSelection(active: boolean): void {
  vi.spyOn(window, 'getSelection').mockReturnValue(
    (active
      ? { rangeCount: 1, isCollapsed: false }
      : { rangeCount: 0, isCollapsed: true }) as unknown as Selection,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  const { hide, setRangeSelectionActive } = useWebLinkChipToolbar()
  hide()
  setRangeSelectionActive(false)
})

describe('useWebLinkChipToolbar', () => {
  test('无选区时正常浮出', () => {
    mockSelection(false)
    const { show, target } = useWebLinkChipToolbar()
    show(TARGET)
    expect(target.value?.blockId).toBe('b1')
  })

  test('单块内拖选文字时不浮出', () => {
    mockSelection(true)
    const { show, target } = useWebLinkChipToolbar()
    show(TARGET)
    expect(target.value).toBeNull()
  })

  test('跨块选区由宿主标记，同样不浮出；选区消失后恢复', () => {
    mockSelection(false)
    const { show, target, setRangeSelectionActive } = useWebLinkChipToolbar()
    setRangeSelectionActive(true)
    show(TARGET)
    expect(target.value).toBeNull()

    setRangeSelectionActive(false)
    show(TARGET)
    expect(target.value?.blockId).toBe('b1')
  })
})
