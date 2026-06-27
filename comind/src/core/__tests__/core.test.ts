import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initCore, getCore, isCoreInitialized, closeCore } from '../index'

describe('Core', () => {
  afterEach(async () => {
    await closeCore()
  })

  describe('initCore', () => {
    it('应初始化 Core 层（使用 memory 适配器）', async () => {
      const context = await initCore('memory')

      expect(context).toBeDefined()
      expect(context.storage).toBeDefined()
      expect(context.blockService).toBeDefined()
      expect(context.linkService).toBeDefined()
      expect(context.tagService).toBeDefined()
      expect(context.propertyService).toBeDefined()
      expect(context.pageService).toBeDefined()
      expect(context.searchService).toBeDefined()
    })

    it('应返回单例实例', async () => {
      const context1 = await initCore('memory')
      const context2 = await initCore('memory')

      expect(context1).toBe(context2)
    })

    it('isCoreInitialized 应返回 true', async () => {
      expect(isCoreInitialized()).toBe(false)

      await initCore('memory')

      expect(isCoreInitialized()).toBe(true)
    })
  })

  describe('getCore', () => {
    it('应返回已初始化的 Core 上下文', async () => {
      await initCore('memory')

      const context = getCore()

      expect(context).toBeDefined()
      expect(context.storage).toBeDefined()
    })

    it('未初始化时应抛出错误', () => {
      expect(() => getCore()).toThrow('Core not initialized')
    })
  })

  describe('closeCore', () => {
    it('应关闭 Core 层', async () => {
      await initCore('memory')

      expect(isCoreInitialized()).toBe(true)

      await closeCore()

      expect(isCoreInitialized()).toBe(false)
    })

    it('关闭后可重新初始化', async () => {
      await initCore('memory')
      await closeCore()

      const context = await initCore('memory')

      expect(context).toBeDefined()
      expect(isCoreInitialized()).toBe(true)
    })

    it('多次调用 closeCore 不应抛出错误', async () => {
      await initCore('memory')
      await closeCore()

      await expect(closeCore()).resolves.not.toThrow()
    })
  })

  describe('isCoreInitialized', () => {
    it('初始状态应为 false', () => {
      expect(isCoreInitialized()).toBe(false)
    })

    it('初始化后应为 true', async () => {
      await initCore('memory')
      expect(isCoreInitialized()).toBe(true)
    })

    it('关闭后应为 false', async () => {
      await initCore('memory')
      await closeCore()
      expect(isCoreInitialized()).toBe(false)
    })
  })
})