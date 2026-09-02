// epub-cfi 单测（票 04 TDD 先行 / 票 05 复用）：CFI 生成/解析往返。
// 关键不变量（ADR-0040 D1/D6/D7）：CFI 生成与解析必须基于 sanitize 后的同构
// DOM——本测试的容器内容即 sanitize 产物形态（只含 element/text 节点）。
// 「DOM 同构重建后仍定位同一文字」用例即「排版变化后锚点不失效」的地基：
// 改字号/行宽重开 = 同构 DOM 重建，CFI 不依赖布局与节点身份，只依赖结构路径。
import { describe, it, expect, afterEach } from 'vitest'
import { cfiFromRange, cfiToRange, cfiToSpineIndex } from './epub-cfi'

/**
 * 构造「sanitize 产物形态」的正文容器：innerHTML 解析可能引入注释等
 * sanitize 不会产出的节点，用例中避免；容器结构模拟 ChapterContent。
 */
function setupContent(html: string): HTMLElement {
  const container = document.createElement('div')
  container.className = 'chapter-content'
  container.innerHTML = html
  document.body.appendChild(container)
  return container
}

/** 容器内按标签取首个元素的文本节点 */
function textNode(container: HTMLElement, selector: string, nthText = 0): Text {
  const el = container.querySelector(selector)
  if (!el) throw new Error(`missing ${selector}`)
  const texts = Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE)
  const node = texts[nthText]
  if (!node) throw new Error(`missing text ${nthText} in ${selector}`)
  return node as Text
}

