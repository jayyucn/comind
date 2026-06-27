import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IndexManager } from '../indexManager'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import type { PageCreateOptions, BlockCreateOptions } from '../../types'

describe('IndexManager', () => {
  let indexManager: IndexManager
  let storage: MemoryAdapter

  beforeEach(async () => {
    storage = new MemoryAdapter()
    indexManager = new IndexManager({ storage, debounceMs: 10 })

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

  describe('buildFullIndex', () => {
    it('应构建完整索引', async () => {
      await indexManager.buildFullIndex()
      expect(indexManager.isReady()).toBe(true)
      expect(indexManager.size()).toBeGreaterThan(0)
    })

    it('应包含所有 Page 和 Block', async () => {
      await indexManager.buildFullIndex()
      const engine = indexManager.getSearchEngine()
      const results = engine.search('测试页面')
      expect(results.length).toBeGreaterThan(0)
    })

    it('应清空现有索引后重建', async () => {
      await indexManager.buildFullIndex()
      const sizeBefore = indexManager.size()

      await storage.pages.create({
        title: '新页面',
        type: 'normal',
      } as PageCreateOptions)

      await indexManager.buildFullIndex()
      const sizeAfter = indexManager.size()
      expect(sizeAfter).toBeGreaterThan(sizeBefore)
    })
  })

  describe('isReady', () => {
    it('初始状态应为 false', () => {
      expect(indexManager.isReady()).toBe(false)
    })

    it('构建索引后应为 true', async () => {
      await indexManager.buildFullIndex()
      expect(indexManager.isReady()).toBe(true)
    })
  })

  describe('updateBlock', () => {
    beforeEach(async () => {
      await indexManager.buildFullIndex()
    })

    it('应更新 Block 索引', async () => {
      const block = await storage.blocks.create({
        pageId: (await storage.pages.findAll(1, 0)).items[0].id,
        content: '新添加的特殊关键词 xyz123',
        type: 'bullet',
      } as BlockCreateOptions)

      indexManager.updateBlock(block)
      await indexManager.flush()

      const engine = indexManager.getSearchEngine()
      const results = engine.search('xyz123')
      expect(results.length).toBeGreaterThan(0)
    })

    it('应支持修改后的 Block 更新', async () => {
      const blocks = await storage.blocks.findAll(10, 0)
      const block = blocks.items[0]

      block.content = '修改后的内容包含关键词 abc789'
      indexManager.updateBlock(block)
      await indexManager.flush()

      const engine = indexManager.getSearchEngine()
      const results = engine.search('abc789')
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('updatePage', () => {
    beforeEach(async () => {
      await indexManager.buildFullIndex()
    })

    it('应更新 Page 索引', async () => {
      const page = await storage.pages.create({
        title: '独特页面标题 def456',
        type: 'normal',
      } as PageCreateOptions)

      indexManager.updatePage(page)
      await indexManager.flush()

      const engine = indexManager.getSearchEngine()
      const results = engine.search('def456')
      expect(results.length).toBeGreaterThan(0)
    })

    it('应支持修改后的 Page 更新', async () => {
      const pages = await storage.pages.findAll(10, 0)
      const page = pages.items[0]

      page.title = '修改后的标题包含关键词 ghi123'
      indexManager.updatePage(page)
      await indexManager.flush()

      const engine = indexManager.getSearchEngine()
      const results = engine.search('ghi123')
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('removeBlock', () => {
    beforeEach(async () => {
      await indexManager.buildFullIndex()
    })

    it('应删除 Block 索引', async () => {
      const block = await storage.blocks.create({
        pageId: (await storage.pages.findAll(1, 0)).items[0].id,
        content: '将要被删除的关键词 jkl789',
        type: 'bullet',
      } as BlockCreateOptions)

      indexManager.updateBlock(block)
      await indexManager.flush()

      const engine = indexManager.getSearchEngine()
      const beforeResults = engine.search('jkl789')
      expect(beforeResults.length).toBeGreaterThan(0)

      indexManager.removeBlock(block.id)
      await indexManager.flush()

      const afterResults = engine.search('jkl789')
      expect(afterResults.length).toBe(0)
    })
  })

  describe('removePage', () => {
    beforeEach(async () => {
      await indexManager.buildFullIndex()
    })

    it('应删除 Page 索引', async () => {
      const page = await storage.pages.create({
        title: '将要被删除的页面 mno321',
        type: 'normal',
      } as PageCreateOptions)

      indexManager.updatePage(page)
      await indexManager.flush()

      const engine = indexManager.getSearchEngine()
      const beforeResults = engine.search('mno321')
      expect(beforeResults.length).toBeGreaterThan(0)

      indexManager.removePage(page.id)
      await indexManager.flush()

      const afterResults = engine.search('mno321')
      expect(afterResults.length).toBe(0)
    })
  })

  describe('debounce 机制', () => {
    beforeEach(async () => {
      await indexManager.buildFullIndex()
    })

    it('应合并相同 ID 的多次更新', async () => {
      const block = await storage.blocks.create({
        pageId: (await storage.pages.findAll(1, 0)).items[0].id,
        content: 'unique-initial-keyword',
        type: 'bullet',
      } as BlockCreateOptions)

      indexManager.updateBlock(block)
      block.content = 'unique-update-keyword-1'
      indexManager.updateBlock(block)
      block.content = 'unique-update-keyword-2'
      indexManager.updateBlock(block)

      await indexManager.flush()

      const engine = indexManager.getSearchEngine()
      const results = engine.search('unique-update-keyword-2')
      expect(results.length).toBeGreaterThan(0)
    })

    it('flush 应立即执行待处理的更新', async () => {
      const block = await storage.blocks.create({
        pageId: (await storage.pages.findAll(1, 0)).items[0].id,
        content: '立即刷新关键词 pqr999',
        type: 'bullet',
      } as BlockCreateOptions)

      indexManager.updateBlock(block)
      await indexManager.flush()

      const engine = indexManager.getSearchEngine()
      const results = engine.search('pqr999')
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('rebuild', () => {
    beforeEach(async () => {
      await indexManager.buildFullIndex()
    })

    it('应重建索引', async () => {
      const sizeBefore = indexManager.size()
      await indexManager.rebuild()
      const sizeAfter = indexManager.size()
      expect(sizeAfter).toBe(sizeBefore)
      expect(indexManager.isReady()).toBe(true)
    })
  })

  describe('size', () => {
    it('应返回索引大小', async () => {
      await indexManager.buildFullIndex()
      const size = indexManager.size()
      expect(size).toBeGreaterThan(0)
    })

    it('空索引应返回 0', () => {
      const size = indexManager.size()
      expect(size).toBe(0)
    })
  })
})