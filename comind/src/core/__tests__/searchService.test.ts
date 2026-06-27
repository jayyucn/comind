/**
 * Core Layer - SearchService 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SearchService } from '../search/searchService'
import { MemoryAdapter } from '../storage/memoryAdapter'
import type { PageCreateOptions, BlockCreateOptions } from '../types'

describe('SearchService', () => {
  let searchService: SearchService
  let storage: MemoryAdapter

  beforeEach(async () => {
    storage = new MemoryAdapter()
    searchService = new SearchService({ storage })

    // 创建一些测试数据
    const page1 = await storage.pages.create({
      title: '测试页面一',
      type: 'normal',
    } as PageCreateOptions)

    const page2 = await storage.pages.create({
      title: '项目管理指南',
      type: 'normal',
    } as PageCreateOptions)

    await storage.blocks.create({
      pageId: page1.id,
      content: '这是第一个页面的内容，包含一些测试数据',
      type: 'bullet',
    } as BlockCreateOptions)

    await storage.blocks.create({
      pageId: page2.id,
      content: '项目管理需要规划、执行和监控三个阶段',
      type: 'bullet',
    } as BlockCreateOptions)
  })

  describe('initialize', () => {
    it('应能初始化并构建完整索引', async () => {
      expect(searchService.isInitialized()).toBe(false)
      await searchService.initialize()
      expect(searchService.isInitialized()).toBe(true)
      expect(searchService.getIndexSize()).toBeGreaterThan(0)
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      await searchService.initialize()
    })

    it('应能搜索页面标题', async () => {
      const results = await searchService.search('测试页面')
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.type === 'page')).toBe(true)
    })

    it('应能搜索 Block 内容', async () => {
      const results = await searchService.search('项目管理')
      expect(results.length).toBeGreaterThan(0)
    })

    it('应能限制结果数量', async () => {
      const results = await searchService.search('页面', { limit: 1 })
      expect(results.length).toBeLessThanOrEqual(1)
    })

    it('应能按类型过滤结果', async () => {
      const pageResults = await searchService.search('测试', { type: 'page' })
      expect(pageResults.every(r => r.type === 'page')).toBe(true)

      const blockResults = await searchService.search('内容', { type: 'block' })
      expect(blockResults.every(r => r.type === 'block')).toBe(true)
    })

    it('空查询应返回空结果', async () => {
      const results = await searchService.search('')
      expect(results).toEqual([])
    })
  })

  describe('updateBlock', () => {
    beforeEach(async () => {
      await searchService.initialize()
    })

    it('应能更新 Block 索引', async () => {
      const block = await storage.blocks.create({
        pageId: (await storage.pages.findAll(1, 0)).items[0].id,
        content: '新添加的特殊关键词 xyz123',
        type: 'bullet',
      } as BlockCreateOptions)

      // 更新前应该搜不到
      const beforeResults = await searchService.search('xyz123')
      expect(beforeResults.length).toBe(0)

      // 更新索引
      searchService.updateBlock(block)
      await searchService.flush()

      // 更新后应该能搜到
      const afterResults = await searchService.search('xyz123')
      expect(afterResults.length).toBeGreaterThan(0)
    })
  })

  describe('updatePage', () => {
    beforeEach(async () => {
      await searchService.initialize()
    })

    it('应能更新 Page 索引', async () => {
      const page = await storage.pages.create({
        title: '独特页面标题 abc987',
        type: 'normal',
      } as PageCreateOptions)

      // 更新前应该搜不到
      const beforeResults = await searchService.search('abc987')
      expect(beforeResults.length).toBe(0)

      // 更新索引
      searchService.updatePage(page)
      await searchService.flush()

      // 更新后应该能搜到
      const afterResults = await searchService.search('abc987')
      expect(afterResults.length).toBeGreaterThan(0)
    })
  })

  describe('removeBlock', () => {
    beforeEach(async () => {
      await searchService.initialize()
    })

    it('应能删除 Block 索引', async () => {
      const block = await storage.blocks.create({
        pageId: (await storage.pages.findAll(1, 0)).items[0].id,
        content: '将要被删除的关键词 del123',
        type: 'bullet',
      } as BlockCreateOptions)

      searchService.updateBlock(block)
      await searchService.flush()

      const beforeResults = await searchService.search('del123')
      expect(beforeResults.length).toBeGreaterThan(0)

      searchService.removeBlock(block.id)
      await searchService.flush()

      const afterResults = await searchService.search('del123')
      expect(afterResults.length).toBe(0)
    })
  })

  describe('rebuild', () => {
    beforeEach(async () => {
      await searchService.initialize()
    })

    it('应能重建索引', async () => {
      const sizeBefore = searchService.getIndexSize()
      await searchService.rebuild()
      const sizeAfter = searchService.getIndexSize()
      expect(sizeAfter).toBe(sizeBefore)
    })
  })
})
