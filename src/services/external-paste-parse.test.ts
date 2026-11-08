import { describe, test, expect } from 'vitest'
import { parseExternalPaste, resolveClipboardForest, COMIND_BLOCK_MIME } from './external-paste-parse'
import type { BlockClipPayload } from '../types/block'

function bullet(content: string, children: BlockClipPayload[] = []): BlockClipPayload {
  return { content, type: 'bullet', format: null, properties: null, children }
}

function contents(forest: BlockClipPayload[]): string[] {
  const out: string[] = []
  const walk = (nodes: BlockClipPayload[]) => {
    for (const n of nodes) {
      out.push(n.content)
      walk(n.children)
    }
  }
  walk(forest)
  return out
}

describe('parseExternalPaste — 纯文本', () => {
  test('多行纯文本按行拆分为 bullet', () => {
    const forest = parseExternalPaste({ plain: '第一行\n第二行\n第三行' })
    expect(forest).toHaveLength(3)
    expect(forest.map(b => b.content)).toEqual(['第一行', '第二行', '第三行'])
    expect(forest.every(b => b.type === 'bullet')).toBe(true)
  })

  test('每行 trim 且跳过空行', () => {
    const forest = parseExternalPaste({ plain: '  a  \n\n\nb\n   \n' })
    expect(forest.map(b => b.content)).toEqual(['a', 'b'])
  })

  test('空输入返回空数组', () => {
    expect(parseExternalPaste({ plain: '' })).toEqual([])
    expect(parseExternalPaste({ plain: ' \n \n ' })).toEqual([])
    expect(parseExternalPaste({})).toEqual([])
  })
})

describe('parseExternalPaste — HTML（优先于纯文本）', () => {
  test('同时有 html 与 plain 时取 html', () => {
    const forest = parseExternalPaste({ html: '<p>html行</p>', plain: 'plain行' })
    expect(contents(forest)).toEqual(['html行'])
  })

  test('<p> 映射为 bullet', () => {
    const forest = parseExternalPaste({ html: '<p>段落</p>' })
    expect(forest).toHaveLength(1)
    expect(forest[0].type).toBe('bullet')
    expect(forest[0].content).toBe('段落')
  })

  test('<h1>-<h6> 映射为 # 前缀 bullet', () => {
    const forest = parseExternalPaste({ html: '<h1>标题一</h1><h3>标题三</h3>' })
    expect(forest.map(b => b.content)).toEqual(['# 标题一', '### 标题三'])
  })

  test('<pre> 映射为 code 块且保留换行', () => {
    const forest = parseExternalPaste({ html: '<pre>line1\nline2</pre>' })
    expect(forest).toHaveLength(1)
    expect(forest[0].type).toBe('code')
    expect(forest[0].content).toBe('line1\nline2')
  })

  test('<ul> 嵌套列表保留层级（子项进入 children）', () => {
    const html = '<ul><li>父项<ul><li>子项1</li><li>子项2</li></ul></li><li>平级项</li></ul>'
    const forest = parseExternalPaste({ html })
    expect(forest).toHaveLength(2)
    expect(forest[0].content).toBe('父项')
    expect(forest[0].children.map(c => c.content)).toEqual(['子项1', '子项2'])
    expect(forest[1].content).toBe('平级项')
  })

  test('<ol> 同样保留嵌套', () => {
    const html = '<ol><li>一<ol><li>一点一</li></ol></li></ol>'
    const forest = parseExternalPaste({ html })
    expect(forest[0].children).toHaveLength(1)
    expect(forest[0].children[0].content).toBe('一点一')
  })

  test('列表项内的行内标签折叠为纯文本', () => {
    const html = '<ul><li>加粗 <b>内容</b> 与 <i>斜体</i></li></ul>'
    const forest = parseExternalPaste({ html })
    expect(forest[0].content).toBe('加粗 内容 与 斜体')
  })

  test('script/style 内容被剥离，不产生 block', () => {
    const html = '<p>可见</p><script>alert("xss")</script><style>.a{color:red}</style>'
    const forest = parseExternalPaste({ html })
    expect(contents(forest)).toEqual(['可见'])
  })

  test('on* 事件属性与 javascript: 协议不影响产出（仅提取文本）', () => {
    const html = '<p onclick="evil()">文本<a href="javascript:evil()">链接文字</a></p>'
    const forest = parseExternalPaste({ html })
    expect(forest).toHaveLength(1)
    expect(forest[0].content).toBe('文本链接文字')
  })

  test('<img> 被忽略（v1）', () => {
    const html = '<p>前</p><img src="https://example.com/a.png" alt="图"><p>后</p>'
    const forest = parseExternalPaste({ html })
    expect(contents(forest)).toEqual(['前', '后'])
  })

  test('<blockquote> 退化为普通 bullet（内容展平保留）', () => {
    const html = '<blockquote><p>引用一</p><p>引用二</p></blockquote>'
    const forest = parseExternalPaste({ html })
    expect(contents(forest)).toEqual(['引用一', '引用二'])
    expect(forest.every(b => b.type === 'bullet')).toBe(true)
  })

  test('非列表嵌套（div 套 div）展平为同级', () => {
    const html = '<div><div>内层一</div><div>内层二</div></div>'
    const forest = parseExternalPaste({ html })
    expect(contents(forest)).toEqual(['内层一', '内层二'])
    expect(forest.every(b => b.children.length === 0)).toBe(true)
  })

  test('未知标签 unwrap 为文本', () => {
    const html = '<custom-tag>自定义内容</custom-tag>'
    const forest = parseExternalPaste({ html })
    expect(contents(forest)).toEqual(['自定义内容'])
  })

  test('<br> 视为换行拆分为多个 block', () => {
    const html = '<p>第一行<br>第二行</p>'
    const forest = parseExternalPaste({ html })
    expect(contents(forest)).toEqual(['第一行', '第二行'])
  })

  test('顶层游离文本节点映射为 bullet', () => {
    const forest = parseExternalPaste({ html: '游离文字' })
    expect(contents(forest)).toEqual(['游离文字'])
  })

  test('纯空白内容不产生 block', () => {
    const html = '<p>  </p><div>\n\t</div>'
    expect(parseExternalPaste({ html })).toEqual([])
  })

  test('外部载荷的 properties 恒为 null', () => {
    const forest = parseExternalPaste({ html: '<p>x</p>' })
    expect(forest[0].properties).toBeNull()
  })
})

