import { describe, expect, it } from 'vitest'

import {
  chipAliasForView,
  chipAliasLocked,
  chipMetaTitleOf,
  findWebLinkChip,
  findWebLinkChips,
  replaceWebLinkChip,
  splitAroundChip,
  webLinkChipMarkdown,
  webLinkChipOnly,
} from './web-link-chip'

describe('markdown 外链 chip 字面读写（ADR-0067）', () => {
  it('找出正文里的 chip，前后普通文本不丢', () => {
    const content = '参见 [飞书文档](https://www.feishu.cn/docx/abc) 了解更多'
    const chips = findWebLinkChips(content)
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({ title: '飞书文档', url: 'https://www.feishu.cn/docx/abc' })
    expect(content.slice(chips[0].end)).toBe(' 了解更多')
  })

  it('多个 chip 都能找到', () => {
    expect(findWebLinkChips('[A](https://a.com) 和 [B](https://b.com)')).toHaveLength(2)
  })

  it('大小写协议与路径查询串都能解析', () => {
    expect(findWebLinkChips('[X](HTTPS://a.com?x=1)')).toEqual([]) // 协议小写才认（与 Rust 正则同源）
    expect(findWebLinkChips('[X](https://a.com/x?y=1#z)')[0].url).toBe('https://a.com/x?y=1#z')
  })

  it('webLinkChipOnly 只对整块恰有一个 chip 为真', () => {
    expect(webLinkChipOnly('[标题](https://a.com)')?.title).toBe('标题')
    expect(webLinkChipOnly('  [标题](https://a.com)  ')?.title).toBe('标题')
    expect(webLinkChipOnly('前文 [标题](https://a.com)')).toBeNull()
    expect(webLinkChipOnly('[A](https://a.com) [B](https://b.com)')).toBeNull()
  })

  it('findWebLinkChip 按 url + 标题定位，前后文本与多 chip 都不影响', () => {
    const content = '前文 [甲](https://a.com) 与 [乙](https://b.com) 后文'
    // 有前后文本、且不止一个 chip 时仍能定位
    expect(findWebLinkChip(content, { url: 'https://b.com', title: '乙' })?.title).toBe('乙')
    // 同 url 不同别名：靠标题区分
    const same = '[甲](https://a.com) 与 [乙](https://a.com)'
    expect(findWebLinkChip(same, { url: 'https://a.com', title: '乙' })?.title).toBe('乙')
    // 同 url 同别名（手打两份）：取第一个
    const dup = '[甲](https://a.com) 与 [甲](https://a.com)'
    expect(findWebLinkChip(dup, { url: 'https://a.com' })?.start).toBe(0)
    // 找不到 / 空正文
    expect(findWebLinkChip(content, { url: 'https://nope.com' })).toBeNull()
    expect(findWebLinkChip('', { url: 'https://a.com' })).toBeNull()
  })

  it('替换与拆分按字面位置，不误伤同串文本', () => {
    const content = 'x [A](https://a.com) y [A](https://a.com)'
    const span = findWebLinkChips(content)[1]
    expect(replaceWebLinkChip(content, span, '[B](https://b.com)')).toBe('x [A](https://a.com) y [B](https://b.com)')
    expect(splitAroundChip(content, span)).toEqual({
      before: 'x [A](https://a.com) y ',
      after: '',
    })
  })

  it('标题里的方括号被替换成正字，语法不破', () => {
    const md = webLinkChipMarkdown('[标题]', 'https://a.com')
    expect(md).toBe('[｜标题｜](https://a.com)')
    expect(findWebLinkChips(md)).toHaveLength(1)
  })

  it('alias 锁定：抓取标题与当前 chip 文字不同即视为用户改过', () => {
    const chip = findWebLinkChips('[我的备注](https://a.com)')[0]
    expect(chipAliasLocked(chip, '网页原始标题')).toBe(true)
    expect(chipAliasLocked(chip, '我的备注')).toBe(false)
    expect(chipAliasLocked(chip, undefined)).toBe(false)
  })

  it('文本视图互换的别名：链接视图=URL 原文，标题视图走回退链', () => {
    expect(chipAliasForView('https://www.feishu.cn/docx/abc', 'link')).toBe('https://www.feishu.cn/docx/abc')
    // 无存档：域名（旧 chip 行为不变）
    expect(chipAliasForView('https://www.feishu.cn/docx/abc', 'title')).toBe('feishu.cn')
    // 有存档：meta.title 优先
    expect(chipAliasForView('https://www.feishu.cn/docx/abc', 'title', '飞书文档')).toBe('飞书文档')
    // meta.title 恰为 URL：跳过落域名，不能产出 title === url 的字面（会被判成链接视图）
    expect(chipAliasForView('https://www.feishu.cn/docx/abc', 'title', 'https://www.feishu.cn/docx/abc')).toBe('feishu.cn')
    // 无主机名的脏值退回 URL，不能产生空别名（空别名会让 chip 语法直接失效）
    expect(chipAliasForView('https://', 'title')).toBe('https://')
  })

  it('chipMetaTitleOf：按 URL 读存档，空值/脏值忽略', () => {
    const format = { webLinkMetas: { 'https://a.com': 'A 标题', 'https://b.com': '   ' } }
    expect(chipMetaTitleOf(format, 'https://a.com')).toBe('A 标题')
    expect(chipMetaTitleOf(format, 'https://b.com')).toBeUndefined()
    expect(chipMetaTitleOf(format, 'https://c.com')).toBeUndefined()
    expect(chipMetaTitleOf(null, 'https://a.com')).toBeUndefined()
    expect(chipMetaTitleOf({}, 'https://a.com')).toBeUndefined()
  })
})
