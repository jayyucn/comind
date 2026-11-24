import { describe, test, expect } from 'vitest'

import { parseGfmTable, parseHtmlTableData, parseTsvTable, tablePayload } from './table-paste-parse'
import type { TableData } from './table-model'

function htmlTable(inner: string): Element {
  const doc = new DOMParser().parseFromString(`<table>${inner}</table>`, 'text/html')
  return doc.querySelector('table')!
}

function parse(inner: string): TableData | null {
  return parseHtmlTableData(htmlTable(inner))
}

describe('parseHtmlTableData — 基础形状', () => {
  test('<th> 首行 → header=true，内容按行列落格', () => {
    const data = parse('<tr><th>列一</th><th>列二</th></tr><tr><td>a</td><td>b</td></tr>')!
    expect(data).not.toBeNull()
    expect(data.header).toBe(true)
    expect(data.rows).toEqual([['列一', '列二'], ['a', 'b']])
  })

  test('<thead> 存在 → header=true（即使单元格是 td）', () => {
    const data = parse('<thead><tr><td>甲</td><td>乙</td></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>')!
    expect(data.header).toBe(true)
  })

  test('无 th/thead → header=false（Excel 复制的典型形态）', () => {
    const data = parse('<tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr>')!
    expect(data.header).toBe(false)
  })

  test('行列不齐时补齐为矩形', () => {
    const data = parse('<tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr>')!
    expect(data.rows).toEqual([['a', 'b', 'c'], ['d', '', '']])
  })

  test('单列表格 → null（视为布局容器）', () => {
    expect(parse('<tr><td>只有一列</td></tr><tr><td>还是只有一列</td></tr>')).toBeNull()
  })

  test('空表格 → null', () => {
    expect(parse('')).toBeNull()
  })
})

describe('parseHtmlTableData — 合并与对齐', () => {
  test('colspan → merges 且被覆盖格不重复出值', () => {
    const data = parse('<tr><td colspan="2">跨两列</td><td>右上</td></tr><tr><td>1</td><td>2</td><td>3</td></tr>')!
    expect(data.merges).toEqual([{ row1: 0, col1: 0, row2: 0, col2: 1 }])
    expect(data.rows[0]![0]).toBe('跨两列')
    expect(data.rows[0]![1]).toBe('')
  })

  test('rowspan → merges', () => {
    const data = parse('<tr><td rowspan="2">跨两行</td><td>b1</td></tr><tr><td>b2</td></tr>')!
    expect(data.merges).toEqual([{ row1: 0, col1: 0, row2: 1, col2: 0 }])
    expect(data.rows[1]![0]).toBe('')
  })

  test('colspan 与 rowspan 同时作用', () => {
    const data = parse(
      '<tr><td rowspan="2" colspan="2">块</td><td>x</td></tr><tr><td>y</td></tr>',
    )!
    expect(data.merges).toEqual([{ row1: 0, col1: 0, row2: 1, col2: 1 }])
    expect(data.rows[0]![2]).toBe('x')
    // 第二行唯一格落在第 3 列（前两列被合并区占掉）
    expect(data.rows[1]![2]).toBe('y')
  })

  test('inline text-align 落到逐格 aligns', () => {
    const data = parse(
      '<tr><td style="text-align: right">右</td><td>左</td></tr>',
    )!
    expect(data.aligns['0:0']).toBe('right')
    expect(data.aligns['0:1']).toBeUndefined()
  })

  test('align 属性同样生效', () => {
    const data = parse('<tr><td align="center">中</td><td>x</td></tr>')!
    expect(data.aligns['0:0']).toBe('center')
  })
})

describe('parseHtmlTableData — 文本降级', () => {
  test('链接取文本、加粗展开、图片丢弃', () => {
    const data = parse(
      '<tr><td><a href="https://example.com">链接</a><strong>粗</strong><img src="a.png"></td><td>y</td></tr>',
    )!
    expect(data.rows[0]![0]).toBe('链接粗')
  })

  test('<br> 拍成空格（单元格单行约束）', () => {
    const data = parse('<tr><td>第一行<br>第二行</td><td>y</td></tr>')!
    expect(data.rows[0]![0]).toBe('第一行 第二行')
  })

  test('script/style 内容整枝丢弃', () => {
    const data = parse('<tr><td>可见<script>evil()</script></td><td>y</td></tr>')!
    expect(data.rows[0]![0]).toBe('可见')
  })

  test('嵌套表格按行优先拍平成一行填进外层格', () => {
    // 外层只有一列 → 仍是布局容器
    const single = parse('<tr><td><table><tr><td>内a</td><td>内b</td></tr></table></td></tr>')
    expect(single).toBeNull()

    const wide = parse(
      '<tr><td><table><tr><td>内a</td><td>内b</td></tr><tr><td>内c</td><td>内d</td></tr></table></td><td>右</td></tr>',
    )!
    expect(wide.rows[0]![0]).toBe('内a 内b 内c 内d')
    expect(wide.rows[0]![1]).toBe('右')
  })
})

