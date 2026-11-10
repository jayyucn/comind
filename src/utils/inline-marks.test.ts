import { describe, expect, it } from 'vitest'

import {
  clearInlineMarkRange,
  inlineMarksToHtml,
  mapInlineMarkOffsets,
  normalizeInlineMarks,
  rangeColorToken,
  rangeHasAttr,
  readInlineMarks,
  sameInlineMarks,
  setInlineMarkRange,
  shiftInlineMarks,
  sliceInlineMarks,
  wrapInlineHtml,
  writeInlineMarks,
} from './inline-marks'

describe('normalizeInlineMarks', () => {
  it('截断越界偏移并丢弃空区间', () => {
    const marks = normalizeInlineMarks(
      [
        { start: -3, end: 3, bold: true },
        { start: 4, end: 4, italic: true },
        { start: 8, end: 99, underline: true },
      ],
      10,
    )
    expect(marks).toEqual([
      { start: 0, end: 3, bold: true },
      { start: 8, end: 10, underline: true },
    ])
  })

  it('重叠区间压平为互不重叠的段，格式取并集', () => {
    const marks = normalizeInlineMarks(
      [
        { start: 0, end: 4, bold: true },
        { start: 2, end: 6, italic: true },
      ],
      6,
    )
    expect(marks).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 2, end: 4, bold: true, italic: true },
      { start: 4, end: 6, italic: true },
    ])
  })

  it('相邻同格式段合并', () => {
    expect(
      normalizeInlineMarks(
        [
          { start: 0, end: 2, bold: true },
          { start: 2, end: 4, bold: true },
        ],
        4,
      ),
    ).toEqual([{ start: 0, end: 4, bold: true }])
  })

  it('非白名单色值被丢弃，其余格式保留', () => {
    expect(
      normalizeInlineMarks([{ start: 0, end: 2, color: 'red', background: '--tag-color-2', strike: true }], 2),
    ).toEqual([{ start: 0, end: 2, strike: true, background: '--tag-color-2' }])
  })

  it('无有效格式 / 非法输入返回空数组', () => {
    expect(normalizeInlineMarks([{ start: 0, end: 2 }], 2)).toEqual([])
    expect(normalizeInlineMarks(null, 2)).toEqual([])
    expect(normalizeInlineMarks([{ start: 0, end: 2, bold: true }], 0)).toEqual([])
  })
})

describe('readInlineMarks / writeInlineMarks', () => {
  it('读写往返，空格式移除 format.inlineMarks', () => {
    const format = writeInlineMarks({ type: 'heading', level: 2 }, [{ start: 0, end: 2, bold: true }])
    expect(format).toEqual({ type: 'heading', level: 2, inlineMarks: [{ start: 0, end: 2, bold: true }] })
    expect(readInlineMarks(format, 2)).toEqual([{ start: 0, end: 2, bold: true }])

    expect(writeInlineMarks(format, [])).toEqual({ type: 'heading', level: 2 })
    expect(readInlineMarks(undefined, 2)).toEqual([])
  })

  it('sameInlineMarks 比较区间与格式', () => {
    const a = [{ start: 0, end: 2, bold: true as const }]
    expect(sameInlineMarks(a, [{ start: 0, end: 2, bold: true }])).toBe(true)
    expect(sameInlineMarks(a, [{ start: 0, end: 3, bold: true }])).toBe(false)
    expect(sameInlineMarks(a, [{ start: 0, end: 2, italic: true }])).toBe(false)
  })
})

describe('sliceInlineMarks / shiftInlineMarks', () => {
  it('按范围切片并平移偏移', () => {
    const marks = [
      { start: 0, end: 3, bold: true as const },
      { start: 5, end: 8, italic: true as const },
    ]
    expect(sliceInlineMarks(marks, 2, 6)).toEqual([
      { start: 0, end: 1, bold: true },
      { start: 3, end: 4, italic: true },
    ])
  })

  it('整体平移并丢弃负区间', () => {
    expect(shiftInlineMarks([{ start: 0, end: 2, bold: true }], 3)).toEqual([
      { start: 3, end: 5, bold: true },
    ])
    expect(shiftInlineMarks([{ start: 0, end: 2, bold: true }], -2)).toEqual([])
  })
})

