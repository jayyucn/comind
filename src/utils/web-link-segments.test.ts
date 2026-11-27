import { describe, expect, it } from 'vitest'

import type { RenderSegment } from '../wasm/types'
import { buildMergedChipSegments, patchChipRewrite, splitChipSegments } from './web-link-segments'

/** 便捷构造 */
const text = (start: number, end: number): RenderSegment => ({ type: 'text', start, end })
const ext = (start: number, end: number, url: string, display: string): RenderSegment =>
  ({ type: 'external_link', start, end, url, display_text: display })

const URL_ = 'https://www.doubao.com'

/** 「前文本 [chip] 后文本」的典型段（严格分区） */
function sampleSegs(beforeText: string, title: string, afterText: string): RenderSegment[] {
  const segs: RenderSegment[] = []
  let pos = 0
  if (beforeText) {
    segs.push(text(0, beforeText.length))
    pos = beforeText.length
  }
  const lit = `[${title}](${URL_})`
  segs.push(ext(pos, pos + lit.length, URL_, title))
  pos += lit.length
  if (afterText) segs.push(text(pos, pos + afterText.length))
  return segs
}

describe('patchChipRewrite（单 chip 字面改写）', () => {
  it('别名切换：chip 段原位替换，前后段平移，新分区恰好覆盖新 content', () => {
    // content = "起始[URL](URL) 结束"（URL 字面长 26）
    const old = sampleSegs('起始', URL_, ' 结束')
    const literal = '[doubao.com](https://www.doubao.com)' // 别名变短
    const nextContent = `起始${literal} 结束`
    const segs = patchChipRewrite(old, 2, 2 + `[${URL_}](${URL_})`.length, literal, nextContent.length, {
      url: URL_,
      displayText: 'doubao.com',
    })
    expect(segs).not.toBeNull()
    expect(segs!.length).toBe(3)
    const [a, b, c] = segs!
    expect(a).toEqual(text(0, 2))
    expect(b).toEqual(ext(2, 2 + literal.length, URL_, 'doubao.com'))
    expect(c).toEqual(text(2 + literal.length, nextContent.length))
  })

  it('移除链接：chip 段落成 text 段', () => {
    const old = sampleSegs('起始', URL_, ' 结束')
    const nextContent = '起始doubao.com 结束'
    const segs = patchChipRewrite(old, 2, 2 + `[${URL_}](${URL_})`.length, 'doubao.com', nextContent.length)
    expect(segs).not.toBeNull()
    expect(segs![1]).toEqual(text(2, 2 + 'doubao.com'.length))
  })

  it('chip 位于开头 / 结尾：空侧无段，分区仍完整', () => {
    const old = sampleSegs('', URL_, ' 结束')
    const nextContent = `x${' 结束'}`
    const segs = patchChipRewrite(old, 0, `[${URL_}](${URL_})`.length, 'x', nextContent.length, { url: URL_, displayText: 'x' })
    expect(segs).not.toBeNull()
    expect(segs![0]).toEqual(ext(0, 1, URL_, 'x'))
  })

  it('段与 chip 局部重叠（段不可信）→ null', () => {
    const old: RenderSegment[] = [
      text(0, 10), // 覆盖了 chip 起点但不是 chip 段
      ext(5, 31, URL_, URL_), // 与前段重叠
    ]
    expect(patchChipRewrite(old, 5, 31, 'x', 11)).toBeNull()
  })

  it('找不到精确匹配的 external_link 段 → null', () => {
    const old = [text(0, 31)] // chip 藏在 text 段里（段过期）
    expect(patchChipRewrite(old, 2, 28, 'x', 5, { url: URL_, displayText: 'x' })).toBeNull()
  })

  it('构造结果不是完整分区 → null（绝不丢字）', () => {
    // 旧段本身不覆盖到 content 末尾（缺尾巴）
    const old = [text(0, 2), ext(2, 28, URL_, URL_)]
    // 真实 content 还有 " 结束"（6 字），旧段没覆盖 → 分区校验失败
    expect(patchChipRewrite(old, 2, 28, 'x', 2 + 1 + 6)).toBeNull()
  })
})

describe('buildMergedChipSegments（卡片 → chip 三段合并）', () => {
  it('前+chip+后：段拼接并平移，覆盖合并 content', () => {
    const beforeSegs = sampleSegs('起始', '旧链', '') // 前邻居自身含 chip 的场景也成立
    const beforeLen = `起始[旧链](${URL_})`.length
    const afterLen = 4 // " 结束"
    const chipLit = `[${URL_}](${URL_})`
    const total = beforeLen + chipLit.length + afterLen
    const merged = buildMergedChipSegments(
      { segs: beforeSegs, length: beforeLen },
      { segs: [text(0, afterLen)], length: afterLen },
      chipLit,
      URL_,
      URL_,
      total,
    )
    expect(merged).not.toBeNull()
    const last = merged![merged!.length - 1]
    expect(last.end).toBe(total)
  })

  it('无邻居：纯 chip 一段', () => {
    const merged = buildMergedChipSegments(undefined, undefined, `[t](${URL_})`, URL_, 't', `[t](${URL_})`.length)
    expect(merged).toEqual([ext(0, `[t](${URL_})`.length, URL_, 't')])
  })

  it('邻居存在但缺段 → null', () => {
    expect(
      buildMergedChipSegments(
        { segs: undefined, length: 5 },
        undefined,
        `[t](${URL_})`,
        URL_,
        't',
        5 + `[t](${URL_})`.length,
      ),
    ).toBeNull()
  })
})

describe('splitChipSegments（chip → 卡片 拆分）', () => {
  it('chip 居中：前/后段各自成完整分区，后份平移到新坐标系', () => {
    const old = sampleSegs('起始', URL_, ' 结束')
    const chipStart = 2
    const chipEnd = chipStart + `[${URL_}](${URL_})`.length
    const split = splitChipSegments(old, chipStart, chipEnd)
    expect(split).not.toBeNull()
    expect(split!.before).toEqual([text(0, 2)])
    expect(split!.after).toEqual([text(0, 3)]) // ' 结束' 平移后从 0 起
  })

  it('chip 在开头：before 为空分区', () => {
    const old = sampleSegs('', URL_, ' 结束')
    const split = splitChipSegments(old, 0, `[${URL_}](${URL_})`.length)
    expect(split).not.toBeNull()
    expect(split!.before).toEqual([])
    expect(split!.after).toEqual([text(0, 3)])
  })

  it('chip 在结尾：after 为空分区', () => {
    const old = sampleSegs('起始', URL_, '')
    const split = splitChipSegments(old, 2, 2 + `[${URL_}](${URL_})`.length)
    expect(split).not.toBeNull()
    expect(split!.before).toEqual([text(0, 2)])
    expect(split!.after).toEqual([])
  })

  it('无精确 chip 段 → null', () => {
    expect(splitChipSegments([text(0, 31)], 2, 28)).toBeNull()
  })
})
