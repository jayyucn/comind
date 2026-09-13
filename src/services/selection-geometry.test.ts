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
import { collapsedRangeAtBlockOffset, selectionClientRects } from './selection-geometry'
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
function painted(rects: DOMRect[]): Array<[number, number]> {
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
