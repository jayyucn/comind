import { describe, it, expect, beforeEach } from 'vitest'
import { PageService } from '../services/pageService'
import { MemoryAdapter } from '../storage/memoryAdapter'
import type { Page } from '../types'

describe('PageService', () => {
  let service: PageService
  let storage: MemoryAdapter

  beforeEach(() => {
    storage = new MemoryAdapter()
    service = new PageService({ storage })
  })

  async function createPage(options: {
    title?: string
    type?: 'normal' | 'journal' | 'concept'
  } = {}): Promise<Page> {
    return service.create({
      title: options.title ?? 'Test Page',
      type: options.type ?? 'normal',
    })
  }

  describe('getById', () => {
    it('应返回已创建的 Page', async () => {
      const created = await createPage({ title: 'Hello Page' })
      const found = await service.getById(created.id)
      expect(found).toBeDefined()
      expect(found?.id).toBe(created.id)
      expect(found?.title).toBe('Hello Page')
    })

    it('不存在的 ID 返回 undefined', async () => {
      const found = await service.getById('non-existent')
      expect(found).toBeUndefined()
    })
  })

  describe('getByTitle', () => {
    it('应返回指定标题的 Page', async () => {
      await createPage({ title: 'Unique Title' })
      const found = await service.getByTitle('Unique Title')
      expect(found).toBeDefined()
      expect(found?.title).toBe('Unique Title')
    })

    it('不存在的标题返回 undefined', async () => {
      const found = await service.getByTitle('Non-existent Title')
      expect(found).toBeUndefined()
    })
  })

  describe('getAll', () => {
    it('应返回所有 Page', async () => {
      await createPage({ title: 'Page 1' })
      await createPage({ title: 'Page 2' })

      const pages = await service.getAll()
      expect(pages.length).toBeGreaterThanOrEqual(2)
    })

    it('空存储返回空数组', async () => {
      const pages = await service.getAll()
      expect(pages.length).toBe(0)
    })
  })

  describe('getRecent', () => {
    it('应返回最近的 Page', async () => {
      await createPage({ title: 'Old Page' })
      await createPage({ title: 'New Page' })

      const recent = await service.getRecent(1)
      expect(recent.length).toBe(1)
    })

    it('默认返回 10 个', async () => {
      for (let i = 0; i < 15; i++) {
        await createPage({ title: `Page ${i}` })
      }

      const recent = await service.getRecent()
      expect(recent.length).toBe(10)
    })
  })

  describe('create', () => {
    it('应创建带默认值的 Page', async () => {
      const page = await service.create({ title: 'New Page' })

      expect(page.id).toBeDefined()
      expect(page.title).toBe('New Page')
      expect(page.type).toBe('normal')
      expect(page.createdAt).toBeDefined()
      expect(page.updatedAt).toBeDefined()
      expect(page.deleted).toBe(false)
    })

    it('应使用提供的值覆盖默认值', async () => {
      const page = await service.create({
        title: 'Journal Page',
        type: 'journal',
      })

      expect(page.title).toBe('Journal Page')
      expect(page.type).toBe('journal')
    })
  })

  describe('update', () => {
    it('应更新 Page 的标题', async () => {
      const page = await createPage({ title: 'Original' })
      const updated = await service.update(page.id, { title: 'Updated' })

      expect(updated.title).toBe('Updated')
    })

    it('应更新多个字段', async () => {
      const page = await createPage({ title: 'Original', type: 'normal' })
      const updated = await service.update(page.id, {
        title: 'New Title',
        type: 'concept',
      })

      expect(updated.title).toBe('New Title')
      expect(updated.type).toBe('concept')
    })
  })

  describe('rename', () => {
    it('应重命名 Page', async () => {
      const page = await createPage({ title: 'Old Name' })
      const renamed = await service.rename(page.id, 'New Name')

      expect(renamed.title).toBe('New Name')
    })
  })

  describe('softDelete', () => {
    it('应软删除 Page（移至回收站）', async () => {
      const page = await createPage()

      await service.softDelete(page.id)

      const found = await service.getById(page.id)
      expect(found?.deleted).toBe(true)
    })

    it('删除后不应出现在 getAll 中', async () => {
      const page = await createPage({ title: 'Deleted Page' })

      await service.softDelete(page.id)

      const pages = await service.getAll()
      expect(pages.some(p => p.id === page.id)).toBe(false)
    })

    it('应出现在 getDeleted 中', async () => {
      const page = await createPage({ title: 'Deleted Page' })

      await service.softDelete(page.id)

      const deleted = await service.getDeleted()
      expect(deleted.items.some(p => p.id === page.id)).toBe(true)
    })

    it('删除不存在的 Page 不抛出错误', async () => {
      await expect(service.softDelete('non-existent')).resolves.not.toThrow()
    })
  })

  describe('restore', () => {
    it('应恢复已删除的 Page', async () => {
      const page = await createPage()

      await service.softDelete(page.id)
      await service.restore(page.id)

      const found = await service.getById(page.id)
      expect(found?.deleted).toBe(false)
    })

    it('恢复后应出现在 getAll 中', async () => {
      const page = await createPage({ title: 'Restored Page' })

      await service.softDelete(page.id)
      await service.restore(page.id)

      const pages = await service.getAll()
      expect(pages.some(p => p.id === page.id)).toBe(true)
    })

    it('恢复不存在的 Page 不抛出错误', async () => {
      await expect(service.restore('non-existent')).resolves.not.toThrow()
    })
  })

  describe('permanentDelete', () => {
    it('应永久删除 Page', async () => {
      const page = await createPage()

      await service.softDelete(page.id)
      await service.permanentDelete(page.id)

      const found = await service.getById(page.id)
      expect(found).toBeUndefined()
    })

    it('永久删除不存在的 Page 不抛出错误', async () => {
      await expect(service.permanentDelete('non-existent')).resolves.not.toThrow()
    })
  })

  describe('emptyTrash', () => {
    it('应清空回收站', async () => {
      const page1 = await createPage({ title: 'Trash 1' })
      const page2 = await createPage({ title: 'Trash 2' })

      await service.softDelete(page1.id)
      await service.softDelete(page2.id)

      await service.emptyTrash()

      const deleted = await service.getDeleted()
      expect(deleted.items.length).toBe(0)
    })

    it('空回收站不抛出错误', async () => {
      await expect(service.emptyTrash()).resolves.not.toThrow()
    })
  })
})