/**
 * Core Layer - LunrSearch 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { LunrSearch } from '../search/lunrSearch'
import type { IndexDocument } from '../search/lunrSearch'

describe('LunrSearch', () => {
  let search: LunrSearch

  beforeEach(() => {
    search = new LunrSearch()
  })

  describe('add & search', () => {
    it('应能添加文档并搜索英文内容', () => {
      const doc: IndexDocument = {
        id: '1',
        type: 'block',
        pageId: 'page-1',
        content: 'hello world this is a test',
      }

      search.add(doc)
      const results = search.search('hello')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('1')
    })

    it('应能搜索中文内容（bigram 分词）', () => {
      const doc: IndexDocument = {
        id: '1',
        type: 'block',
        pageId: 'page-1',
        content: '这是一个测试文档',
      }

      search.add(doc)
      const results = search.search('测试')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('1')
    })

    it('应能按页面标题搜索（标题权重更高）', () => {
      const pageDoc: IndexDocument = {
        id: 'page-1',
        type: 'page',
        pageId: 'page-1',
        title: '项目管理',
        content: '项目管理',
      }
      const blockDoc: IndexDocument = {
        id: 'block-1',
        type: 'block',
        pageId: 'page-2',
        content: '项目管理的一些笔记',
      }

      search.add(pageDoc)
      search.add(blockDoc)
      const results = search.search('项目管理')
      expect(results.length).toBe(2)
      expect(results[0].type).toBe('page')
    })

    it('空查询应返回空结果', () => {
      const doc: IndexDocument = {
        id: '1',
        type: 'block',
        pageId: 'page-1',
        content: 'test content',
      }

      search.add(doc)
      const results = search.search('')
      expect(results).toEqual([])
    })
  })

  describe('update', () => {
    it('应能更新文档内容', () => {
      const doc: IndexDocument = {
        id: '1',
        type: 'block',
        pageId: 'page-1',
        content: 'original content',
      }

      search.add(doc)
      const originalResults = search.search('original')
      expect(originalResults.length).toBeGreaterThan(0)

      search.update({
        ...doc,
        content: 'updated content',
      })

      const updatedResults = search.search('updated')
      expect(updatedResults.length).toBeGreaterThan(0)

      const oldResults = search.search('original')
      expect(oldResults.length).toBe(0)
    })
  })

  describe('remove', () => {
    it('应能删除文档', () => {
      const doc: IndexDocument = {
        id: '1',
        type: 'block',
        pageId: 'page-1',
        content: 'test content',
      }

      search.add(doc)
      const beforeResults = search.search('test')
      expect(beforeResults.length).toBeGreaterThan(0)

      search.remove('1')
      const afterResults = search.search('test')
      expect(afterResults.length).toBe(0)
    })
  })

  describe('addAll', () => {
    it('应能批量添加文档', () => {
      const docs: IndexDocument[] = [
        { id: '1', type: 'block', pageId: 'page-1', content: 'first document' },
        { id: '2', type: 'block', pageId: 'page-1', content: 'second document' },
        { id: '3', type: 'block', pageId: 'page-2', content: 'third document' },
      ]

      search.addAll(docs)
      expect(search.size()).toBe(3)

      const results = search.search('document')
      expect(results.length).toBe(3)
    })
  })

  describe('clear', () => {
    it('应能清空所有索引', () => {
      const docs: IndexDocument[] = [
        { id: '1', type: 'block', pageId: 'page-1', content: 'test 1' },
        { id: '2', type: 'block', pageId: 'page-1', content: 'test 2' },
      ]

      search.addAll(docs)
      expect(search.size()).toBe(2)

      search.clear()
      expect(search.size()).toBe(0)

      const results = search.search('test')
      expect(results.length).toBe(0)
    })
  })

  describe('isReady', () => {
    it('新创建的搜索引擎应就绪', () => {
      expect(search.isReady()).toBe(true)
    })
  })

  describe('matchedText', () => {
    it('应返回匹配文本片段', () => {
      const doc: IndexDocument = {
        id: '1',
        type: 'block',
        pageId: 'page-1',
        content: '这是一段很长的测试文本，包含一些关键信息在中间位置',
      }

      search.add(doc)
      const results = search.search('测试文本')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].matchedText).toContain('测试文本')
    })
  })
})
