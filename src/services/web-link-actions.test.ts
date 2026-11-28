/**
 * chip 动作层的服务级测试：抓取存档/占位跟随 + 标题视图别名回退链（ADR-0067）。
 *
 * store 用裸 pinia（与 blocks-store.test.ts 同款）：无 client 时 save 走
 * 防抖分支静默失败，块状态在内存里可断言。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useBlockStore } from '../stores/blocks'
import { readWebLink, webLinkNeedsFetch } from '../utils/web-link'
import { applyFetchedChipMeta, convertCardToChip, convertChipToCard, switchChipTextView } from './web-link-actions'

const URL_ = 'https://www.doubao.com/chat/123'
const PAGE = 'page-1'

beforeEach(() => {
  setActivePinia(createPinia())
})

async function chipBlock(content: string, format: Record<string, unknown> = {}) {
  const store = useBlockStore()
  const block = await store.createBlock({ pageId: PAGE, content, format })
  return { store, block }
}

describe('applyFetchedChipMeta（抓取收口：存档 + 占位跟随）', () => {
  it('域名占位：alias 换成抓取标题，meta.title 存档', async () => {
    const { store, block } = await chipBlock('看 [doubao.com](https://www.doubao.com/chat/123) 这篇')
    await applyFetchedChipMeta(block.id, URL_, '豆包对话')
    const after = store.getBlock(block.id)!
    expect(after.format.webLinkMetas?.[URL_]).toBe('豆包对话')
    expect(after.content).toBe('看 [豆包对话](https://www.doubao.com/chat/123) 这篇')
  })

  it('用户改过别名：content 不动，存档照常更新', async () => {
    const { store, block } = await chipBlock('看 [我的备注](https://www.doubao.com/chat/123) 这篇')
    await applyFetchedChipMeta(block.id, URL_, '豆包对话')
    const after = store.getBlock(block.id)!
    expect(after.content).toBe('看 [我的备注](https://www.doubao.com/chat/123) 这篇')
    expect(after.format.webLinkMetas?.[URL_]).toBe('豆包对话')
  })

  it('alias 是旧存档：站点改标题后重抓跟随新标题', async () => {
    const { store, block } = await chipBlock('看 [旧标题](https://www.doubao.com/chat/123) 这篇', {
      webLinkMetas: { [URL_]: '旧标题' },
    })
    await applyFetchedChipMeta(block.id, URL_, '新标题')
    const after = store.getBlock(block.id)!
    expect(after.content).toBe('看 [新标题](https://www.doubao.com/chat/123) 这篇')
    expect(after.format.webLinkMetas?.[URL_]).toBe('新标题')
  })

  it('alias 是上一拍同值：不重写 content', async () => {
    const { store, block } = await chipBlock('看 [豆包对话](https://www.doubao.com/chat/123) 这篇', {
      webLinkMetas: { [URL_]: '豆包对话' },
    })
    await applyFetchedChipMeta(block.id, URL_, '豆包对话')
    const after = store.getBlock(block.id)!
    expect(after.content).toBe('看 [豆包对话](https://www.doubao.com/chat/123) 这篇')
    expect(after.format.webLinkMetas?.[URL_]).toBe('豆包对话')
  })

  it('块里没有 chip：只存档，不炸', async () => {
    const { store, block } = await chipBlock('普通文本，没有链接')
    await applyFetchedChipMeta(block.id, URL_, '豆包对话')
    const after = store.getBlock(block.id)!
    expect(after.content).toBe('普通文本，没有链接')
    expect(after.format.webLinkMetas?.[URL_]).toBe('豆包对话')
  })
})

describe('switchChipTextView（标题视图别名取存档回退链）', () => {
  it('有存档：切标题视图写入 meta.title', async () => {
    const { store, block } = await chipBlock('[https://www.doubao.com/chat/123](https://www.doubao.com/chat/123)', {
      webLinkMetas: { [URL_]: '豆包对话' },
    })
    await switchChipTextView(block.id, 'title')
    const after = store.getBlock(block.id)!
    expect(after.content).toBe('[豆包对话](https://www.doubao.com/chat/123)')
  })

  it('无存档（旧 chip）：落域名档，行为不变', async () => {
    const { store, block } = await chipBlock('[https://www.doubao.com/chat/123](https://www.doubao.com/chat/123)')
    await switchChipTextView(block.id, 'title')
    const after = store.getBlock(block.id)!
    expect(after.content).toBe('[doubao.com](https://www.doubao.com/chat/123)')
  })

  it('meta.title 恰为 URL：跳过落域名，不产出链接视图字面', async () => {
    const { store, block } = await chipBlock('[https://www.doubao.com/chat/123](https://www.doubao.com/chat/123)', {
      webLinkMetas: { [URL_]: URL_ },
    })
    await switchChipTextView(block.id, 'title')
    const after = store.getBlock(block.id)!
    expect(after.content).toBe('[doubao.com](https://www.doubao.com/chat/123)')
  })

  it('切回链接视图：别名一律归位 URL 原文', async () => {
    const { store, block } = await chipBlock('[豆包对话](https://www.doubao.com/chat/123)', {
      webLinkMetas: { [URL_]: '豆包对话' },
    })
    await switchChipTextView(block.id, 'link')
    const after = store.getBlock(block.id)!
    expect(after.content).toBe('[https://www.doubao.com/chat/123](https://www.doubao.com/chat/123)')
  })
})

describe('convertCardToChip（就地换形态，不吞并邻居）', () => {
  /** 卡片夹在两段普通文本中间：视图切换只动卡片块自己 */
  async function cardBetweenTexts() {
    const store = useBlockStore()
    const before = await store.createBlock({ pageId: PAGE, content: '前文' })
    const card = await store.createBlock({
      pageId: PAGE,
      content: URL_,
      type: 'web-link',
      format: { link: { view: 'card', previewHeight: 420, meta: { title: '豆包对话', domain: 'doubao.com' } } },
      pos: before.pos + 1,
    })
    const after = await store.createBlock({ pageId: PAGE, content: '后文', pos: card.pos + 1 })
    return { store, before, card, after }
  }

  it('切标题视图：原块变 text 只承载 chip，meta.title 入档', async () => {
    const { store, before, card, after } = await cardBetweenTexts()
    await convertCardToChip(card.id, 'title')
    const conv = store.getBlock(card.id)!
    expect(conv.type).toBe('text')
    expect(conv.content).toBe(`[豆包对话](${URL_})`)
    expect(conv.format.webLinkMetas?.[URL_]).toBe('豆包对话')
    // 前后文本块一字不动、也没被软删（旧实现会把它们并进卡片块）
    expect(store.getBlock(before.id)!.content).toBe('前文')
    expect(store.getBlock(after.id)!.content).toBe('后文')
    expect(store.getBlock(before.id)!.deletedAt ?? null).toBeNull()
    expect(store.getBlock(after.id)!.deletedAt ?? null).toBeNull()
  })

  it('切链接视图：别名落 URL 原文', async () => {
    const { store, card } = await cardBetweenTexts()
    await convertCardToChip(card.id, 'link')
    expect(store.getBlock(card.id)!.content).toBe(`[${URL_}](${URL_})`)
  })

  it('补段与 content 同拍写入：整块一颗 external_link 段（不闪裸 markdown）', async () => {
    const { store, card } = await cardBetweenTexts()
    await convertCardToChip(card.id, 'title')
    const conv = store.getBlock(card.id)!
    expect(conv.renderSegments).toEqual([
      { type: 'external_link', start: 0, end: conv.content.length, url: URL_, display_text: '豆包对话' },
    ])
  })
})