describe('parseExternalPaste — 表格（ADR-0061）', () => {
  function tableDataOf(forest: BlockClipPayload[]) {
    const node = forest.find(b => b.type === 'table')
    return node?.format?.['table'] as undefined | { rows: string[][]; header: boolean }
  }

  test('HTML 表格 → 单个 table 块，不再逐格拆 bullet', () => {
    const html = '<table><tr><th>列一</th><th>列二</th></tr><tr><td>a</td><td>b</td></tr></table>'
    const forest = parseExternalPaste({ html })
    expect(forest).toHaveLength(1)
    expect(forest[0]!.type).toBe('table')
    expect(forest[0]!.content).toBe('')
    expect(forest[0]!.children).toEqual([])
    expect(tableDataOf(forest)!.rows).toEqual([['列一', '列二'], ['a', 'b']])
  })

  test('段落 + 表格混合 → 只把表格抽成 table 节点，其余照旧', () => {
    const html = '<p>前置</p><table><tr><td>1</td><td>2</td></tr></table><p>后续</p>'
    const forest = parseExternalPaste({ html })
    expect(forest.map(b => b.type)).toEqual(['bullet', 'table', 'bullet'])
    expect(forest[0]!.content).toBe('前置')
    expect(forest[2]!.content).toBe('后续')
  })

  test('单列表格仍是布局容器 → 沿用旧展平（不产 table 块）', () => {
    const html = '<table><tr><td><div>块一</div><div>块二</div></td></tr></table>'
    const forest = parseExternalPaste({ html })
    expect(forest.every(b => b.type === 'bullet')).toBe(true)
    expect(contents(forest)).toEqual(['块一', '块二'])
  })

  test('纯文本 GFM 表格 → table 块', () => {
    const plain = '前置\n| a | b |\n| --- | --- |\n| 1 | 2 |'
    const forest = parseExternalPaste({ plain })
    expect(forest.map(b => b.type)).toEqual(['bullet', 'table'])
    expect(tableDataOf(forest)!.rows).toEqual([['a', 'b'], ['1', '2']])
  })

  test('纯文本 TSV → 单个 table 块', () => {
    const forest = parseExternalPaste({ plain: 'a\tb\n1\t2' })
    expect(forest).toHaveLength(1)
    expect(forest[0]!.type).toBe('table')
    expect(tableDataOf(forest)!.header).toBe(false)
  })

  test('TSV 列数不一致 → 回落逐行 bullet', () => {
    const forest = parseExternalPaste({ plain: 'a\tb\n1\t2\t3' })
    expect(forest.every(b => b.type === 'bullet')).toBe(true)
    expect(forest.map(b => b.content)).toEqual(['a\tb', '1\t2\t3'])
  })
})

describe('resolveClipboardForest — 粘贴分发决策', () => {
  function dataWith(map: Record<string, string>) {
    return (mime: string) => map[mime] ?? ''
  }

  test('命中内部 MIME 时返回内部载荷森林', () => {
    const payload = { version: 1, kind: 'blocks', blocks: [bullet('内部块')] }
    const forest = resolveClipboardForest(dataWith({
      [COMIND_BLOCK_MIME]: JSON.stringify(payload),
      'text/plain': '内部块',
    }))
    expect(forest).toHaveLength(1)
    expect(forest![0].content).toBe('内部块')
  })

  test('内部 MIME JSON 损坏时回落外部解析', () => {
    const forest = resolveClipboardForest(dataWith({
      [COMIND_BLOCK_MIME]: '{broken json',
      'text/plain': '回退行',
    }))
    expect(forest!.map(b => b.content)).toEqual(['回退行'])
  })

  test('无内部 MIME 时按外部规则解析（html 优先）', () => {
    const forest = resolveClipboardForest(dataWith({
      'text/html': '<h2>外部标题</h2>',
      'text/plain': '外部标题',
    }))
    expect(forest!.map(b => b.content)).toEqual(['## 外部标题'])
  })

  test('剪贴板无任何内容时返回 null', () => {
    expect(resolveClipboardForest(dataWith({}))).toBeNull()
  })

  test('内部载荷 kind 不符时回落外部解析', () => {
    const forest = resolveClipboardForest(dataWith({
      [COMIND_BLOCK_MIME]: JSON.stringify({ version: 1, kind: 'other', blocks: [] }),
      'text/plain': '文本',
    }))
    expect(forest!.map(b => b.content)).toEqual(['文本'])
  })
})
