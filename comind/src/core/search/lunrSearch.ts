/**
 * Core Layer - Lunr.js 搜索引擎
 *
 * 基于 Lunr.js 的全文搜索引擎，支持中英文混合搜索。
 * - 英文：Lunr.js 自带的分词器
 * - 中文：bigram 字符二元切分
 *
 * 注意：Lunr.js 的 Index 是只读的，不支持增量更新。
 * 我们通过维护文档 Map + 定期重建来实现更新。
 */

import lunr from 'lunr'

/**
 * 索引文档类型
 */
export type IndexDocumentType = 'block' | 'page'

/**
 * 索引文档
 */
export interface IndexDocument {
  id: string
  type: IndexDocumentType
  pageId?: string
  blockId?: string
  title?: string
  content: string
}

/**
 * 搜索结果
 */
export interface LunrSearchResult {
  id: string
  type: IndexDocumentType
  pageId?: string
  blockId?: string
  title?: string
  content: string
  score: number
  matchedText: string
}

/**
 * LunrSearch 搜索引擎
 */
export class LunrSearch {
  private index: lunr.Index | null = null
  private documents: Map<string, IndexDocument> = new Map()
  private dirty = false
  private _ready = false

  constructor() {
    this.buildIndex()
  }

  /**
   * 构建索引
   */
  private buildIndex(): void {
    const docs = Array.from(this.documents.values())
    const self = this

    this.index = lunr(function (this: lunr.Builder) {
      this.field('title', { boost: 10 })
      this.field('content')
      this.ref('id')

      this.pipeline.reset()
      this.searchPipeline.reset()

      ;(this as any).tokenizer = function (
        obj: string | { content?: string; title?: string; id?: string },
        metadata?: any
      ) {
        const text = typeof obj === 'string' ? obj : (obj.content || '') + ' ' + (obj.title || '')
        const tokens = self.tokenize(text)
        return tokens.map(
          (t, i) =>
            new lunr.Token(t, {
              position: [i, 1],
              index: i,
              ...metadata,
            })
        )
      }

      for (const doc of docs) {
        this.add({
          id: doc.id,
          title: doc.title || '',
          content: doc.content || '',
        })
      }
    })

    this.dirty = false
    this._ready = true
  }

  /**
   * 确保索引是最新的
   */
  private ensureIndex(): void {
    if (this.dirty) {
      this.buildIndex()
    }
  }

  /**
   * 中英文混合分词
   * - 英文单词按空格分隔
   * - 中文字符按 bigram 切分
   */
  private tokenize(text: string): string[] {
    if (!text) return []

    const tokens: string[] = []
    let i = 0
    const len = text.length

    while (i < len) {
      const char = text[i]

      if (/[\u4e00-\u9fa5]/.test(char)) {
        if (i + 1 < len && /[\u4e00-\u9fa5]/.test(text[i + 1])) {
          tokens.push(text.slice(i, i + 2))
        }
        tokens.push(char)
        i++
      } else if (/[a-zA-Z0-9]/.test(char)) {
        let word = ''
        while (i < len && /[a-zA-Z0-9]/.test(text[i])) {
          word += text[i].toLowerCase()
          i++
        }
        if (word) {
          tokens.push(word)
        }
      } else {
        i++
      }
    }

    return tokens
  }

  /**
   * 检查索引是否就绪
   */
  isReady(): boolean {
    return this._ready && this.index !== null
  }

  /**
   * 添加文档到索引
   */
  add(doc: IndexDocument): void {
    this.documents.set(doc.id, doc)
    this.dirty = true
  }

  /**
   * 批量添加文档
   */
  addAll(docs: IndexDocument[]): void {
    for (const doc of docs) {
      this.documents.set(doc.id, doc)
    }
    this.dirty = true
  }

  /**
   * 更新索引中的文档
   */
  update(doc: IndexDocument): void {
    this.documents.set(doc.id, doc)
    this.dirty = true
  }

  /**
   * 从索引中删除文档
   */
  remove(id: string): void {
    this.documents.delete(id)
    this.dirty = true
  }

  /**
   * 搜索
   */
  search(query: string, limit = 20): LunrSearchResult[] {
    if (!query.trim()) return []

    this.ensureIndex()
    if (!this.index) return []

    const queryTokens = this.tokenize(query)
    if (queryTokens.length === 0) return []

    try {
      const results = this.index.query((q: any) => {
        for (const token of queryTokens) {
          q.term(token, {
            fields: ['title', 'content'],
            boost: 1,
          })
        }
      })

      return results.slice(0, limit).map((result: any) => {
        const doc = this.documents.get(result.ref)
        return {
          id: result.ref,
          type: (doc?.type || 'block') as IndexDocumentType,
          pageId: doc?.pageId,
          blockId: doc?.blockId,
          title: doc?.title,
          content: doc?.content || '',
          score: result.score,
          matchedText: this.extractMatchedText(doc?.content || '', query),
        }
      })
    } catch {
      return []
    }
  }

  /**
   * 提取匹配文本片段
   */
  private extractMatchedText(content: string, query: string, contextLength = 50): string {
    const lowerContent = content.toLowerCase()
    const lowerQuery = query.toLowerCase().trim()
    const index = lowerContent.indexOf(lowerQuery)

    if (index === -1) {
      return content.slice(0, contextLength * 2) + (content.length > contextLength * 2 ? '...' : '')
    }

    const start = Math.max(0, index - contextLength)
    const end = Math.min(content.length, index + query.length + contextLength)

    const prefix = start > 0 ? '...' : ''
    const suffix = end < content.length ? '...' : ''

    return prefix + content.slice(start, end) + suffix
  }

  /**
   * 重建索引
   */
  rebuild(): void {
    this.buildIndex()
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.documents.clear()
    this.buildIndex()
  }

  /**
   * 获取索引大小
   */
  size(): number {
    return this.documents.size
  }
}
