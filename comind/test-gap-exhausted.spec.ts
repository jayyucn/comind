/**
 * Gap Exhausted 错误修复验证测试
 * 
 * 测试场景：连续快速创建 Block，验证间隔耗尽时的重编号逻辑
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from './src/stores/blocks'
import { calcInsertPos, renumberBlocks, GAP_SIZE } from './src/utils/block-helpers'
import type { Block } from './src/types/block'

// Mock IndexedDB 存储层
vi.mock('./src/storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn(),
    deleteBlock: vi.fn(),
    deleteBlockCascade: vi.fn(),
    getBlockTree: vi.fn().mockResolvedValue([])
  }
}))

describe('Gap Exhausted Fix', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('should correctly recalculate positions after renumbering', async () => {
    const blockStore = useBlockStore()
    
    // 创建初始 Block（模拟间隔耗尽场景）
    const blocks: Block[] = []
    let pos = 1000
    
    // 连续在相同间隔内插入，模拟间隔耗尽
    for (let i = 0; i < 15; i++) {
      pos = Math.floor((1000 + pos) / 2)
      blocks.push({
        id: `block-${i}`,
        content: `Block ${i}`,
        parentId: null,
        pageId: 'test-page',
        pos,
        format: {},
        type: 'bullet',
        properties: {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    }

    // 验证间隔已接近耗尽
    const sorted = [...blocks].sort((a, b) => a.pos - b.pos)
    const lastGap = sorted[sorted.length - 1].pos - sorted[sorted.length - 2].pos
    expect(lastGap).toBeLessThanOrEqual(2) // 间隔应为 1 或 2

    // 触发重编号
    renumberBlocks(blocks)

    // 验证重编号后间隔恢复
    const renumbered = [...blocks].sort((a, b) => a.pos - b.pos)
    for (let i = 1; i < renumbered.length; i++) {
      const gap = renumbered[i].pos - renumbered[i - 1].pos
      expect(gap).toBe(GAP_SIZE) // 所有间隔应为 GAP_SIZE
    }
  })

  it('should handle rapid consecutive inserts', async () => {
    const blockStore = useBlockStore()
    
    // 模拟快速连续插入场景
    // 这里主要验证不会抛出异常
    const pageId = 'test-page'
    
    // 创建第一个 Block
    const block1 = await blockStore.createBlock({
      pageId,
      content: 'First block'
    })
    
    expect(block1).toBeDefined()
    expect(block1.pos).toBeGreaterThan(0)

    // 连续插入多个 Block
    const blocks = [block1]
    for (let i = 0; i < 20; i++) {
      const newBlock = await blockStore.createBlock({
        pageId,
        content: `Block ${i + 2}`
      })
      blocks.push(newBlock)
    }

    // 验证所有 Block 都创建成功
    expect(blocks.length).toBe(21)
    
    // 验证位置唯一
    const positions = blocks.map(b => b.pos)
    const uniquePositions = new Set(positions)
    expect(uniquePositions.size).toBe(positions.length)
  })
})

// 独立测试 calcInsertPos 的边界情况
describe('calcInsertPos edge cases', () => {
  it('should throw GapExhaustedError when gap is 1', () => {
    expect(() => calcInsertPos(1000, 1001)).toThrow()
  })

  it('should throw GapExhaustedError when gap is 0', () => {
    expect(() => calcInsertPos(1000, 1000)).toThrow()
  })

  it('should calculate correct midpoint', () => {
    const mid = calcInsertPos(1000, 2000)
    expect(mid).toBe(1500)
  })

  it('should handle null prevPos', () => {
    const pos = calcInsertPos(null, 5000)
    expect(pos).toBe(5000 - GAP_SIZE)
  })

  it('should handle null nextPos', () => {
    const pos = calcInsertPos(5000, null)
    expect(pos).toBe(5000 + GAP_SIZE)
  })

  it('should handle both null', () => {
    const pos = calcInsertPos(null, null)
    expect(pos).toBe(GAP_SIZE)
  })
})