function makeRange(start: Node, startOffset: number, end: Node, endOffset: number): Range {
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  return range
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('epub-cfi 生成 → 解析往返', () => {
  it('同一选区两次生成 CFI 相等（确定性）', () => {
    const container = setupContent(
      '<h1>第一章</h1><p>山月不知心底事。</p><p>水风空落眼前花。</p>',
    )
    const t1 = textNode(container, 'p')
    const range = makeRange(t1, 0, t1, 5)

    const a = cfiFromRange(container, range, 0)
    const b = cfiFromRange(container, range, 0)
    expect(a).toBeTruthy()
    expect(a).toBe(b)
    expect(a.startsWith('epubcfi(/6/')).toBe(true)
  })

  it('解析回的 Range 与原 Range 文本一致（单段内选区）', () => {
    const container = setupContent('<p>山月不知心底事。</p>')
    const t = textNode(container, 'p')
    const range = makeRange(t, 2, t, 7)

    const cfi = cfiFromRange(container, range, 1)
    const restored = cfiToRange(container, cfi)
    expect(restored).not.toBeNull()
    expect(restored!.toString()).toBe(range.toString())
    // '山月不知心底事。'.slice(2, 7)
    expect(restored!.toString()).toBe('不知心底事')
  })

  it('跨元素选区（p1 尾 → p2 头）往返一致', () => {
    const container = setupContent(
      '<p>第一段结尾。</p><p>第二段开头。</p>',
    )
    const t1 = textNode(container, 'p:nth-child(1)')
    const t2 = textNode(container, 'p:nth-child(2)')
    const range = makeRange(t1, 4, t2, 4)

    const cfi = cfiFromRange(container, range, 0)
    const restored = cfiToRange(container, cfi)
    expect(restored).not.toBeNull()
    expect(restored!.toString()).toBe(range.toString())
    // '第一段结尾。'[4..] + '第二段开头。'[:4]
    expect(restored!.toString()).toBe('尾。第二段开')
  })

  it('含内联标签的选区（跨 <em> 边界）往返一致', () => {
    const container = setupContent(
      '<p>前文<em>强调部分</em>后文收尾</p>',
    )
    const before = textNode(container, 'p')
    const emText = textNode(container, 'em')
    const range = makeRange(before, 1, emText, 2)

    const cfi = cfiFromRange(container, range, 0)
    const restored = cfiToRange(container, cfi)
    expect(restored).not.toBeNull()
    expect(restored!.toString()).toBe('文强调')
  })

  it('同父相邻文本节点（chunk 合并场景，unwrap 产生）往返一致', () => {
    // sanitize 对未知标签 unwrap 会产出同父相邻 text 节点
    // （<p>a<x/>b</p> → <p>ab</p> 两个 text），foliate 按合并 chunk 计偏移
    const container = setupContent('<p>甲</p>')
    const p = container.querySelector('p')!
    const t1 = document.createTextNode('乙')
    const t2 = document.createTextNode('丙丁')
    p.append(t1, t2)

    const range = makeRange(t1, 1, t2, 2)
    const cfi = cfiFromRange(container, range, 0)
    const restored = cfiToRange(container, cfi)
    expect(restored).not.toBeNull()
    expect(restored!.toString()).toBe('丙丁')
    // 合并 chunk 内 offset 1 解析回「t1 末尾」（与 t2 开头同一文字位置）
    expect(restored!.startContainer).toBe(t1)
    expect(restored!.startOffset).toBe(1)
  })

  it('collapsed Range 生成点 CFI，解析回 collapsed 且位置一致', () => {
    const container = setupContent('<p>山月不知心底事。</p>')
    const t = textNode(container, 'p')
    const range = makeRange(t, 3, t, 3)

    const cfi = cfiFromRange(container, range, 0)
    // 点 CFI：不含逗号（range CFI 的逗号形态）
    expect(cfi.includes(',')).toBe(false)

    const restored = cfiToRange(container, cfi)
    expect(restored).not.toBeNull()
    expect(restored!.collapsed).toBe(true)
    expect(restored!.startContainer).toBe(t)
    expect(restored!.startOffset).toBe(3)
  })

  it('DOM 同构重建后（模拟改排版重开/章节重渲染）CFI 仍定位同一文字', () => {
    const container = setupContent(
      '<h1>第一章</h1><p>山月不知心底事。</p><p>水风空落眼前花。</p>',
    )
    const t = textNode(container, 'p:nth-child(3)')
    const range = makeRange(t, 2, t, 6)
    const cfi = cfiFromRange(container, range, 0)

    // 拆掉重建同构 DOM（节点身份全变，结构相同）
    container.remove()
    const rebuilt = setupContent(
      '<h1>第一章</h1><p>山月不知心底事。</p><p>水风空落眼前花。</p>',
    )
    const restored = cfiToRange(rebuilt, cfi)
    expect(restored).not.toBeNull()
    // '水风空落眼前花。'.slice(2, 6)
    expect(restored!.toString()).toBe('空落眼前')
  })

  it('cfiToSpineIndex 提取生成时的 spine 序号', () => {
    const container = setupContent('<p>文字</p>')
    const t = textNode(container, 'p')
    const range = makeRange(t, 0, t, 2)

    expect(cfiToSpineIndex(cfiFromRange(container, range, 0))).toBe(0)
    expect(cfiToSpineIndex(cfiFromRange(container, range, 3))).toBe(3)
    expect(cfiToSpineIndex(cfiFromRange(container, range, 17))).toBe(17)
  })
})

describe('epub-cfi 解析容错', () => {
  it('指向不存在节点的 CFI 返回 null（书文件变更等），不 throw', () => {
    const container = setupContent('<p>只有一段。</p>')
    // 深度越界的路径
    const bad = 'epubcfi(/6/2!/4/2/999/999:0)'
    expect(cfiToRange(container, bad)).toBeNull()
  })

  it('畸形 CFI 字符串返回 null，不 throw', () => {
    const container = setupContent('<p>只有一段。</p>')
    expect(cfiToRange(container, 'not-a-cfi')).toBeNull()
    expect(cfiToRange(container, '')).toBeNull()
    expect(cfiToRange(container, 'epubcfi()')).toBeNull()
  })

  it('cfiToSpineIndex 对非 /6/N 前缀返回 null', () => {
    expect(cfiToSpineIndex('epubcfi(/4/2:0)')).toBeNull()
    expect(cfiToSpineIndex('garbage')).toBeNull()
  })
})
