import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import {
  useRelationshipSync,
  applyRelationshipTypeToBlockContent
} from './useRelationshipSync'

// 4.3: Mock wasm/client (getCoreClient) for Vitest (no Tauri runtime).
// Lightweight re-implementation matching Rust ContentParseService behaviour.
vi.mock('../wasm/client', () => {
  function extractLinks(content: string) {
    const results: any[] = []
    const covered = new Set<number>()
    for (const m of content.matchAll(/\(\\(([^)]+)\)\)\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g)) {
      const target = m[2].trim()
      if (/^https?:\/\/|ftp:\/\/|mailto:/.test(target)) continue
      let relType: string | null = null, invType: string | null = null
      const part = m[1].trim()
      const bi = part.match(/^(.+)<->(.+)$/)
      if (bi) { relType = bi[1].trim(); invType = bi[2].trim() }
      else if (part.endsWith('!')) { relType = part.slice(0, -1).trim() }
      else { relType = part }
      results.push({
        target_title: target, display_text: (m[3] || target).trim(), position: m.index!,
        is_external: false, relationship_type: relType, inverse_relationship_type: invType
      })
      if (m.index !== undefined) for (let i = m.index; i < m.index + m[0].length; i++) covered.add(i)
    }
    for (const m of content.matchAll(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g)) {
      const target = m[1].trim()
      if (/^https?:\/\/|ftp:\/\/|mailto:/.test(target)) continue
      if (m.index !== undefined && covered.has(m.index)) continue
      results.push({
        target_title: target, display_text: (m[2] || target).trim(), position: m.index!,
        is_external: false, relationship_type: null, inverse_relationship_type: null
      })
    }
    results.sort((a, b) => a.position - b.position)
    return results
  }
  function applyRel(content: string, targetTitle: string, newType: string | null) {
    const esc = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    let r = content.replace(
      new RegExp(`\\(\\(([^)]+)\\)\\)\\[\\[(${esc})(?:\\|[^\\]]+?)?\\]\\]`, 'g'),
      (_, __, title) => newType === null ? `[[${title}]]` : `((${newType}))[[${title}]]`
    )
    if (newType !== null) {
      r = r.replace(
        new RegExp(`(?<!\\(\\([^)]+\\)\\))\\[\\[(${esc})(?:\\|[^\\]]+?)?\\]\\]`, 'g'),
        (_, title) => `((${newType}))[[${title}]]`
      )
    }
    return r
  }
  return {
    initCoreClient: vi.fn(async () => ({}) as never),
    getCoreClient: () => ({
        extractLinksFromContent: (c: string) => Promise.resolve(extractLinks(c)),
        applyRelationshipTypeToBlockContent: (c: string, t: string, r: string | null) => Promise.resolve(applyRel(c, t, r)),
  }),
  }
})

