import { describe, it, expect } from 'vitest'
import { padInlineUnit, padUnitForDoc } from './inline-unit-pad'

/**
 * padInlineUnit 的契约与 date-ref.test.ts 的 padDateRefUnit 12 例逐条对应
 * （date-ref 侧现为 re-export 委托，行为不变）；这里以中性单元名固化
 * 「三种 inline 单元共用同一补空口径」这一事实。
 */
describe('padInlineUnit — inline 单元插入时两侧补空格（防粘连）', () => {
  const u = '#标签'

  it('文字-文字：两侧都补', () => {
    expect(padInlineUnit('a', 'b', u)).toBe(' #标签 ')
  })

  it('中文（非空白）：两侧都补', () => {
    expect(padInlineUnit('任务', '完成', u)).toBe(' #标签 ')
  })

  it('左空白：只补右侧', () => {
    expect(padInlineUnit(' ', 'b', u)).toBe('#标签 ')
  })

  it('右空白：只补左侧', () => {
    expect(padInlineUnit('a', ' ', u)).toBe(' #标签')
  })

  it('两侧空白：不重复补（防双空格）', () => {
    expect(padInlineUnit(' ', ' ', u)).toBe('#标签')
  })

  it('行首（left null）：只补右侧', () => {
    expect(padInlineUnit(null, 'b', u)).toBe('#标签 ')
  })

  it('换行符左侧（行首段首）：补左空格，防单行渲染与上一行粘连', () => {
    expect(padInlineUnit('\n', 'b', u)).toBe(' #标签 ')
  })

  it('行尾（right null）：左侧补 + 行尾补尾空格', () => {
    expect(padInlineUnit('a', null, u)).toBe(' #标签 ')
  })

  it('独立块（两侧 null）：仅补尾空格', () => {
    expect(padInlineUnit(null, null, u)).toBe('#标签 ')
  })

  it('右邻为空字符串视同行尾', () => {
    expect(padInlineUnit('a', '', u)).toBe(' #标签 ')
  })

  it('nbsp 视为空白：不补', () => {
    expect(padInlineUnit('\u00A0', 'b', u)).toBe('#标签 ')
  })

  it('tab 视为空白：不补', () => {
    expect(padInlineUnit('\t', 'b', u)).toBe('#标签 ')
  })

  it('wiki link 单元同样适用（[[X]] 两侧）', () => {
    expect(padInlineUnit('看', '尾', '[[页面]]')).toBe(' [[页面]] ')
  })
})

describe('padUnitForDoc — PM doc 邻字符读取', () => {
  /** 以整块文本模拟 doc.textBetween（单段文档，pos 0 = 段前，正文从 1 开始） */
  function mockDoc(text: string) {
    return {
      textBetween: (from: number, to: number) => {
        // pos 1..len 对应 text[0..len-1]；越界（段前/段后）返回 ''
        const s = from - 1
        const e = to - 1
        if (s < 0 || e > text.length || s > e) return ''
        return text.slice(s, e)
      },
    }
  }

  it('单元在块首（from=1）：textBetween(0,1) 为空 → 按段首补左；右邻空格不补右', () => {
    // PM 坐标：段首文本前的位置是 1；textBetween(0,1) 跨段边界返回 ''
    const doc = mockDoc('#标签 完成')
    expect(padUnitForDoc(doc, 1, 4, '#标签')).toBe(' #标签')
  })

  it('from=0（doc 坐标块首）：不补左；右邻内容字符补右', () => {
    const doc = mockDoc('#标签 完成')
    expect(padUnitForDoc(doc, 0, 3, '#标签')).toBe('#标签 ')
  })

  it('中间替换：左右邻均有空格 → 两侧都不补', () => {
    const doc = mockDoc('任务 #标签 完成')
    // '#标签' 占 pos 4..7，左右邻都是 ' '
    expect(padUnitForDoc(doc, 4, 7, '#标签')).toBe('#标签')
  })

  it('右邻内容字符（无空格）：补右', () => {
    const doc = mockDoc('看 #标签,继续')
    // '#标签' 占 pos 3..6，右邻是 ','
    expect(padUnitForDoc(doc, 3, 6, '#标签')).toBe('#标签 ')
  })

  it('行尾（to=段尾）：补左邻判定 + 补尾随空格', () => {
    const doc = mockDoc('只有 #标签')
    // '#标签' 占 pos 4..7，左邻 ' ' 不补左，右邻越界为 '' → 补尾随
    expect(padUnitForDoc(doc, 4, 7, '#标签')).toBe('#标签 ')
  })

  it('左邻内容字符 + 右邻空格：只补左', () => {
    const doc = mockDoc('看#标签 续')
    // '#标签' 占 pos 2..5，左邻 '看' 补左，右邻 ' ' 不补右
    expect(padUnitForDoc(doc, 2, 5, '#标签')).toBe(' #标签')
  })

  describe('关系语法单元：wiki link 紧跟 ((type)) 收尾时不补左空格', () => {
    /** 带 resolve 的 mock：PM 坐标 pos 的 parentOffset = pos - 1（单段文档） */
    function mockDocResolvable(text: string) {
      return {
        ...mockDoc(text),
        resolve: (pos: number) => ({ parentOffset: pos - 1 }),
      }
    }

    it('左邻 )) （英文括号）：不补左 —— 否则 ))[[ 被劈开、关系语法整体失效', () => {
      const doc = mockDocResolvable('a((rel))')
      // '((rel))' 占 pos 2..8，插入点 pos 9（末尾）；左邻 ')'、再左 ')' → 关系收尾
      expect(padUnitForDoc(doc, 9, 9, '[[页面]]')).toBe('[[页面]] ')
    })

    it('左邻 ））（中文括号）：同样不补左', () => {
      // 'a（（关系））' 共 7 字符，插入点在其后 = pos 8
      const doc = mockDocResolvable('a（（关系））')
      expect(padUnitForDoc(doc, 8, 8, '[[页面]]')).toBe('[[页面]] ')
    })

    it('左邻普通 ) （非关系语法，如 (note)）：照常补左', () => {
      const doc = mockDocResolvable('(note)')
      // ')' 前是 'e' 不是 '(' → 不构成 ((...)) 收尾
      expect(padUnitForDoc(doc, 7, 7, '[[页面]]')).toBe(' [[页面]] ')
    })

    it('同样左邻 ))，但单元是 #tag：照常补左（例外只针对 wiki link）', () => {
      const doc = mockDocResolvable('a((rel))')
      expect(padUnitForDoc(doc, 9, 9, '#标签')).toBe(' #标签 ')
    })
  })
})