describe('convertChipToCard（卡片标题种子）', () => {
  it('chip 别名还是 URL：不把网址写死成卡片标题（留给卡片自己抓一次）', async () => {
    const { store, block } = await chipBlock(`[${URL_}](${URL_})`)
    const cardId = (await convertChipToCard(block.id, 'card'))!
    const link = store.getBlock(cardId)!.format.link as { meta: { title?: string; domain?: string } }
    expect(link.meta.title).toBeUndefined()
    expect(link.meta.domain).toBe('doubao.com')
  })

  it('chip 别名是真标题：直接种进卡片 meta.title', async () => {
    const { store, block } = await chipBlock(`[豆包对话](${URL_})`)
    const cardId = (await convertChipToCard(block.id, 'card'))!
    const link = store.getBlock(cardId)!.format.link as { meta: { title?: string } }
    expect(link.meta.title).toBe('豆包对话')
  })

  it('别名是域名占位但有存档：用存档做种子，存档跟着卡片块走', async () => {
    const { store, block } = await chipBlock(`[doubao.com](${URL_})`, {
      webLinkMetas: { [URL_]: '豆包对话' },
    })
    const cardId = (await convertChipToCard(block.id, 'card'))!
    const card = store.getBlock(cardId)!
    const link = card.format.link as { meta: { title?: string } }
    expect(link.meta.title).toBe('豆包对话')
    expect(card.format.webLinkMetas?.[URL_]).toBe('豆包对话')
  })
})

/**
 * 种子标题 ≠ 抓取结果（2026-11-28 用户报障）：手动键入网址得到的卡片只有标题，
 * 摘要在、图标在、失败文案与重试都没有 —— 因为 chip 阶段抓到的标题被种进 meta.title
 * 后，卡片把自己当成「已经抓完」，摘要与 favicon 永远补不上。
 *
 * 回归锚在 `webLinkNeedsFetch`：卡片挂载时读的就是它，判 true 才会补抓一次全量元数据。
 */
describe('chip → 卡片：种子标题不得冒充抓取结果', () => {
  it('chip 带真标题进来，卡片仍要判为待抓取（摘要/图标还没拿过）', async () => {
    const { store, block } = await chipBlock(`[豆包对话](${URL_})`, {
      webLinkMetas: { [URL_]: '豆包对话' },
    })
    const cardId = (await convertChipToCard(block.id, 'card'))!
    const card = store.getBlock(cardId)!
    const settings = readWebLink(card.format)
    expect(settings.meta?.title).toBe('豆包对话')
    expect(settings.meta?.desc).toBeUndefined()
    expect(settings.meta?.iconAssetId).toBeUndefined()
    expect(webLinkNeedsFetch(card.content, settings.meta)).toBe(true)
  })

  it('抓取成功后（有 fetchedAt）不再重抓：标题是真的就不用再发请求', () => {
    expect(webLinkNeedsFetch(URL_, { fetchedAt: Date.now(), title: '豆包对话', desc: '摘要' })).toBe(false)
  })

  it('抓取失败过（带 error）不自动重抓：留给卡片的「重试」', () => {
    expect(webLinkNeedsFetch(URL_, { title: '豆包对话', error: 'timeout' })).toBe(false)
  })
})
