import { describe, expect, it } from 'vitest'

import { planCardToChip, planChipToCard } from './web-link-split'
import { findWebLinkChips } from '../utils/web-link-chip'

describe('chip ↔ 卡片拆建计划（ADR-0067 D3）', () => {
  it('chip 切卡片：前后文本拆成两段，空侧不建块', () => {
    const content = '参见 [飞书文档](https://feishu.cn/x) 了解更多'
    const chip = findWebLinkChips(content)[0]
    const plan = planChipToCard({ content, ...chip, pos: 1000 })
    expect(plan).toMatchObject({
      keepAsBefore: true,
      before: '参见 ',
      after: ' 了解更多',
      url: 'https://feishu.cn/x',
      title: '飞书文档',
      pos: 1000,
    })
  })

  it('纯 chip（前后无文本）：原块可删/复用，前后为空', () => {
    const content = '[站点](https://a.com)'
    const chip = findWebLinkChips(content)[0]
    const plan = planChipToCard({ content, ...chip, pos: 2000 })
    expect(plan.keepAsBefore).toBe(false)
    expect(plan.before).toBe('')
    expect(plan.after).toBe('')
  })

  it('卡片切回 chip：前后文本合并，列出待删块 id', () => {
    const plan = planCardToChip({
      url: 'https://a.com',
      title: '站点',
      beforeContent: '参见 ',
      beforeId: 'before-1',
      afterContent: ' 了解更多',
      afterId: 'after-1',
    })
    expect(plan.content).toBe('参见 [站点](https://a.com) 了解更多')
    expect(plan.removeIds).toEqual(['before-1', 'after-1'])
  })

  it('合并结果能被 chip 解析器识别（往返不丢语法）', () => {
    const plan = planCardToChip({ url: 'https://a.com/x?y=1', title: 'A' })
    const chips = findWebLinkChips(plan.content)
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({ url: 'https://a.com/x?y=1', title: 'A' })
  })
})