describe('mapInlineMarkOffsets', () => {
  const spans = [{ from: 4, to: 7, newFrom: 4, newTo: 5 }]

  it('区间前的偏移不变，区间后的偏移按差量平移', () => {
    expect(
      mapInlineMarkOffsets(
        [
          { start: 0, end: 2, bold: true },
          { start: 7, end: 9, italic: true },
        ],
        spans,
        'toNew',
        7,
      ),
    ).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 5, end: 7, italic: true },
    ])
  })

  it('反向映射还原', () => {
    expect(mapInlineMarkOffsets([{ start: 5, end: 7, bold: true }], spans, 'toOrig', 9)).toEqual([
      { start: 7, end: 9, bold: true },
    ])
  })
})

describe('inlineMarksToHtml / wrapInlineHtml', () => {
  it('转义文本并包裹格式', () => {
    expect(inlineMarksToHtml('a<b', [{ start: 0, end: 2, bold: true }])).toBe('<strong>a&lt;</strong>b')
  })

  it('颜色输出 data 属性与 CSS 变量，换行转 <br>', () => {
    expect(inlineMarksToHtml('x\ny', [{ start: 0, end: 3, color: '--tag-color-2' }])).toBe(
      '<span data-inline-color="--tag-color-2" style="color: var(--tag-color-2)">x<br>y</span>',
    )
  })

  it('非法色值不进入 style', () => {
    expect(wrapInlineHtml('x', { color: 'javascript:alert(1)' })).toBe('x')
    expect(wrapInlineHtml('x', { background: 'red' })).toBe('x')
  })

  it('背景色使用低透明度叠色', () => {
    expect(wrapInlineHtml('x', { background: '--tag-color-6' })).toBe(
      '<span data-inline-bg="--tag-color-6" style="background-color: color-mix(in srgb, var(--tag-color-6) 28%, transparent); border-radius: 2px">x</span>',
    )
  })
})

describe('区间级格式读写（跨块选区工具条）', () => {
  it('setInlineMarkRange 只在区间内叠加格式，保留既有其它格式', () => {
    const marks = [{ start: 0, end: 6, italic: true }]
    expect(setInlineMarkRange(marks, 2, 4, { bold: true }, 6)).toEqual([
      { start: 0, end: 2, italic: true },
      { start: 2, end: 4, bold: true, italic: true },
      { start: 4, end: 6, italic: true },
    ])
  })

  it('clearInlineMarkRange 只裁掉区间内的指定格式', () => {
    const marks = [{ start: 0, end: 6, bold: true }]
    expect(clearInlineMarkRange(marks, 2, 4, ['bold'], 6)).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 4, end: 6, bold: true },
    ])
    expect(clearInlineMarkRange([], 0, 3, ['bold'], 3)).toEqual([])
  })

  it('区间未被覆盖的部分单独成段（叠加格式不吞掉相邻空格）', () => {
    expect(setInlineMarkRange([], 1, 3, { underline: true }, 4)).toEqual([
      { start: 1, end: 3, underline: true },
    ])
  })

  it('rangeHasAttr 只有整段覆盖才算激活', () => {
    const marks = [{ start: 0, end: 4, bold: true }]
    expect(rangeHasAttr(marks, 0, 4, 'bold', 4)).toBe(true)
    expect(rangeHasAttr(marks, 0, 5, 'bold', 5)).toBe(false)
    expect(rangeHasAttr(marks, 1, 3, 'italic', 4)).toBe(false)
  })

  it('rangeColorToken 统一 token 才返回，混合或无颜色返回空串', () => {
    const mixed = [
      { start: 0, end: 2, color: '--tag-color-2' },
      { start: 2, end: 4, color: '--tag-color-3' },
    ]
    expect(rangeColorToken(mixed, 0, 2, 'color', 4)).toBe('--tag-color-2')
    expect(rangeColorToken(mixed, 0, 4, 'color', 4)).toBe('')
    expect(rangeColorToken([], 0, 4, 'color', 4)).toBe('')
  })
})
