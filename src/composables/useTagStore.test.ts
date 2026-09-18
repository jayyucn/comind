import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTagStore } from './useTagStore'
import { usePageStore } from '../stores/pages'
import { initTestCore, cleanupPages } from '../../tests/core-client'

// 真·往返：复用真实 wasm 栈（同 useRelationshipTypes.test.ts）。
// 每个用例用唯一标题，规避 createPage 的 title 幂等复用陈旧内存页。
// 源 block id 用显式字符串：applyTag 只把 source_block_id 写进 Link，
// 不要求该 block 真实存在于 store（与"只测外部行为"原则一致）。
let seq = 0
function title(base: string): string {
  seq += 1
  return `${base}-${Date.now()}-${seq}`
}

describe('useTagStore', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await cleanupPages()
  })
  afterEach(async () => {
    await cleanupPages()
  })

  it('applyTag 创建 relationship_type=tag 的 Link，且 getBacklinks 含该 link', async () => {
    const pages = usePageStore()
    const tagPage = await pages.createTagPage(title('Book'))
    const { applyTag } = useTagStore()

    const link = await applyTag('blk-member', tagPage.id)
    expect(link.relationship_type).toBe('tag')
    expect(link.target_page_id).toBe(tagPage.id)
    expect(link.source_block_id).toBe('blk-member')

    const client = await initTestCore()
    const backlinks = await client.getBacklinks(tagPage.id)
    const found = backlinks.find(
      l => l.relationship_type === 'tag' && l.source_block_id === 'blk-member'
    )
    expect(found).toBeTruthy()
  })

  it('resolveTagMembers 双向一致：applyTag 写入的成员必被反查到', async () => {
    const pages = usePageStore()
    const tagPage = await pages.createTagPage(title('Book'))
    const { applyTag, resolveTagMembers } = useTagStore()

    await applyTag('blk-1', tagPage.id)
    await applyTag('blk-2', tagPage.id)

    const members = await resolveTagMembers(tagPage.id)
    expect([...members].sort()).toEqual(['blk-1', 'blk-2'].sort())
  })

  it('幂等：同一 (block, tag) 二次 applyTag 复用既有 link', async () => {
    const pages = usePageStore()
    const tagPage = await pages.createTagPage(title('Book'))
    const { applyTag, resolveTagMembers } = useTagStore()

    const a1 = await applyTag('blk-x', tagPage.id)
    const a2 = await applyTag('blk-x', tagPage.id)
    expect(a2.id).toBe(a1.id)

    const members = await resolveTagMembers(tagPage.id)
    expect(members).toEqual(['blk-x'])
  })

  it('多对多：一 block 贴两 tag；两 block 贴一 tag', async () => {
    const pages = usePageStore()
    const t1 = await pages.createTagPage(title('T1'))
    const t2 = await pages.createTagPage(title('T2'))
    const { applyTag, resolveTagMembers } = useTagStore()

    await applyTag('blk-m', t1.id)
    await applyTag('blk-m', t2.id)
    expect(await resolveTagMembers(t1.id)).toEqual(['blk-m'])
    expect(await resolveTagMembers(t2.id)).toEqual(['blk-m'])

    await applyTag('blk-m2', t1.id)
    expect([...await resolveTagMembers(t1.id)].sort()).toEqual(['blk-m', 'blk-m2'].sort())
  })

  it('不污染：指向 tag 页但 relationship_type 非 tag 的 link 不计入成员', async () => {
    const pages = usePageStore()
    const tagPage = await pages.createTagPage(title('Book'))
    const client = await initTestCore()
    await client.executeBatch([{
      entity: 'link',
      action: 'create',
      params: {
        id: 'rel_blk_n_tag',
        source_block_id: 'blk-n',
        target_page_id: tagPage.id,
        display_text: 'N',
        relationship_type: 'related',
      },
    }])

    const { applyTag, resolveTagMembers } = useTagStore()
    await applyTag('blk-n', tagPage.id)
    const members = await resolveTagMembers(tagPage.id)
    expect(members).toEqual(['blk-n']) // 只算 tag，不算 related
  })

  it('护栏：目标不是 tag 页时 applyTag 抛错', async () => {
    const pages = usePageStore()
    const normal = await pages.createPage(title('Normal'))
    const { applyTag } = useTagStore()
    await expect(applyTag('blk-x', normal.id)).rejects.toThrow()
  })
})
