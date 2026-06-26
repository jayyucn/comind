/**
 * Core Layer - IndexedDBAdapter 集成测试
 *
 * 注意：这些测试需要浏览器环境（IndexedDB）。
 * 在 Node.js 环境中会被跳过。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IndexedDBAdapter } from '../indexedDBAdapter'

// =============================================================================
// Skip in non-browser environment
// =============================================================================

const isBrowser = typeof window !== 'undefined' && typeof indexedDB !== 'undefined'

const describeIfBrowser = isBrowser ? describe : describe.skip

describeIfBrowser('IndexedDBAdapter', () => {
  let adapter: IndexedDBAdapter

  beforeEach(async () => {
    adapter = new IndexedDBAdapter()
    await adapter.open()
  })

  afterEach(async () => {
    await adapter.close()
  })

  describe('isReady', () => {
    it('打开后应返回 true', () => {
      expect(adapter.isReady()).toBe(true)
    })
  })

  describe('blocks', () => {
    it('应创建 Block', async () => {
      const block = await adapter.blocks.create({
        pageId: 'page-1',
        content: 'Test Block',
      })

      expect(block.id).toBeDefined()
      expect(block.pageId).toBe('page-1')
      expect(block.content).toBe('Test Block')
      expect(block.pos).toBe(1000)
    })

    it('应获取 Block', async () => {
      const created = await adapter.blocks.create({
        pageId: 'page-1',
        content: 'Test Block',
      })

      const found = await adapter.blocks.findById(created.id)
      expect(found).toBeDefined()
      expect(found?.content).toBe('Test Block')
    })

    it('应按页面 ID 查询 Block', async () => {
      await adapter.blocks.create({ pageId: 'page-1', content: 'Block 1' })
      await adapter.blocks.create({ pageId: 'page-1', content: 'Block 2' })
      await adapter.blocks.create({ pageId: 'page-2', content: 'Block 3' })

      const blocks = await adapter.blocks.findByPageId('page-1')
      expect(blocks.length).toBe(2)
    })

    it('应更新 Block', async () => {
      const block = await adapter.blocks.create({
        pageId: 'page-1',
        content: 'Original',
      })

      const updated = await adapter.blocks.update(block.id, { content: 'Updated' })
      expect(updated.content).toBe('Updated')
    })

    it('应删除 Block', async () => {
      const block = await adapter.blocks.create({
        pageId: 'page-1',
        content: 'To Delete',
      })

      await adapter.blocks.delete(block.id)
      const found = await adapter.blocks.findById(block.id)
      expect(found).toBeUndefined()
    })

    it('应按父级查询子 Block', async () => {
      const parent = await adapter.blocks.create({ pageId: 'page-1', content: 'Parent' })
      const child1 = await adapter.blocks.create({ pageId: 'page-1', parentId: parent.id, content: 'Child 1' })
      const child2 = await adapter.blocks.create({ pageId: 'page-1', parentId: parent.id, content: 'Child 2' })

      const children = await adapter.blocks.findByParentId(parent.id)
      expect(children.length).toBe(2)
    })

    it('应重新排序 Block', async () => {
      const block1 = await adapter.blocks.create({ pageId: 'page-1', content: 'Block 1' })
      const block2 = await adapter.blocks.create({ pageId: 'page-1', content: 'Block 2' })

      await adapter.blocks.reorder(null, [block2.id, block1.id])

      const blocks = await adapter.blocks.findByParentId(null)
      expect(blocks[0].id).toBe(block2.id)
      expect(blocks[1].id).toBe(block1.id)
    })
  })

  describe('pages', () => {
    it('应创建 Page', async () => {
      const page = await adapter.pages.create({ title: 'Test Page' })

      expect(page.id).toBeDefined()
      expect(page.title).toBe('Test Page')
      expect(page.type).toBe('normal')
      expect(page.deleted).toBe(false)
    })

    it('应按标题查找 Page', async () => {
      const page = await adapter.pages.create({ title: 'Unique Title' })

      const found = await adapter.pages.findByTitle('Unique Title')
      expect(found?.id).toBe(page.id)
    })

    it('应软删除 Page', async () => {
      const page = await adapter.pages.create({ title: 'To Delete' })

      await adapter.pages.softDelete(page.id)

      const found = await adapter.pages.findById(page.id)
      expect(found?.deleted).toBe(true)
    })

    it('应恢复 Page', async () => {
      const page = await adapter.pages.create({ title: 'To Restore' })
      await adapter.pages.softDelete(page.id)

      await adapter.pages.restore(page.id)

      const found = await adapter.pages.findById(page.id)
      expect(found?.deleted).toBe(false)
    })

    it('应查找最近的 Page', async () => {
      await adapter.pages.create({ title: 'Page 1' })
      const page2 = await adapter.pages.create({ title: 'Page 2' })

      // 更新 page2 使其更近
      await adapter.pages.update(page2.id, { title: 'Updated Page 2' })

      const recent = await adapter.pages.findRecent(10)
      expect(recent[0]?.id).toBe(page2.id)
    })
  })

  describe('links', () => {
    it('应创建 Link', async () => {
      const link = await adapter.links.create({
        sourceBlockId: 'block-1',
        targetPageId: 'page-1',
      })

      expect(link.id).toBeDefined()
      expect(link.sourceBlockId).toBe('block-1')
      expect(link.targetPageId).toBe('page-1')
    })

    it('应按源 Block 查找链接', async () => {
      await adapter.links.create({ sourceBlockId: 'block-1', targetPageId: 'page-1' })
      await adapter.links.create({ sourceBlockId: 'block-1', targetPageId: 'page-2' })

      const links = await adapter.links.findBySourceBlockId('block-1')
      expect(links.length).toBe(2)
    })

    it('应按目标页面查找反向链接', async () => {
      await adapter.links.create({ sourceBlockId: 'block-1', targetPageId: 'page-1' })
      await adapter.links.create({ sourceBlockId: 'block-2', targetPageId: 'page-1' })

      const backlinks = await adapter.links.findByTargetPageId('page-1')
      expect(backlinks.length).toBe(2)
    })

    it('应删除源 Block 的所有链接', async () => {
      await adapter.links.create({ sourceBlockId: 'block-1', targetPageId: 'page-1' })
      await adapter.links.create({ sourceBlockId: 'block-1', targetPageId: 'page-2' })

      await adapter.links.deleteBySourceBlockId('block-1')

      const links = await adapter.links.findBySourceBlockId('block-1')
      expect(links.length).toBe(0)
    })
  })

  describe('properties', () => {
    it('应创建 Property', async () => {
      const property = await adapter.properties.create({
        blockId: 'block-1',
        key: 'status',
        value: 'done',
      })

      expect(property.id).toBeDefined()
      expect(property.key).toBe('status')
      expect(property.value).toBe('done')
    })

    it('应按 Block ID 查找属性', async () => {
      await adapter.properties.create({ blockId: 'block-1', key: 'name', value: 'Test' })
      await adapter.properties.create({ blockId: 'block-1', key: 'status', value: 'done' })

      const properties = await adapter.properties.findByBlockId('block-1')
      expect(properties.length).toBe(2)
    })

    it('应按 Block ID 和 Key 查找属性', async () => {
      await adapter.properties.create({ blockId: 'block-1', key: 'name', value: 'Test' })

      const property = await adapter.properties.findByKey('block-1', 'name')
      expect(property?.value).toBe('Test')
    })

    it('应更新 Property', async () => {
      const property = await adapter.properties.create({
        blockId: 'block-1',
        key: 'count',
        value: 0,
      })

      const updated = await adapter.properties.update(property.id, { value: 42 })
      expect(updated.value).toBe(42)
    })

    it('应删除 Property', async () => {
      const property = await adapter.properties.create({
        blockId: 'block-1',
        key: 'temp',
        value: 'value',
      })

      await adapter.properties.delete(property.id)

      const found = await adapter.properties.findByKey('block-1', 'temp')
      expect(found).toBeUndefined()
    })

    it('应使用 upsert', async () => {
      // 第一次 upsert - 创建
      const created = await adapter.properties.upsert('block-1', 'key', 'value1')
      expect(created.value).toBe('value1')

      // 第二次 upsert - 更新
      const updated = await adapter.properties.upsert('block-1', 'key', 'value2')
      expect(updated.value).toBe('value2')

      // 应该只有一个属性
      const properties = await adapter.properties.findByBlockId('block-1')
      expect(properties.length).toBe(1)
    })
  })

  describe('transaction', () => {
    it('应执行事务', async () => {
      const result = await adapter.transaction(async () => {
        const page = await adapter.pages.create({ title: 'Transaction Test' })
        const block = await adapter.blocks.create({ pageId: page.id, content: 'In Transaction' })
        return { page, block }
      })

      expect(result.page).toBeDefined()
      expect(result.block).toBeDefined()
    })
  })
})
