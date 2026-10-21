/**
 * 跨块选区高亮几何回归测试（selection-geometry）
 *
 * 背景：拖拽扫过「无文本节点的块」（空行、图片块）时，高亮曾**整条消失**——旧实现用
 * `Range.compareBoundaryPoints` 判端点先后，而这类块构造不出 Range（返回 null），于是
 * `selectionClientRects` 直接 `return []`，把前面已经选中的文本一并丢弃。
 *
 * jsdom 29 未实现 `Range.getClientRects`（该模块因此长期只有真机验证），这里注入替身，
 * 把「本次 Range 覆盖的块 + 覆盖了多少文字」编码进矩形，让断言落在**选中语义**而非像素
 * 几何上：`top` = 块序号，`left` = `range.toString().length`。
 *
 * DOM 形状照 `BulletRender.vue`：`[data-block-id] > .block-content > .block-text > span`，
 * 内容为空时渲染成 `<span></span>`（无文本节点，与真机一致）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { atomicUnitSpans, caretBlockOffsetFromDomSelection, collapsedRangeAtBlockOffset, selectionClientRects, type SelectionRect } from './selection-geometry'
import type { BlockOffset } from './text-range'

/** 构造一页（数组下标 = 文档序），空串模拟空行 */
function buildPage(contents: string[]): void {
  document.body.innerHTML = `<div class="block-list">${contents
    .map(
      (c, i) =>
        `<div data-block-id="b${i}" data-i="${i}"><div class="block-content"><div class="block-text"><span>${c}</span></div></div></div>`
    )
    .join('')}</div>`
}

/** 块内端点：块序号 i + 字符偏移 */
function at(i: number, offset: number): BlockOffset {
  return { blockId: `b${i}`, offset }
}

/** 替身矩形的可读投影：[块序号, 覆盖字数] */
function painted(rects: SelectionRect[]): Array<[number, number]> {
  return rects.map(r => [r.top, r.left])
}

const realGetClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')

beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    writable: true,
    value(this: Range) {
      const node = this.startContainer
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
      const block = el?.closest('[data-block-id]')
      return [
        {
          top: block ? Number(block.getAttribute('data-i')) : -1,
          left: this.toString().length,
          width: 10,
          height: 10,
        },
      ]
    },
  })
})

