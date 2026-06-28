/**
 * Core Layer - TemplateService 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { TemplateService } from '../services/templateService'
import { MemoryAdapter } from '../storage/memoryAdapter'

describe('TemplateService', () => {
  let service: TemplateService
  let storage: MemoryAdapter

  beforeEach(() => {
    storage = new MemoryAdapter()
    service = new TemplateService({ storage })
  })

  // =============================================================================
  // 辅助函数
  // =============================================================================

  async function createTemplate(options: {
    name?: string
    category?: string
    sourcePageId?: string
    blocks?: any[]
    description?: string
  } = {}): Promise<any> {
    return service.create({
      name: options.name ?? `模板-${Date.now()}`,
      category: options.category ?? 'custom',
      sourcePageId: options.sourcePageId ?? 'source-page-1',
      blocks: options.blocks ?? [
        { type: 'heading', content: '标题' },
        { type: 'bullet', content: '内容' },
      ],
      description: options.description,
    })
  }

  // =============================================================================
  // CRUD 操作
  // =============================================================================

  describe('getById', () => {
    it('应返回已创建的模板', async () => {
      const created = await createTemplate({ name: '测试模板' })
      const found = await service.getById(created.id)
      expect(found).toBeDefined()
      expect(found?.id).toBe(created.id)
      expect(found?.name).toBe('测试模板')
    })

    it('不存在的 ID 返回 undefined', async () => {
      const found = await service.getById('non-existent')
      expect(found).toBeUndefined()
    })
  })

  describe('getByCategory', () => {
    it('应返回指定分类的模板', async () => {
      await createTemplate({ name: '工作模板', category: 'work' })
      await createTemplate({ name: '工作模板2', category: 'work' })
      await createTemplate({ name: '个人模板', category: 'personal' })
      const workTemplates = await service.getByCategory('work')
      expect(workTemplates.length).toBeGreaterThanOrEqual(2)
      expect(workTemplates.every(t => t.category === 'work')).toBe(true)
    })

    it('空分类返回空数组', async () => {
      const templates = await service.getByCategory('non-existent-category')
      expect(templates).toEqual([])
    })
  })

  describe('getAll', () => {
    it('应返回所有模板', async () => {
      await createTemplate({ name: '模板1' })
      await createTemplate({ name: '模板2' })
      const all = await service.getAll()
      expect(all.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('create', () => {
    it('应创建模板', async () => {
      const created = await createTemplate({
        name: '新模板',
        category: 'project',
        description: '这是一个测试模板',
      })
      expect(created.id).toMatch(/^tpl_/)
      expect(created.name).toBe('新模板')
      expect(created.category).toBe('project')
      expect(created.description).toBe('这是一个测试模板')
      expect(created.blocks).toHaveLength(2)
    })

    it('应生成唯一 ID', async () => {
      const t1 = await createTemplate({ name: '模板1' })
      const t2 = await createTemplate({ name: '模板2' })
      expect(t1.id).not.toBe(t2.id)
    })
  })

  describe('update', () => {
    it('应更新模板', async () => {
      const created = await createTemplate({ name: '原始名称' })
      const updated = await service.update(created.id, {
        name: '新名称',
        description: '新描述',
      })
      expect(updated.name).toBe('新名称')
      expect(updated.description).toBe('新描述')
      expect(updated.id).toBe(created.id)
    })

    it('不存在的 ID 应抛出错误', async () => {
      await expect(
        service.update('non-existent', { name: 'test' })
      ).rejects.toThrow()
    })
  })

  describe('delete', () => {
    it('应删除模板', async () => {
      const created = await createTemplate({ name: '待删除模板' })
      await service.delete(created.id)
      const found = await service.getById(created.id)
      expect(found).toBeUndefined()
    })
  })
})
