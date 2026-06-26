/**
 * Core Layer - LinkService 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { LinkService } from '../services/linkService'
import { MemoryAdapter } from '../storage/memoryAdapter'
import type { Link, LinkParse } from '../types'

describe('LinkService', () => {
  let service: LinkService
  let storage: MemoryAdapter

  beforeEach(() => {
    storage = new MemoryAdapter()
    service = new LinkService({ storage })
  })

  // =============================================================================
  // CRUD 操作
  // =============================================================================

  describe('getById', () => {
    it('应返回已创建的 Link', async () => {
      const created = await service.create({
        sourceBlockId: 'block-1',
        targetPageId: 'page-1',
        displayText: 'Page 1',
      })

      const found = await service.getById(created.id)
      expect(found).toBeDefined()
      expect(found?.id).toBe(created.id)
      expect(found?.targetPageId).toBe('page-1')
    })

    it('不存在的 ID 返回 undefined', async () => {
      const found = await service.getById('non-existent')
      expect(found).toBeUndefined()
    })
  })

  describe('getBySourceBlockId', () => {
    it('应返回源 Block 的所有链接', async () => {
      await service.create({ sourceBlockId: 'block-1', targetPageId: 'page-1' })
      await service.create({ sourceBlockId: 'block-1', targetPageId: 'page-2' })
      await service.create({ sourceBlockId: 'block-2', targetPageId: 'page-1' })

      const links = await service.getBySourceBlockId('block-1')
      expect(links.length).toBe(2)
      expect(links.every(l => l.sourceBlockId === 'block-1')).toBe(true)
    })

    it('无链接返回空数组', async () => {
      const links = await service.getBySourceBlockId('non-existent')
      expect(links.length).toBe(0)
    })
  })

  describe('getBacklinks', () => {
    it('应返回指向页面的所有链接（反向链接）', async () => {
      await service.create({ sourceBlockId: 'block-1', targetPageId: 'page-1' })
      await service.create({ sourceBlockId: 'block-2', targetPageId: 'page-1' })
      await service.create({ sourceBlockId: 'block-3', targetPageId: 'page-2' })

      const backlinks = await service.getBacklinks('page-1')
      expect(backlinks.length).toBe(2)
      expect(backlinks.every(l => l.targetPageId === 'page-1')).toBe(true)
    })
  })

  describe('create', () => {
    it('应创建带默认值的 Link', async () => {
      const link = await service.create({
        sourceBlockId: 'block-1',
        targetPageId: 'page-1',
      })

      expect(link.id).toBeDefined()
      expect(link.sourceBlockId).toBe('block-1')
      expect(link.targetPageId).toBe('page-1')
      expect(link.displayText).toBe('page-1')
      expect(link.relationshipType).toBeNull()
    })

    it('应使用提供的显示文本', async () => {
      const link = await service.create({
        sourceBlockId: 'block-1',
        targetPageId: 'page-1',
        displayText: 'Custom Text',
      })

      expect(link.displayText).toBe('Custom Text')
    })
  })

  describe('createMany', () => {
    it('应批量创建链接', async () => {
      const links = await service.createMany([
        { sourceBlockId: 'block-1', targetPageId: 'page-1' },
        { sourceBlockId: 'block-1', targetPageId: 'page-2' },
        { sourceBlockId: 'block-2', targetPageId: 'page-1' },
      ])

      expect(links.length).toBe(3)
      expect(links.every(l => l.id)).toBeDefined()
    })
  })

  describe('deleteBySourceBlockId', () => {
    it('应删除源 Block 的所有链接', async () => {
      await service.create({ sourceBlockId: 'block-1', targetPageId: 'page-1' })
      await service.create({ sourceBlockId: 'block-1', targetPageId: 'page-2' })

      await service.deleteBySourceBlockId('block-1')

      const links = await service.getBySourceBlockId('block-1')
      expect(links.length).toBe(0)
    })

    it('不影响其他 Block 的链接', async () => {
      await service.create({ sourceBlockId: 'block-1', targetPageId: 'page-1' })
      await service.create({ sourceBlockId: 'block-2', targetPageId: 'page-1' })

      await service.deleteBySourceBlockId('block-1')

      const links = await service.getBySourceBlockId('block-2')
      expect(links.length).toBe(1)
    })
  })

  // =============================================================================
  // 链接同步
  // =============================================================================

  describe('syncBlockLinks', () => {
    it('应添加新的链接', async () => {
      const parsedLinks: LinkParse[] = [
        { fullMatch: '[[Page 1]]', target: 'page-1', displayText: 'Page 1', isExternal: false },
        { fullMatch: '[[Page 2]]', target: 'page-2', displayText: null, isExternal: false },
      ]

      await service.syncBlockLinks('block-1', 'current-page', parsedLinks)

      const links = await service.getBySourceBlockId('block-1')
      expect(links.length).toBe(2)
    })

    it('应删除不再存在的链接', async () => {
      // 先创建一些链接
      await service.create({ sourceBlockId: 'block-1', targetPageId: 'old-page' })

      // 同步为空数组
      await service.syncBlockLinks('block-1', 'current-page', [])

      const links = await service.getBySourceBlockId('block-1')
      expect(links.length).toBe(0)
    })

    it('应保留仍然存在的链接', async () => {
      await service.create({
        sourceBlockId: 'block-1',
        targetPageId: 'page-1',
        displayText: 'Page 1',
      })

      const parsedLinks: LinkParse[] = [
        { fullMatch: '[[Page 1]]', target: 'page-1', displayText: 'Page 1', isExternal: false },
        { fullMatch: '[[Page 2]]', target: 'page-2', displayText: null, isExternal: false },
      ]

      await service.syncBlockLinks('block-1', 'current-page', parsedLinks)

      const links = await service.getBySourceBlockId('block-1')
      expect(links.length).toBe(2)

      const page1Link = links.find(l => l.targetPageId === 'page-1')
      expect(page1Link).toBeDefined()
    })

    it('应跳过外部链接', async () => {
      const parsedLinks: LinkParse[] = [
        { fullMatch: '[[https://example.com]]', target: 'https://example.com', displayText: null, isExternal: true },
      ]

      await service.syncBlockLinks('block-1', 'current-page', parsedLinks)

      const links = await service.getBySourceBlockId('block-1')
      expect(links.length).toBe(0)
    })

    it('应处理重复的链接', async () => {
      const parsedLinks: LinkParse[] = [
        { fullMatch: '[[Page 1]]', target: 'page-1', displayText: 'Page 1', isExternal: false },
        { fullMatch: '[[Page 1]]', target: 'page-1', displayText: 'Page 1', isExternal: false }, // 重复
      ]

      await service.syncBlockLinks('block-1', 'current-page', parsedLinks)

      const links = await service.getBySourceBlockId('block-1')
      expect(links.length).toBe(1)
    })

    it('相同目标但不同显示文本应创建不同链接', async () => {
      const parsedLinks: LinkParse[] = [
        { fullMatch: '[[Page 1]]', target: 'page-1', displayText: 'Text 1', isExternal: false },
        { fullMatch: '[[Page 1]]', target: 'page-1', displayText: 'Text 2', isExternal: false },
      ]

      await service.syncBlockLinks('block-1', 'current-page', parsedLinks)

      const links = await service.getBySourceBlockId('block-1')
      expect(links.length).toBe(2)
    })
  })
})
