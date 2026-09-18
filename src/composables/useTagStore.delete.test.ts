import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTagStore } from './useTagStore'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'
import { initTestCore, cleanupPages } from '../../tests/core-client'

let seq = 0
function title(base: string): string {
  seq += 1
  return `${base}-${Date.now()}-${seq}`
}

/** 解析 tag-page 的根块 id（extend 链接挂在块上）；flush 保证 id 与生产解析一致 */
async function tagRootBlockId(pageId: string): Promise<string> {
  const bs = useBlockStore()
  await bs.ensurePageBlocks(pageId)
  let root = bs.blocks.find(b => b.pageId === pageId && !b.parentId)!
  await bs.flushSave(root.id)
  root = bs.blocks.find(b => b.pageId === pageId && !b.parentId)!
  return root.id
}

describe('useTagStore — 删标签级联清理（#135 / T7）', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await cleanupPages()
  })
  afterEach(async () => {
    await cleanupPages()
  })

  it('删 tag-page 后成员 tag Link 与作为父标签的 extend Link 均无悬空', async () => {
    const pages = usePageStore()
    const parent = await pages.createTagPage(title('Parent'))
    const child = await pages.createTagPage(title('Child'))
    const client = await initTestCore()
    const { applyTag, deleteTagPage, resolveTagMembers } = useTagStore()

    // 成员：两个 block 贴上 parent
    await applyTag('blk-1', parent.id)
    await applyTag('blk-2', parent.id)
    // 继承：child extends parent（child→parent 的 extend 链接）
    const childBlockId = await tagRootBlockId(child.id)
    await client.executeBatch([{
      entity: 'link',
      action: 'create',
      params: {
        id: `ext_${child.id}_${parent.id}`,
        source_block_id: childBlockId,
        target_page_id: parent.id,
        display_text: parent.title,
        relationship_type: 'extend',
      },
    }])

    // 前置断言：删前确有成员与继承链接
    expect(await resolveTagMembers(parent.id)).toEqual(['blk-1', 'blk-2'])
    expect((await client.getBacklinks(parent.id)).some(l => l.relationship_type === 'extend')).toBe(true)

    // 删除父标签
    await deleteTagPage(parent.id)

    // 1) 页已从 store 移除
    expect(pages.getPage(parent.id)).toBeUndefined()
    // 2) 成员反查为空（tag Link 已清）
    expect(await resolveTagMembers(parent.id)).toEqual([])
    // 3) 作为 target 的 backlink 无任何 tag / extend（成员 + 继承链接均清）
    const backlinks = await client.getBacklinks(parent.id)
    expect(backlinks.filter(l => l.relationship_type === 'tag' || l.relationship_type === 'extend')).toHaveLength(0)
    // 4) 子标签的 extend 出边（target=parent）也已清（无悬空）
    //    注意 getOutlinks 以 page id 为参
    const childOut = await client.getOutlinks(child.id)
    expect(childOut.some(l => l.relationship_type === 'extend' && l.target_page_id === parent.id)).toBe(false)
  })

  it('护栏：删非 tag 页抛错', async () => {
    const pages = usePageStore()
    const normal = await pages.createPage(title('Normal'))
    const { deleteTagPage } = useTagStore()
    await expect(deleteTagPage(normal.id)).rejects.toThrow()
  })
})
