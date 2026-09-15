/**
 * useRestoreFlash 单测（#115）。
 * 墨迹测量（文本逐行贴字 / 原子元素自身盒 / 空区域不画）+ 闪烁状态机
 * （整批替换 / 600ms 窗口 / 视口重算）是落点「只亮非空白区域」裁定的实现，
 * 语义错一处 = 色块铺回空白上（真机实测过的事故）。只测外部行为：
 * 给定构造的块 DOM，断言量出的矩形集合与状态机时序。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope } from 'vue'
import { measureBlockInkRects, useRestoreFlash, UNDO_FLASH_MS } from './useRestoreFlash'

/** jsdom 的 Range 没有 getClientRects：直接补原型方法（非空白才被量到） */
beforeEach(() => {
  (Range.prototype as unknown as Record<string, unknown>).getClientRects = () =>
    [new DOMRect(0, 0, 19, 24)] as unknown as DOMRectList
})

afterEach(() => {
  delete (Range.prototype as unknown as Record<string, unknown>).getClientRects
})

/** 造一个符合 BlockList 渲染结构的最小块：内容区在 .block-row 下、属性区是直接子元素 */
function makeBlockEl(id: string, opts: { content?: string; props?: string; atomic?: boolean } = {}): HTMLElement {
  const el = document.createElement('div')
  el.dataset.blockId = id
  const row = document.createElement('div')
  row.className = 'block-row'
  const content = document.createElement('div')
  content.className = 'block-content'
  if (opts.atomic) {
    const img = document.createElement('img')
    img.getBoundingClientRect = () => new DOMRect(5, 5, 32, 32)
    content.appendChild(img)
  } else if (opts.content !== undefined) {
    content.appendChild(document.createTextNode(opts.content))
  }
  row.appendChild(content)
  el.appendChild(row)
  if (opts.props !== undefined) {
    const props = document.createElement('div')
    props.className = 'block-properties'
    props.appendChild(document.createTextNode(opts.props))
    el.appendChild(props)
  }
  return el
}

describe('measureBlockInkRects（#115 墨迹测量）', () => {
  it('文本内容与属性区各量出一个矩形（包围盒合并非空白墨迹）', () => {
    const root = document.createElement('div')
    root.appendChild(makeBlockEl('b1', { content: 'hello', props: 'chip' }))
    const rects = measureBlockInkRects(root, ['b1'])
    expect(rects.length).toBe(2)
  })

  it('原子元素（img 等）取自身盒，不往里钻', () => {
    const root = document.createElement('div')
    root.appendChild(makeBlockEl('b1', { atomic: true }))
    const rects = measureBlockInkRects(root, ['b1'])
    expect(rects.length).toBe(1)
    expect(rects[0].width).toBe(32)
  })

  it('纯空白文本不量（空块不画 = 只亮非空白区域的直接结果）', () => {
    const root = document.createElement('div')
    root.appendChild(makeBlockEl('b1', { content: '   ' }))
    expect(measureBlockInkRects(root, ['b1'])).toEqual([])
  })

  it('完全空的内容区（无任何子节点）量不出 = 不画（regionInkRect 的 null 路径）', () => {
    const root = document.createElement('div')
    root.appendChild(makeBlockEl('b1')) // content/props/atomic 全缺省 → .block-content 空元素
    expect(measureBlockInkRects(root, ['b1'])).toEqual([])
  })

  it('root 里找不到的块 id 跳过；root 为 null 返回空', () => {
    const root = document.createElement('div')
    expect(measureBlockInkRects(root, ['missing'])).toEqual([])
    expect(measureBlockInkRects(null, ['b1'])).toEqual([])
  })
})

describe('useRestoreFlash 状态机（#115）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** composable 须在活动 effect scope 内调用（onScopeDispose 依赖） */
  function setup(root: HTMLElement | null) {
    const scope = effectScope()
    let api: ReturnType<typeof useRestoreFlash>
    scope.run(() => {
      api = useRestoreFlash(() => root)
    })!
    return { scope, api }
  }

  it('flashChangedBlocks 整批替换：矩形立即可见，窗口到期清空', () => {
    const root = document.createElement('div')
    root.appendChild(makeBlockEl('b1', { content: 'hello' }))
    const { api } = setup(root)
    api.flashChangedBlocks(['b1'])
    expect(api.flashRects.value.length).toBe(1)
    expect(api.flashingIds.value).toEqual(['b1'])
    vi.advanceTimersByTime(UNDO_FLASH_MS)
    expect(api.flashRects.value).toEqual([])
    expect(api.flashingIds.value).toEqual([])
  })

  it('连续两次 flash：上一批即刻失去闪烁，不残留旧矩形', () => {
    const root = document.createElement('div')
    root.appendChild(makeBlockEl('b1', { content: 'hello' }))
    const { api } = setup(root)
    api.flashChangedBlocks(['b1'])
    vi.advanceTimersByTime(100)
    api.flashChangedBlocks([]) // 空批：量出零矩形，旧矩形被替换掉
    expect(api.flashRects.value).toEqual([])
    vi.advanceTimersByTime(UNDO_FLASH_MS)
    expect(api.flashRects.value).toEqual([])
  })

  it('refreshFlashRects 在窗口内重算、窗口外空操作', () => {
    const root = document.createElement('div')
    root.appendChild(makeBlockEl('b1', { content: 'hello' }))
    const { api } = setup(root)
    api.flashChangedBlocks(['b1'])
    // 滚动后 DOM 位移由真实布局决定，jsdom 里矩形不变——只验证不抛错且仍持矩形
    api.refreshFlashRects()
    expect(api.flashRects.value.length).toBe(1)
    vi.advanceTimersByTime(UNDO_FLASH_MS + 1)
    api.refreshFlashRects() // 窗口外：空操作，不得复活矩形
    expect(api.flashRects.value).toEqual([])
  })

  it('scope 卸载（onScopeDispose）清掉 timer：到期不写已卸载实例的 ref', () => {
    const root = document.createElement('div')
    root.appendChild(makeBlockEl('b1', { content: 'hello' }))
    const { scope, api } = setup(root)
    api.flashChangedBlocks(['b1'])
    scope.stop()
    vi.advanceTimersByTime(UNDO_FLASH_MS + 1)
    expect(api.flashRects.value.length).toBe(1) // timer 已清，矩形残留但不再被写
  })
})
