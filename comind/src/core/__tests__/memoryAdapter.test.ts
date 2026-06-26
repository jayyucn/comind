/**
 * Core Layer - MemoryAdapter 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryAdapter } from '../storage/memoryAdapter'
import type { Block, Page, Link, Tag, Property } from '../types'

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter

  beforeEach(() => {
    adapter = new MemoryAdapter()
  })

  describe('isReady', () => {
    it('应返回 true', () => {
      expect(adapter.isReady()).toBe(true)
    })
  })

  describe('close', () => {
    it('不应抛出错误', async () => {
      await expect(adapter.close()).resolves.not.toThrow()
    })
  })

  describe('transaction', () => {
    it('应执行事务回调', async () => {
      const result = await adapter.transaction(async () => {
        return 'success'
      })
      expect(result).toBe('success')
    })

    it('应支持嵌套操作', async () => {
      const page = await adapter.pages.create({ title: 'Test Page' })
      const block = await adapter.blocks.create({ pageId: page.id, content: 'Test Block' })

      const result = await adapter.transaction(async () => {
        const foundBlock = await adapter.blocks.findById(block.id)
        const foundPage = await adapter.pages.findById(page.id)
        return { block: foundBlock, page: foundPage }
      })

      expect(result.block?.id).toBe(block.id)
      expect(result.page?.id).toBe(page.id)
    })
  })

  // =============================================================================
  // Block Repository
  // =============================================================================

  describe('blocks', () => {
    describe('findByIds', () => {
      it('应返回指定 ID 的 Block', async () => {
        const block1 = await adapter.blocks.create({ pageId: 'page-1', content: 'Block 1' })
        const block2 = await adapter.blocks.create({ pageId: 'page-1', content: 'Block 2' })
        const block3 = await adapter.blocks.create({ pageId: 'page-1', content: 'Block 3' })

        const blocks = await adapter.blocks.findByIds([block1.id, block3.id])
        expect(blocks.length).toBe(2)
        expect(blocks.map(b => b.id)).toContain(block1.id)
        expect(blocks.map(b => b.id)).toContain(block3.id)
      })

      it('不存在的 ID 不返回', async () => {
        const block = await adapter.blocks.create({ pageId: 'page-1', content: 'Block' })
        const blocks = await adapter.blocks.findByIds([block.id, 'non-existent'])
        expect(blocks.length).toBe(1)
      })

      it('空数组返回空结果', async () => {
        const blocks = await adapter.blocks.findByIds([])
        expect(blocks.length).toBe(0)
      })
    })

    describe('findAll', () => {
      it('应返回分页结果', async () => {
        for (let i = 0; i < 5; i++) {
          await adapter.blocks.create({ pageId: 'page-1', content: `Block ${i}` })
        }

        const result = await adapter.blocks.findAll(2, 0)
        expect(result.items.length).toBe(2)
        expect(result.total).toBe(5)
        expect(result.page).toBe(1)
        expect(result.pageSize).toBe(2)
        expect(result.hasMore).toBe(true)
      })

      it('应正确处理 offset', async () => {
        for (let i = 0; i < 5; i++) {
          await adapter.blocks.create({ pageId: 'page-1', content: `Block ${i}` })
        }

        const result = await adapter.blocks.findAll(2, 4)
        expect(result.items.length).toBe(1)
        expect(result.hasMore).toBe(false)
      })
    })

    describe('deleteByPageId', () => {
      it('应删除页面内的所有 Block', async () => {
        await adapter.blocks.create({ pageId: 'page-1', content: 'Block 1' })
        await adapter.blocks.create({ pageId: 'page-1', content: 'Block 2' })
        await adapter.blocks.create({ pageId: 'page-2', content: 'Other Block' })

        await adapter.blocks.deleteByPageId('page-1')

        const blocks = await adapter.blocks.findByPageId('page-1')
        expect(blocks.length).toBe(0)

        const otherBlocks = await adapter.blocks.findByPageId('page-2')
        expect(otherBlocks.length).toBe(1)
      })
    })

    describe('reorder', () => {
      it('应重新排序 Block', async () => {
        const block1 = await adapter.blocks.create({ pageId: 'page-1', content: 'Block 1' })
        const block2 = await adapter.blocks.create({ pageId: 'page-1', content: 'Block 2' })
        const block3 = await adapter.blocks.create({ pageId: 'page-1', content: 'Block 3' })

        await adapter.blocks.reorder(null, [block3.id, block1.id, block2.id])

        const blocks = await adapter.blocks.findByParentId(null)
        expect(blocks[0].id).toBe(block3.id)
        expect(blocks[1].id).toBe(block1.id)
        expect(blocks[2].id).toBe(block2.id)
        expect(blocks[0].pos).toBe(1000)
        expect(blocks[1].pos).toBe(2000)
        expect(blocks[2].pos).toBe(3000)
      })

      it('应处理不存在的 Block ID', async () => {
        const block1 = await adapter.blocks.create({ pageId: 'page-1', content: 'Block 1' })

        await adapter.blocks.reorder(null, [block1.id, 'non-existent'])

        const blocks = await adapter.blocks.findByParentId(null)
        expect(blocks.length).toBe(1)
      })
    })
  })

  // =============================================================================
  // Page Repository
  // =============================================================================

  describe('pages', () => {
    describe('findByTitle', () => {
      it('应按标题查找 Page', async () => {
        const page = await adapter.pages.create({ title: 'Unique Title' })

        const found = await adapter.pages.findByTitle('Unique Title')
        expect(found?.id).toBe(page.id)
      })

      it('不存在的标题返回 undefined', async () => {
        const found = await adapter.pages.findByTitle('Non Existent')
        expect(found).toBeUndefined()
      })
    })

    describe('findByIds', () => {
      it('应返回指定 ID 的 Page', async () => {
        const page1 = await adapter.pages.create({ title: 'Page 1' })
        const page2 = await adapter.pages.create({ title: 'Page 2' })

        const pages = await adapter.pages.findByIds([page1.id])
        expect(pages.length).toBe(1)
        expect(pages[0].id).toBe(page1.id)
      })
    })

    describe('findAll', () => {
      it('应返回分页结果', async () => {
        for (let i = 0; i < 5; i++) {
          await adapter.pages.create({ title: `Page ${i}` })
        }

        const result = await adapter.pages.findAll(2, 0)
        expect(result.items.length).toBe(2)
        expect(result.total).toBe(5)
      })
    })

    describe('findRecent', () => {
      it('应返回最近的 Page', async () => {
        const page1 = await adapter.pages.create({ title: 'Page 1' })
        const page2 = await adapter.pages.create({ title: 'Page 2' })

        // 更新 page1 使其更新
        await adapter.pages.update(page1.id, { title: 'Updated Page 1' })

        const recent = await adapter.pages.findRecent(10)
        expect(recent[0].id).toBe(page1.id)
      })

      it('应排除已删除的 Page', async () => {
        const page1 = await adapter.pages.create({ title: 'Active Page' })
        const page2 = await adapter.pages.create({ title: 'Deleted Page' })
        await adapter.pages.softDelete(page2.id)

        const recent = await adapter.pages.findRecent(10)
        expect(recent.length).toBe(1)
        expect(recent[0].id).toBe(page1.id)
      })
    })

    describe('findDeleted', () => {
      it('应返回已删除的 Page', async () => {
        const page1 = await adapter.pages.create({ title: 'Active Page' })
        const page2 = await adapter.pages.create({ title: 'Deleted Page' })
        await adapter.pages.softDelete(page2.id)

        const result = await adapter.pages.findDeleted()
        expect(result.items.length).toBe(1)
        expect(result.items[0].id).toBe(page2.id)
      })
    })

    describe('softDelete', () => {
      it('应软删除 Page', async () => {
        const page = await adapter.pages.create({ title: 'Page' })

        await adapter.pages.softDelete(page.id)

        const found = await adapter.pages.findById(page.id)
        expect(found?.deleted).toBe(true)
        expect(found?.deletedAt).not.toBeNull()
      })
    })

    describe('restore', () => {
      it('应恢复 Page', async () => {
        const page = await adapter.pages.create({ title: 'Page' })
        await adapter.pages.softDelete(page.id)

        await adapter.pages.restore(page.id)

        const found = await adapter.pages.findById(page.id)
        expect(found?.deleted).toBe(false)
        expect(found?.deletedAt).toBeNull()
      })
    })

    describe('permanentDelete', () => {
      it('应永久删除 Page', async () => {
        const page = await adapter.pages.create({ title: 'Page' })

        await adapter.pages.permanentDelete(page.id)

        const found = await adapter.pages.findById(page.id)
        expect(found).toBeUndefined()
      })
    })

    describe('emptyTrash', () => {
      it('应清空回收站', async () => {
        const page1 = await adapter.pages.create({ title: 'Page 1' })
        const page2 = await adapter.pages.create({ title: 'Page 2' })
        await adapter.pages.softDelete(page1.id)
        await adapter.pages.softDelete(page2.id)

        await adapter.pages.emptyTrash()

        const result = await adapter.pages.findDeleted()
        expect(result.items.length).toBe(0)
      })
    })
  })

  // =============================================================================
  // Link Repository
  // =============================================================================

  describe('links', () => {
    describe('findAll', () => {
      it('应返回分页结果', async () => {
        for (let i = 0; i < 5; i++) {
          await adapter.links.create({ sourceBlockId: `block-${i}`, targetPageId: 'page-1' })
        }

        const result = await adapter.links.findAll(2, 0)
        expect(result.items.length).toBe(2)
        expect(result.total).toBe(5)
      })
    })

    describe('update', () => {
      it('应更新 Link', async () => {
        const link = await adapter.links.create({
          sourceBlockId: 'block-1',
          targetPageId: 'page-1',
          displayText: 'Original',
        })

        const updated = await adapter.links.update(link.id, { displayText: 'Updated' })
        expect(updated.displayText).toBe('Updated')
      })

      it('不存在的 Link 抛出错误', async () => {
        await expect(adapter.links.update('non-existent', {})).rejects.toThrow('Link not found')
      })
    })

    describe('deleteByTargetPageId', () => {
      it('应删除目标页面的所有链接', async () => {
        await adapter.links.create({ sourceBlockId: 'block-1', targetPageId: 'page-1' })
        await adapter.links.create({ sourceBlockId: 'block-2', targetPageId: 'page-1' })
        await adapter.links.create({ sourceBlockId: 'block-3', targetPageId: 'page-2' })

        await adapter.links.deleteByTargetPageId('page-1')

        const links = await adapter.links.findByTargetPageId('page-1')
        expect(links.length).toBe(0)

        const otherLinks = await adapter.links.findByTargetPageId('page-2')
        expect(otherLinks.length).toBe(1)
      })
    })
  })

  // =============================================================================
  // Tag Repository
  // =============================================================================

  describe('tags', () => {
    describe('findByName', () => {
      it('应按名称查找 Tag', async () => {
        const tag = await adapter.tags.create('TestTag')

        const found = await adapter.tags.findByName('TestTag')
        expect(found?.id).toBe(tag.id)
      })

      it('不存在的名称返回 undefined', async () => {
        const found = await adapter.tags.findByName('Non Existent')
        expect(found).toBeUndefined()
      })
    })

    describe('findAll', () => {
      it('应返回所有 Tag', async () => {
        await adapter.tags.create('Tag 1')
        await adapter.tags.create('Tag 2')

        const tags = await adapter.tags.findAll()
        expect(tags.length).toBe(2)
      })
    })

    describe('update', () => {
      it('应更新 Tag', async () => {
        const tag = await adapter.tags.create('Original')

        const updated = await adapter.tags.update(tag.id, { name: 'Updated', color: 'red' })
        expect(updated.name).toBe('Updated')
        expect(updated.color).toBe('red')
      })

      it('不存在的 Tag 抛出错误', async () => {
        await expect(adapter.tags.update('non-existent', {})).rejects.toThrow('Tag not found')
      })
    })
  })

  // =============================================================================
  // Property Repository
  // =============================================================================

  describe('properties', () => {
    describe('findAll', () => {
      it('应返回分页结果', async () => {
        for (let i = 0; i < 5; i++) {
          await adapter.properties.create({ blockId: 'block-1', key: `key-${i}`, value: 'value' })
        }

        const result = await adapter.properties.findAll(2, 0)
        expect(result.items.length).toBe(2)
        expect(result.total).toBe(5)
      })
    })

    describe('upsert', () => {
      it('不存在时应创建', async () => {
        const property = await adapter.properties.upsert('block-1', 'key', 'value')
        expect(property.key).toBe('key')
        expect(property.value).toBe('value')
      })

      it('存在时应更新', async () => {
        await adapter.properties.create({ blockId: 'block-1', key: 'key', value: 'original' })

        const property = await adapter.properties.upsert('block-1', 'key', 'updated')
        expect(property.value).toBe('updated')

        const all = await adapter.properties.findByBlockId('block-1')
        expect(all.length).toBe(1)
      })
    })

    describe('delete', () => {
      it('应软删除 Property', async () => {
        const property = await adapter.properties.create({ blockId: 'block-1', key: 'key', value: 'value' })

        await adapter.properties.delete(property.id)

        const all = await adapter.properties.findAll()
        expect(all.items.filter(p => !p.isDeleted).length).toBe(0)
      })
    })

    describe('update', () => {
      it('应更新 Property', async () => {
        const property = await adapter.properties.create({ blockId: 'block-1', key: 'key', value: 'original' })

        const updated = await adapter.properties.update(property.id, { value: 'updated' })
        expect(updated.value).toBe('updated')
      })

      it('不存在的 Property 抛出错误', async () => {
        await expect(adapter.properties.update('non-existent', {})).rejects.toThrow('Property not found')
      })
    })
  })
})
