import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import {
  useRelationshipSync,
  applyRelationshipTypeToBlockContent
} from './useRelationshipSync'

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
    it('应建立 blockId -> targetTitle -> relationshipType 快照', () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]] [[C]]' },
        { id: 'b2', content: '((related))[[B]] ((is-a))[[D]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { linkSnapshot, refreshSnapshot } = useRelationshipSync(pageId, blocks)

      refreshSnapshot()

      expect(linkSnapshot.value.get('b1')?.get('B')).toBe('depends-on')
      expect(linkSnapshot.value.get('b1')?.has('C')).toBe(false)
      expect(linkSnapshot.value.get('b2')?.get('B')).toBe('related')
      expect(linkSnapshot.value.get('b2')?.get('D')).toBe('is-a')
    })

    it('应跳过当前正在编辑的 Block', () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { linkSnapshot, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b1')
      refreshSnapshot()

      expect(linkSnapshot.value.has('b1')).toBe(false)
    })
  })

  describe('syncRelationshipType', () => {
    it('应将新关系类型同步到其他指向相同目标的链接', () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' },
        { id: 'b2', content: '参考 [[B]] 的设计' }
      ])
      const pageId = ref<string | null>('page-1')
      const { syncRelationshipType, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b1')
      refreshSnapshot()

      const updated = syncRelationshipType('b1', 'B', 'related')

      expect(updated).toHaveLength(1)
      expect(updated[0].id).toBe('b2')
      expect(updated[0].content).toBe('参考 ((related))[[B]] 的设计')
    })

    it('应跳过正在编辑的 Block（不修改其内容）', () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' },
        { id: 'b2', content: '[[B]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { syncRelationshipType, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b2')
      refreshSnapshot()

      const updated = syncRelationshipType('b1', 'B', 'related')

      expect(updated).toHaveLength(0)
    })

    it('当 newRelationshipType 为 null 时应移除关系类型', () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' },
        { id: 'b2', content: '参考 ((related))[[B]] 的设计' }
      ])
      const pageId = ref<string | null>('page-1')
      const { syncRelationshipType, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b1')
      refreshSnapshot()

      const updated = syncRelationshipType('b1', 'B', null)

      expect(updated).toHaveLength(1)
      expect(updated[0].id).toBe('b2')
      expect(updated[0].content).toBe('参考 [[B]] 的设计')
    })

    it('应保留链接的别名部分', () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' },
        { id: 'b2', content: '[[B|项目B]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { syncRelationshipType, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b1')
      refreshSnapshot()

      const updated = syncRelationshipType('b1', 'B', 'related')

      expect(updated).toHaveLength(1)
      expect(updated[0].content).toBe('((related))[[B]]')
    })

    it('不包含目标链接的 Block 不应被修改', () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' },
        { id: 'b2', content: '[[C]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { syncRelationshipType, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b1')
      refreshSnapshot()

      const updated = syncRelationshipType('b1', 'B', 'related')

      expect(updated).toHaveLength(0)
    })
  })

  describe('removeRelationshipType', () => {
    it('应移除页面内所有非编辑 Block 中对 targetTitle 的关系类型', () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '((depends-on))[[B]]' },
        { id: 'b2', content: '((related))[[B]]' },
        { id: 'b3', content: '((is-a))[[B]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { removeRelationshipType, refreshSnapshot, setEditingBlock } = useRelationshipSync(pageId, blocks)

      setEditingBlock('b1')
      refreshSnapshot()

      const updated = removeRelationshipType('B')

      expect(updated).toHaveLength(2)
      expect(updated.find(u => u.id === 'b2')?.content).toBe('[[B]]')
      expect(updated.find(u => u.id === 'b3')?.content).toBe('[[B]]')
    })
  })

  describe('响应式', () => {
    it('blocks 变化时应自动刷新快照', () => {
      const blocks = ref<Array<{ id: string; content: string }>>([
        { id: 'b1', content: '[[B]]' }
      ])
      const pageId = ref<string | null>('page-1')
      const { linkSnapshot } = useRelationshipSync(pageId, blocks)

      expect(linkSnapshot.value.has('b1')).toBe(false)

      blocks.value = [{ id: 'b1', content: '((depends-on))[[B]]' }]
      expect(linkSnapshot.value.get('b1')?.get('B')).toBe('depends-on')
    })
  })
})

describe('applyRelationshipTypeToBlockContent（export）', () => {
  it('应能作为命名导出函数从模块顶层导入', () => {
    expect(typeof applyRelationshipTypeToBlockContent).toBe('function')
  })

  it('应能移除 ((type))[[Target]] 的类型前缀', () => {
    const content = 'see ((depends-on))[[Target]] for details'
    const result = applyRelationshipTypeToBlockContent(content, 'Target', null)
    expect(result).toBe('see [[Target]] for details')
  })

  it('应能替换 ((oldType))[[Target]] 为 ((newType))[[Target]]', () => {
    const content = 'see ((depends-on))[[Target]] for details'
    const result = applyRelationshipTypeToBlockContent(content, 'Target', 'related')
    expect(result).toBe('see ((related))[[Target]] for details')
  })

  it('应支持别名形式 ((type))[[Target|alias]]', () => {
    const content = 'see ((depends-on))[[Target|display]]'
    const result = applyRelationshipTypeToBlockContent(content, 'Target', null)
    expect(result).toBe('see [[Target]]')
  })

  it('不应影响指向其他目标的链接', () => {
    const content = '((depends-on))[[A]] and ((related))[[B]]'
    const result = applyRelationshipTypeToBlockContent(content, 'A', null)
    expect(result).toBe('[[A]] and ((related))[[B]]')
  })
})
