import { describe, expect, it } from 'vitest'

import { planChipToCard } from './web-link-split'
import { findWebLinkChips } from '../utils/web-link-chip'

describe('chip → 卡片拆建计划（ADR-0067 D3）', () => {
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
})
