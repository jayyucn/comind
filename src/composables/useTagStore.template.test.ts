import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTagStore } from './useTagStore'
import type { TagFieldSpec } from './useTagStore'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'
import { initTestCore, cleanupPages } from '../../tests/core-client'

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

let seq = 0
function title(base: string): string {
  seq += 1
  return `${base}-${Date.now()}-${seq}`
}

/** 解析 tag-page 的根块 id（模板/继承链接都挂在块上）；flush 保证 id 与生产解析一致 */
async function tagRootBlockId(pageId: string): Promise<string> {
  const bs = useBlockStore()
  await bs.ensurePageBlocks(pageId)
  let root = bs.blocks.find(b => b.pageId === pageId && !b.parentId)!
  await bs.flushSave(root.id)
  root = bs.blocks.find(b => b.pageId === pageId && !b.parentId)!
  return root.id
}

describe('useTagStore — 标签模板 / 字段注入（#131 / T3）', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await cleanupPages()
  })
  afterEach(async () => {
    await cleanupPages()
  })

  it('setTagTemplate / getTagTemplate 模板往返', async () => {
    const pages = usePageStore()
    const tagPage = await pages.createTagPage(title('Book'))
    const { setTagTemplate, getTagTemplate } = useTagStore()

    const fields: TagFieldSpec[] = [
      { key: 'author', label: '作者', type: 'string' },
      { key: 'status', label: '状态', type: 'string', options: [{ id: 'reading', label: '在读' }] },
    ]
    await setTagTemplate(tagPage.id, fields)
    expect(await getTagTemplate(tagPage.id)).toEqual(fields)
  })

  it('getTagTemplate 对非 tag 页返回空数组', async () => {
    const pages = usePageStore()
    const normal = await pages.createPage(title('Normal'))
    const { getTagTemplate } = useTagStore()
    expect(await getTagTemplate(normal.id)).toEqual([])
  })

  it('读模板不建块（只读路径不得有渲染副作用）', async () => {
    const pages = usePageStore()
    const bs = useBlockStore()
    const tagPage = await pages.createTagPage(title('ReadOnly'))
    // createTagPage 不建块（savePage 返回 block_id=null）
    expect(bs.blocks.filter(b => b.pageId === tagPage.id)).toHaveLength(0)

    const { getTagTemplate } = useTagStore()
    expect(await getTagTemplate(tagPage.id)).toEqual([])
    // 读后仍无块：渲染期读模板（effectiveFields → getTagTemplate）不得落库
    expect(bs.blocks.filter(b => b.pageId === tagPage.id)).toHaveLength(0)
  })

  it('effectiveFields 合并模板 + 继承链，冲突就近覆盖', async () => {
    const pages = usePageStore()
    const parent = await pages.createTagPage(title('Media'))
    const child = await pages.createTagPage(title('Book'))
    const client = await initTestCore()

    // parent 模板：title + rating
    const { setTagTemplate, effectiveFields } = useTagStore()
    await setTagTemplate(parent.id, [
      { key: 'title', label: '标题', type: 'string' },
      { key: 'rating', label: '父评分', type: 'number' },
    ])
    // child 模板：author（新）+ rating（覆盖父）
    await setTagTemplate(child.id, [
      { key: 'author', label: '作者', type: 'string' },
      { key: 'rating', label: '子评分', type: 'number' },
    ])
    // child extends parent
    await client.executeBatch([{
      entity: 'link',
      action: 'create',
      params: {
        id: `ext_${child.id}_${parent.id}`,
        source_block_id: await tagRootBlockId(child.id),
        target_page_id: parent.id,
        display_text: parent.title,
        relationship_type: 'extend',
      },
    }])

    const fields = await effectiveFields(child.id)
    const byKey = Object.fromEntries(fields.map(f => [f.key, f]))
    // 合并：title(父) + rating(子覆盖) + author(子)
    expect(byKey.title?.label).toBe('标题')
    expect(byKey.author?.label).toBe('作者')
    expect(byKey.rating?.label).toBe('子评分') // 就近覆盖
  })

  it('resolveInheritance 防环：环形 extend 不死循环', async () => {
    const pages = usePageStore()
    const a = await pages.createTagPage(title('A'))
    const b = await pages.createTagPage(title('B'))
    const client = await initTestCore()
    const { resolveInheritance } = useTagStore()
    // A extends B, B extends A（环）
    await client.executeBatch([
      { entity: 'link', action: 'create', params: { id: `ext_${a.id}_${b.id}`, source_block_id: await tagRootBlockId(a.id), target_page_id: b.id, display_text: b.title, relationship_type: 'extend' } },
      { entity: 'link', action: 'create', params: { id: `ext_${b.id}_${a.id}`, source_block_id: await tagRootBlockId(b.id), target_page_id: a.id, display_text: a.title, relationship_type: 'extend' } },
    ])
    const chain = await resolveInheritance(a.id)
    expect(chain).toEqual([b.id]) // 访问到 B 即停，不回 A（防环）
  })

  it('E1 多标签同名字段冲突：先贴先胜，确定性', async () => {
    const pages = usePageStore()
    const tagA = await pages.createTagPage(title('A'))
    const tagB = await pages.createTagPage(title('B'))
    const { setTagTemplate, applyTag, effectiveFieldsForBlock } = useTagStore()

    await setTagTemplate(tagA.id, [{ key: 'status', label: 'A-状态', type: 'string' }])
    await setTagTemplate(tagB.id, [{ key: 'status', label: 'B-状态', type: 'string' }])

    // 被贴标签的必须是真实块（getOutlinks 以 page id 取，需能由 block 定位其页）
    const host = await pages.createPage(title('Host'))
    const blockId = await tagRootBlockId(host.id)

    await applyTag(blockId, tagA.id)
    await sleep(3) // 拉开 created_at，确保先贴先胜
    await applyTag(blockId, tagB.id)

    const fields = await effectiveFieldsForBlock(blockId)
    const status = fields.find(f => f.key === 'status')
    expect(status?.label).toBe('A-状态') // 先应用（tagA）胜
    expect(fields.filter(f => f.key === 'status')).toHaveLength(1) // 不重复
  })

  it('派生验证：applyTag 不把模板字段写入 block 的 property store', async () => {
    const pages = usePageStore()
    const tagPage = await pages.createTagPage(title('Book'))
    const client = await initTestCore()
    const { setTagTemplate, applyTag } = useTagStore()

    await setTagTemplate(tagPage.id, [
      { key: 'author', label: '作者', type: 'string' },
      { key: 'status', label: '状态', type: 'string' },
    ])
    await applyTag('blk-x', tagPage.id)

    const props = await client.getProperties('blk-x')
    const keys = props.map(p => p.key)
    expect(keys).not.toContain('author')
    expect(keys).not.toContain('status')
    expect(keys).not.toContain('template')
  })
})
