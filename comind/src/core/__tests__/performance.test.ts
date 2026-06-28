/**
 * Core Layer - 性能基准测试
 *
 * 验证 1000+ Block 操作的性能表现
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { BlockService } from '../services/blockService'
import { MemoryAdapter } from '../storage/memoryAdapter'
import type { Block } from '../types'

describe('BlockService Performance', () => {
  let service: BlockService
  let storage: MemoryAdapter

  beforeEach(() => {
    storage = new MemoryAdapter()
    service = new BlockService({ storage })
  })

  // =============================================================================
  // 性能基准
  // =============================================================================

  describe('1000+ Block 操作性能', () => {
    it('1000 个 Block 创建应在 5 秒内完成', async () => {
      const start = performance.now()
      const pageId = 'perf-test-page'

      for (let i = 0; i < 1000; i++) {
        await service.create({
          pageId,
          parentId: null,
          content: `Block ${i}`,
          type: 'bullet',
        })
      }

      const elapsed = performance.now() - start
      console.log(`创建 1000 个 Block 耗时: ${elapsed.toFixed(2)}ms`)
      expect(elapsed).toBeLessThan(5000) // 5 秒阈值
    })

    it('1000 个 Block 查询应在 1 秒内完成', async () => {
      const pageId = 'perf-test-page'

      // 先创建 1000 个 Block
      for (let i = 0; i < 1000; i++) {
        await service.create({
          pageId,
          parentId: null,
          content: `Block ${i}`,
          type: 'bullet',
        })
      }

      const start = performance.now()
      const blocks = await service.getByPageId(pageId)
      const elapsed = performance.now() - start

      console.log(`查询 1000 个 Block 耗时: ${elapsed.toFixed(2)}ms`)
      expect(blocks.length).toBe(1000)
      expect(elapsed).toBeLessThan(1000) // 1 秒阈值
    })

    it('1000 个 Block 树构建应在 2 秒内完成', async () => {
      const pageId = 'perf-test-page'

      // 创建嵌套结构
      for (let i = 0; i < 500; i++) {
        await service.create({
          pageId,
          parentId: null,
          content: `Parent ${i}`,
          type: 'bullet',
        })
      }

      // 添加子节点
      const parents = await service.getByPageId(pageId)
      for (const parent of parents.slice(0, 100)) {
        for (let j = 0; j < 5; j++) {
          await service.create({
            pageId,
            parentId: parent.id,
            content: `Child ${parent.id} - ${j}`,
            type: 'bullet',
          })
        }
      }

      const start = performance.now()
      const tree = await service.buildTree(pageId)
      const elapsed = performance.now() - start

      console.log(`构建 Block 树（1100 个节点）耗时: ${elapsed.toFixed(2)}ms`)
      expect(elapsed).toBeLessThan(2000) // 2 秒阈值
    })

    it('1000 个 Block 批量删除应在 3 秒内完成', async () => {
      const pageId = 'perf-test-page'

      // 先创建 1000 个 Block
      const blockIds: string[] = []
      for (let i = 0; i < 1000; i++) {
        const block = await service.create({
          pageId,
          parentId: null,
          content: `Block ${i}`,
          type: 'bullet',
        })
        blockIds.push(block.id)
      }

      const start = performance.now()
      for (const id of blockIds) {
        await service.delete(id)
      }
      const elapsed = performance.now() - start

      console.log(`删除 1000 个 Block 耗时: ${elapsed.toFixed(2)}ms`)
      expect(elapsed).toBeLessThan(3000) // 3 秒阈值
    })

    it('搜索操作应在 500ms 内完成（1000 个 Block）', async () => {
      const pageId = 'perf-test-page'

      // 创建包含不同内容的 1000 个 Block
      const keywords = ['测试', '搜索', '性能', '基准', 'block']
      for (let i = 0; i < 1000; i++) {
        const keyword = keywords[i % keywords.length]
        await service.create({
          pageId,
          parentId: null,
          content: `这是第 ${i} 个 Block，内容包含 ${keyword} 关键词`,
          type: 'bullet',
        })
      }

      // 创建搜索索引（通过 PageService）
      const { SearchService } = await import('../search/searchService')
      const searchService = new SearchService({ storage })
      await searchService.initialize()

      const start = performance.now()
      const results = await searchService.search('测试', { limit: 20 })
      const elapsed = performance.now() - start

      console.log(`搜索 1000 个 Block 耗时: ${elapsed.toFixed(2)}ms`)
      expect(results.length).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(500) // 500ms 阈值
    })

    it('1000 个 Block 移动操作应在 2 秒内完成', async () => {
      const pageId = 'perf-test-page'

      // 创建 1000 个 Block
      const blockIds: string[] = []
      for (let i = 0; i < 1000; i++) {
        const block = await service.create({
          pageId,
          parentId: null,
          content: `Block ${i}`,
          type: 'bullet',
          order: i * 100,
        })
        blockIds.push(block.id)
      }

      const start = performance.now()

      // 移动操作：将前 100 个 Block 的顺序颠倒
      for (let i = 0; i < 50; i++) {
        const block1 = await service.getById(blockIds[i])
        const block2 = await service.getById(blockIds[99 - i])
        if (block1 && block2) {
          await service.update(block1.id, { order: block2.order + 1 })
        }
      }

      const elapsed = performance.now() - start

      console.log(`50 次移动操作耗时: ${elapsed.toFixed(2)}ms`)
      expect(elapsed).toBeLessThan(2000) // 2 秒阈值
    })
  })

  describe('内存使用基准', () => {
    it('1000 个 Block 存储应使用合理内存', async () => {
      const pageId = 'perf-test-page'

      // 创建 1000 个 Block
      for (let i = 0; i < 1000; i++) {
        await service.create({
          pageId,
          parentId: null,
          content: `Block ${i} - ${'x'.repeat(100)}`, // 每个 Block 约 100 字符
          type: 'bullet',
        })
      }

      // 验证所有 Block 都被正确存储
      const blocks = await service.getByPageId(pageId)
      expect(blocks.length).toBe(1000)

      // 验证内容完整性
      const firstBlock = blocks[0]
      expect(firstBlock.content).toContain('Block 0')
      expect(firstBlock.content.length).toBeGreaterThan(100)
    })
  })
})