describe('useRelationshipSync', () => {
  describe('setEditingBlock', () => {
    it('应正确设置当前编辑 Block', () => {
      const blocks = ref<Array<{ id: string; content: string }>>([])
      const pageId = ref<string | null>('page-1')
      const { editingBlockId, setEditingBlock } = useRelationshipSync(pageId, blocks)

      expect(editingBlockId.value).toBeNull()
      setEditingBlock('block-a')
      expect(editingBlockId.value).toBe('block-a')
      setEditingBlock(null)
      expect(editingBlockId.value).toBeNull()
    })
  })

  describe('refreshSnapshot', () => {
    it('应建立 blockId -> targetTitle -> relationshipType 快照', async () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]] [[C]]' },
        { id: 'b2', content: '((related))[[B]] ((is-a))[[D]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { linkSnapshot, refreshSnapshot } = useRelationshipSync(pageId, blocks)

      await refreshSnapshot()

      expect(linkSnapshot.value.get('b1')?.get('B')).toBe('depends-on')
      expect(linkSnapshot.value.get('b1')?.has('C')).toBe(false)
      expect(linkSnapshot.value.get('b2')?.get('B')).toBe('related')
      expect(linkSnapshot.value.get('b2')?.get('D')).toBe('is-a')
    })

    it('应跳过当前正在编辑的 Block', async () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { linkSnapshot, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b1')
      await refreshSnapshot()

      expect(linkSnapshot.value.has('b1')).toBe(false)
    })
  })

  describe('syncRelationshipType', () => {
    it('应将新关系类型同步到其他指向相同目标的链接', async () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' },
        { id: 'b2', content: '参考 [[B]] 的设计' }
      ])
      const pageId = ref<string | null>('page-1')
      const { syncRelationshipType, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b1')
      await refreshSnapshot()

      const updated = await syncRelationshipType('b1', 'B', 'related')

      expect(updated).toHaveLength(1)
      expect(updated[0].id).toBe('b2')
      expect(updated[0].content).toBe('参考 ((related))[[B]] 的设计')
    })

    it('应跳过正在编辑的 Block（不修改其内容）', async () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' },
        { id: 'b2', content: '[[B]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { syncRelationshipType, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b2')
      await refreshSnapshot()

      const updated = await syncRelationshipType('b1', 'B', 'related')

      expect(updated).toHaveLength(0)
    })

    it('当 newRelationshipType 为 null 时应移除关系类型', async () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' },
        { id: 'b2', content: '参考 ((related))[[B]] 的设计' }
      ])
      const pageId = ref<string | null>('page-1')
      const { syncRelationshipType, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b1')
      await refreshSnapshot()

      const updated = await syncRelationshipType('b1', 'B', null)

      expect(updated).toHaveLength(1)
      expect(updated[0].id).toBe('b2')
      expect(updated[0].content).toBe('参考 [[B]] 的设计')
    })

    it('应保留链接的别名部分', async () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' },
        { id: 'b2', content: '[[B|项目B]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { syncRelationshipType, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b1')
      await refreshSnapshot()

      const updated = await syncRelationshipType('b1', 'B', 'related')

      expect(updated).toHaveLength(1)
      // Rust apply_relationship strips aliases to [[title]] form
      expect(updated[0].content).toBe('((related))[[B]]')
    })

    it('不包含目标链接的 Block 不应被修改', async () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' },
        { id: 'b2', content: '[[C]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { syncRelationshipType, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b1')
      await refreshSnapshot()

      const updated = await syncRelationshipType('b1', 'B', 'related')

      expect(updated).toHaveLength(0)
    })
  })

  describe('removeRelationshipType', () => {
    it('应移除页面内所有非编辑 Block 中对 targetTitle 的关系类型', async () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' },
        { id: 'b2', content: '((related))[[B]]' },
        { id: 'b3', content: '((is-a))[[B]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { removeRelationshipType, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b1')
      await refreshSnapshot()

      const updated = await removeRelationshipType('B')

      expect(updated).toHaveLength(2)
      expect(updated.find(u => u.id === 'b2')?.content).toBe('[[B]]')
      expect(updated.find(u => u.id === 'b3')?.content).toBe('[[B]]')
    })
  })

  describe('响应式', () => {
    it('blocks 变化时应自动刷新快照', async () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '[[B]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { linkSnapshot } = useRelationshipSync(pageId, blocks)

      // Initial snapshot is triggered by immediate watcher but is async
      // Wait for it to settle
      await new Promise(r => setTimeout(r, 50))
      expect(linkSnapshot.value.has('b1')).toBe(false)

      blocks.value = [{ id: 'b1', content: '((depends-on))[[B]]' }]
      // Watcher triggers async refreshSnapshot — wait for it
      await new Promise(r => setTimeout(r, 50))
      expect(linkSnapshot.value.get('b1')?.get('B')).toBe('depends-on')
    })
  })
})

describe('applyRelationshipTypeToBlockContent（export）', () => {
  it('应能作为命名导出函数从模块顶层导入', () => {
    expect(typeof applyRelationshipTypeToBlockContent).toBe('function')
  })

  it('应能移除 ((type))[[Target]] 的类型前缀', async () => {
    const content = 'see ((depends-on))[[Target]] for details'
    const result = await applyRelationshipTypeToBlockContent(content, 'Target', null)
    expect(result).toBe('see [[Target]] for details')
  })

  it('应能替换 ((oldType))[[Target]] 为 ((newType))[[Target]]', async () => {
    const content = 'see ((depends-on))[[Target]] for details'
    const result = await applyRelationshipTypeToBlockContent(content, 'Target', 'related')
    expect(result).toBe('see ((related))[[Target]] for details')
  })

  it('应支持别名形式 ((type))[[Target|alias]]', async () => {
    const content = 'see ((depends-on))[[Target|display]]'
    const result = await applyRelationshipTypeToBlockContent(content, 'Target', null)
    expect(result).toBe('see [[Target]]')
  })

  it('不应影响指向其他目标的链接', async () => {
    const content = '((depends-on))[[A]] and ((related))[[B]]'
    const result = await applyRelationshipTypeToBlockContent(content, 'A', null)
    expect(result).toBe('[[A]] and ((related))[[B]]')
  })
})