afterEach(() => {
  if (realGetClientRects) Object.defineProperty(Range.prototype, 'getClientRects', realGetClientRects)
  else delete (Range.prototype as { getClientRects?: unknown }).getClientRects
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

describe('selectionClientRects - 无文本节点的块（空行 / 图片块）', () => {
  test('前提：无文本节点的块构造不出 Range —— 旧实现据此 `return []` 丢弃整条选区', () => {
    buildPage(['abc', '', 'def'])
    expect(collapsedRangeAtBlockOffset('b0', 1)).not.toBeNull()
    expect(collapsedRangeAtBlockOffset('b1', 0)).toBeNull()
  })

  test('端点停在空行上：前面已选中的文本仍高亮（回归：不再整条丢弃）', () => {
    buildPage(['abc', '', 'def'])
    // 首块 1..末 → "bc"；空行不产生矩形，但不得牵连首块
    expect(painted(selectionClientRects(at(0, 1), at(1, 0)))).toEqual([[0, 2]])
  })

  test('空行夹在中间：空行不高亮，两侧文本块都高亮', () => {
    buildPage(['abc', '', 'def'])
    expect(painted(selectionClientRects(at(0, 1), at(2, 3)))).toEqual([
      [0, 2],
      [2, 3],
    ])
  })

  test('起点落在空行上：相邻文本块从块首开始高亮', () => {
    buildPage(['abc', '', 'def'])
    expect(painted(selectionClientRects(at(1, 0), at(2, 2)))).toEqual([[2, 2]]) // "de"
  })

  test('整页都是无文本节点的块：无高亮（没有可选的文字）', () => {
    buildPage(['', ''])
    expect(selectionClientRects(at(0, 0), at(1, 0))).toEqual([])
  })
})

describe('selectionClientRects - 端点判序', () => {
  test('同块内反向拖拽：按偏移判序，不塌缩成零宽', () => {
    buildPage(['abcdef'])
    expect(painted(selectionClientRects(at(0, 5), at(0, 2)))).toEqual([[0, 3]]) // "cde"
  })

  test('跨块反向拖拽：与正向结果一致', () => {
    buildPage(['abc', '', 'def'])
    expect(painted(selectionClientRects(at(2, 3), at(0, 1)))).toEqual([
      [0, 2],
      [2, 3],
    ])
  })
})

describe('caretBlockOffsetFromDomSelection - shift+click 从光标起选的起点读取', () => {
  test('光标（折叠选区）在文本节点内：返回所在块与 textContent 偏移', () => {
    buildPage(['abc', 'defgh'])
    const text = document.querySelector('[data-block-id="b1"] span')!.firstChild!
    window.getSelection()!.collapse(text, 2)
    expect(caretBlockOffsetFromDomSelection()).toEqual({ blockId: 'b1', offset: 2 })
  })

  test('多文本节点：累计前置节点长度（与 blockOffsetFromPoint 同为 textContent 口径）', () => {
    document.body.innerHTML =
      '<div data-block-id="bx"><div class="block-content"><span>ab</span><em>cde</em><span>f</span></div></div>'
    const emText = document.querySelector('[data-block-id="bx"] em')!.firstChild!
    window.getSelection()!.collapse(emText, 1)
    // "ab" (2) + "c" (1) = 3
    expect(caretBlockOffsetFromDomSelection()).toEqual({ blockId: 'bx', offset: 3 })
  })

  test('非折叠选区取 anchor：PM 原生 shift+click 已把选区延伸到点击处时，anchor 仍是原光标位', () => {
    buildPage(['abc', 'def'])
    const a = document.querySelector('[data-block-id="b0"] span')!.firstChild!
    const b = document.querySelector('[data-block-id="b1"] span')!.firstChild!
    // 模拟 PM 原生 shift+click：base=原光标（b0:1），extent=点击处（b1:2）
    window.getSelection()!.setBaseAndExtent(a, 1, b, 2)
    expect(caretBlockOffsetFromDomSelection()).toEqual({ blockId: 'b0', offset: 1 })
  })

  test('光标不在任何块内容区内（页面空白 / bullet 区）：返回 null', () => {
    buildPage(['abc'])
    window.getSelection()!.collapse(document.body, 0)
    expect(caretBlockOffsetFromDomSelection()).toBeNull()
  })

  test('无 selection（rangeCount 0）：返回 null，调用方退化为普通点击', () => {
    buildPage(['abc'])
    window.getSelection()!.removeAllRanges()
    expect(caretBlockOffsetFromDomSelection()).toBeNull()
  })
})

/**
 * 内联原子单元的渲染偏移量测（喂给 `text-range.snapTextRangeToUnits`）。
 *
 * 与端点同一坐标系：都按 `contentRoot` 下的文本节点累计长度算，故这里断言的是
 * 「单元在渲染文本里的 [start, end)」，与 `blockOffsetFromPoint` 可直接比较。
 */
describe('atomicUnitSpans - 内联原子单元区间', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function buildWith(innerHtml: string): void {
    document.body.innerHTML =
      `<div class="block-list"><div data-block-id="b0"><div class="block-content">` +
      `<div class="block-text">${innerHtml}</div></div></div></div>`
  }

  test('inline `#tag` chip（.block-tag）计入单元，偏移覆盖含 # 的整段', () => {
    // 渲染文本 `这是测试任务 #任务 后面的文字`：`#任务` = [7,10)
    buildWith('<span>这是测试任务 <span class="block-tag">#任务</span> 后面的文字</span>')
    expect(atomicUnitSpans('b0')).toEqual([{ start: 7, end: 10 }])
  })

  test('date-ref（.date-ref）与 wiki link（.block-link）各自计入', () => {
    buildWith('<span>a <span class="date-ref">@2026-10-15</span> b <span class="block-link">[[x]]</span></span>')
    const spans = atomicUnitSpans('b0')
    expect(spans).toHaveLength(2)
    expect(spans[0]).toEqual({ start: 2, end: 13 }) // 渲染文本 offset 2 = '@'
    expect(spans[1]).toEqual({ start: 16, end: 21 })
  })

  test('无单元内容（纯文本块）→ 空数组', () => {
    buildWith('<span>纯文本，没有 chip</span>')
    expect(atomicUnitSpans('b0')).toEqual([])
  })

  test('块不存在 → 空数组（不抛错，调用方无需 try/catch）', () => {
    buildWith('<span>abc</span>')
    expect(atomicUnitSpans('missing-block')).toEqual([])
  })

  test('编辑态（.ProseMirror 在 .block-content 内）同样量得到', () => {
    document.body.innerHTML =
      `<div class="block-list"><div data-block-id="b0"><div class="block-content">` +
      `<div class="tiptap ProseMirror"><p>ab <span class="block-tag">#任务</span> cd</p></div>` +
      `</div></div></div>`
    expect(atomicUnitSpans('b0')).toEqual([{ start: 3, end: 6 }])
  })
})

describe('selectionClientRects - 行带归一化与叠层消重（chip 参与选区）', () => {
  /**
   * 脚本化矩形：按块 id 返回该块内各段内联盒的原始矩形。
   * 真机实测（暗色主题）：文字行盒 173.5/24，`#任务` 外盒 175.5/21，
   * `#任务` 内层文本 run 175.5/21（差一个 padding），`@2026-10-21` 外盒 175.5/22。
   */
  function stubRectsByBlock(map: Record<string, Array<{ left: number; top: number; width: number; height: number }>>): void {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      writable: true,
      value(this: Range) {
        const node = this.startContainer
        const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
        const id = el?.closest('[data-block-id]')?.getAttribute('data-block-id') ?? ''
        return map[id] ?? []
      },
    })
  }

  function buildWithBlocks(spans: string[]): void {
    document.body.innerHTML =
      '<div class="block-list">' +
      spans
        .map(
          (s, i) =>
            `<div data-block-id="b${i}"><div class="block-content"><div class="block-text"><span>${s}</span></div></div></div>`
        )
        .join('') +
      '</div>'
  }

  test('chip 外盒 + 内层文本 run 重复上报 → 合并成一段，不再叠两层底色', () => {
    buildWithBlocks(['ab <span class="block-tag">#tag</span> cd'])
    stubRectsByBlock({
      b0: [
        { left: 0, top: 100, width: 60, height: 24 }, // 前段文字行盒
        { left: 60, top: 102, width: 40, height: 21 }, // chip 外盒
        { left: 64, top: 102, width: 32, height: 21 }, // chip 内层文本 run
        { left: 100, top: 100, width: 30, height: 24 }, // 后段文字行盒
      ],
    })
    // 旧实现：4 个矩形全部保留，chip 处 55% 半透明叠两层（亮度 128 vs 98）
    expect(selectionClientRects(at(0, 0), at(0, 3))).toEqual([
      { left: 0, top: 100, width: 130, height: 24 },
    ])
  })

  test('chip 矮于行盒 → 钉到行带（top/height 与相邻文字一致）', () => {
    buildWithBlocks(['xy <span class="date-ref">@2026-10-15</span>'])
    stubRectsByBlock({
      b0: [
        { left: 0, top: 100, width: 20, height: 24 },
        { left: 20, top: 102, width: 30, height: 22 },
      ],
    })
    expect(selectionClientRects(at(0, 0), at(0, 3))).toEqual([
      { left: 0, top: 100, width: 50, height: 24 },
    ])
  })

  test('block 内容只有 chip：行带借同选区其它块的行盒高度，不以 chip 内联盒为准', () => {
    buildWithBlocks(['纯文字行', '<span class="block-tag">#tag</span>'])
    stubRectsByBlock({
      b0: [{ left: 0, top: 100, width: 80, height: 24 }],
      b1: [
        { left: 0, top: 202, width: 40, height: 21 },
        { left: 4, top: 202, width: 32, height: 21 },
      ],
    })
    const rects = selectionClientRects(at(0, 0), at(1, 1))
    expect(rects).toHaveLength(2)
    expect(rects[0]).toEqual({ left: 0, top: 100, width: 80, height: 24 })
    // 行中心 (202+223)/2 = 212.5 → 行带 24 高：200.5..224.5；内层 run 被外盒包含 → 并到外盒宽度
    expect(rects[1]).toEqual({ left: 0, top: 200.5, width: 40, height: 24 })
  })

  test('同一块多行：逐行独立成段，不跨行合并、各自对齐行带', () => {
    buildWithBlocks(['abcdef'])
    stubRectsByBlock({
      b0: [
        { left: 0, top: 100, width: 100, height: 24 }, // 第 1 行
        { left: 0, top: 124, width: 50, height: 24 }, // 第 2 行前半
        { left: 50, top: 126, width: 30, height: 21 }, // 第 2 行的 chip 外盒
        { left: 54, top: 126, width: 22, height: 21 }, // 其内层文本 run
      ],
    })
    expect(selectionClientRects(at(0, 0), at(0, 6))).toEqual([
      { left: 0, top: 100, width: 100, height: 24 },
      { left: 0, top: 124, width: 80, height: 24 },
    ])
  })

  test('相邻行带因字体溢出而重叠 1px → 按中点切分，不留叠层细线', () => {
    buildWithBlocks(['abcdef'])
    stubRectsByBlock({
      b0: [
        { left: 0, top: 100, width: 100, height: 24 },
        { left: 0, top: 123, width: 60, height: 24 }, // 与上一行带重叠 1px
      ],
    })
    expect(selectionClientRects(at(0, 0), at(0, 6))).toEqual([
      { left: 0, top: 100, width: 100, height: 23.5 },
      { left: 0, top: 123.5, width: 60, height: 23.5 },
    ])
  })

  test('行内真有横向空隙（> 0.75px）→ 保持两段，不误合并', () => {
    buildWithBlocks(['abcdef'])
    stubRectsByBlock({
      b0: [
        { left: 0, top: 100, width: 20, height: 24 },
        { left: 60, top: 100, width: 20, height: 24 },
      ],
    })
    expect(selectionClientRects(at(0, 0), at(0, 6))).toEqual([
      { left: 0, top: 100, width: 20, height: 24 },
      { left: 60, top: 100, width: 20, height: 24 },
    ])
  })
})