describe('parseGfmTable', () => {
  test('表头 + 分隔行 + 数据行', () => {
    const lines = ['| 列一 | 列二 |', '| --- | --- |', '| a | b |', '| c | d |']
    const result = parseGfmTable(lines, 0)!
    expect(result.data.header).toBe(true)
    expect(result.data.rows).toEqual([['列一', '列二'], ['a', 'b'], ['c', 'd']])
    expect(result.consumed).toBe(4)
  })

  test('分隔行的 :---: / ---: → 整列 aligns', () => {
    const lines = ['| 左 | 中 | 右 |', '| --- | :---: | ---: |', '| a | b | c |']
    const result = parseGfmTable(lines, 0)!
    expect(result.data.aligns['0:1']).toBe('center')
    expect(result.data.aligns['1:1']).toBe('center')
    expect(result.data.aligns['1:2']).toBe('right')
    expect(result.data.aligns['0:0']).toBeUndefined()
  })

  test('转义的 \\| 还原为字面竖线', () => {
    const lines = ['| a\\|b | c |', '| --- | --- |', '| 1 | 2 |']
    const result = parseGfmTable(lines, 0)!
    expect(result.data.rows[0]![0]).toBe('a|b')
  })

  test('缺少分隔行 → null', () => {
    expect(parseGfmTable(['| a | b |', '| 1 | 2 |'], 0)).toBeNull()
  })

  test('单列表格 → null', () => {
    expect(parseGfmTable(['| a |', '| --- |'], 0)).toBeNull()
  })

  test('表格在段落中间时从指定行开始且只吃管道行', () => {
    const lines = ['前置段落', '| a | b |', '| --- | --- |', '| 1 | 2 |', '后续段落']
    const result = parseGfmTable(lines, 1)!
    expect(result.data.rows).toHaveLength(2)
    expect(result.consumed).toBe(3)
  })

  test('无外围管道符的 GFM 行同样识别', () => {
    const result = parseGfmTable(['a | b', '--- | ---', '1 | 2'], 0)!
    expect(result.data.rows).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('parseTsvTable', () => {
  test('2 行 2 列 → header=false', () => {
    const data = parseTsvTable('a\tb\n1\t2')!
    expect(data.header).toBe(false)
    expect(data.rows).toEqual([['a', 'b'], ['1', '2']])
  })

  test('尾部空行忽略', () => {
    const data = parseTsvTable('a\tb\n1\t2\n')!
    expect(data.rows).toHaveLength(2)
  })

  test('引号包裹的单元格可含制表符与换行（Excel 口径）', () => {
    const data = parseTsvTable('a\t"多行\n单元格"\n1\t2')!
    expect(data.rows[0]![1]).toBe('多行 单元格')
    expect(data.rows).toHaveLength(2)
  })

  test('双写引号还原为字面引号', () => {
    const data = parseTsvTable('a\t"说""话"""\n1\t2')!
    expect(data.rows[0]![1]).toBe('说"话"')
  })

  test('列数不一致 → null（整段放弃，不猜段边界）', () => {
    expect(parseTsvTable('a\tb\n1\t2\t3')).toBeNull()
  })

  test('单行 → null', () => {
    expect(parseTsvTable('a\tb')).toBeNull()
  })

  test('单列 → null', () => {
    expect(parseTsvTable('a\nb')).toBeNull()
  })

  test('无制表符 → null', () => {
    expect(parseTsvTable('纯文本\n第二行')).toBeNull()
  })
})

describe('tablePayload', () => {
  test('产出叶子 table 载荷：无 content、无子块、format.table 就位', () => {
    const data = parseTsvTable('a\tb\n1\t2')!
    const payload = tablePayload(data)
    expect(payload).toEqual({
      content: '',
      type: 'table',
      format: { table: data },
      properties: null,
      children: [],
    })
  })
})
