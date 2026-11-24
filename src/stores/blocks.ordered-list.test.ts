import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 有序列表序号推导（store 层）。
 *
 * 纯函数层的推演规则见 `composables/__tests__/ordered-list-index.test.ts`；这里只钉
 * 「纯函数管不了」的四件事：谁被写回（活动块跳过）、归一到哪个段（作用域）、
 * 派生数据（行内格式 / renderSegments）跟着平移、以及各结构入口（删除 / 缩进 / 粘贴）
 * 有没有触发重排。
 */
vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(async () => ({
    executeBatch: vi.fn(async () => []),
    saveBlockTree: vi.fn(async () => []),
    getFieldValues: vi.fn(async () => []),
    setFieldValue: vi.fn(),
    deleteFieldValue: vi.fn(),
    getBlocksByPage: vi.fn(async () => []),
    getPageWithBlocks: vi.fn(async () => null),
  })),
  getCoreClient: vi.fn(),
  isTauriEnvironment: vi.fn(() => false),
}))

describe('有序列表序号推导 — store', () => {
  let useBlockStore: typeof import('./blocks').useBlockStore
  let useEditorStore: typeof import('./editor').useEditorStore
  let readInlineMarks: typeof import('../utils/inline-marks').readInlineMarks

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useBlockStore = (await import('./blocks')).useBlockStore
    useEditorStore = (await import('./editor')).useEditorStore
    readInlineMarks = (await import('../utils/inline-marks')).readInlineMarks
  })

  /** 建一串同父兄弟块（内容按给定顺序） */
  async function seed(store: ReturnType<typeof useBlockStore>, pageId: string, contents: string[]) {
    const created = []
    for (const content of contents) {
      created.push(await store.createBlock({ pageId, content }))
    }
    return created
  }

  test('删中间项后补号：1,3,4 → 1,2,3', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [a, b, c] = await seed(store, pageId, ['1. A', '3. B', '4. C'])

    const changed = store.applyOrderedListNumbering(pageId)

    expect(changed.sort()).toEqual([b.id, c.id].sort())
    expect([a.content, b.content, c.content]).toEqual(['1. A', '2. B', '3. C'])
  })

  test('无需改动时不写回（零变更 = 零落库）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    await seed(store, pageId, ['1. A', '2. B'])

    expect(store.applyOrderedListNumbering(pageId)).toEqual([])
  })

  test('段首恒 1：存量 5,6,7 归一到 1,2,3，存量 olIndex 顺手丢弃', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const created = []
    created.push(await store.createBlock({ pageId, content: '5. A', format: { olIndex: 5, bold: true } }))
    created.push(await store.createBlock({ pageId, content: '6. B' }))
    created.push(await store.createBlock({ pageId, content: '7. C' }))

    store.applyOrderedListNumbering(pageId)

    expect(created.map(b => b.content)).toEqual(['1. A', '2. B', '3. C'])
    // 锚点字段已不在，其它 format 键原样
    expect(created[0].format.olIndex).toBeUndefined()
    expect(created[0].format.bold).toBe(true)
  })

  test('段中手写跳号被抹平：1,10,11 → 1,2,3', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [a, b, c] = await seed(store, pageId, ['1. A', '2. B', '3. C'])

    await store.updateBlockContent(b.id, '10. B')

    store.applyOrderedListNumbering(pageId)

    expect([a.content, b.content, c.content]).toEqual(['1. A', '2. B', '3. C'])
  })

  test('删段首 ⇒ 接替者回到 1，整段从 1 重排', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [a, b, c] = await seed(store, pageId, ['1. A', '2. B', '3. C'])

    await store.deleteBlocks([a.id])

    store.applyOrderedListNumbering(pageId)
    expect([b.content, c.content]).toEqual(['1. B', '2. C'])
  })

  test('删段中项 ⇒ 只顺排，不打任何标记', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [a, b, c] = await seed(store, pageId, ['1. A', '2. B', '3. C'])

    await store.deleteBlocks([b.id])

    store.applyOrderedListNumbering(pageId)
    expect(c.content).toBe('2. C')
    expect(a.content).toBe('1. A')
    expect(c.format.olIndex).toBeUndefined()
  })

  test('活动块跳过写回，但仍影响后续编号连续性', async () => {
    const store = useBlockStore()
    const editorStore = useEditorStore()
    const pageId = 'page-1'
    const [a, b, c] = await seed(store, pageId, ['1. A', '9. B', '9. C'])

    editorStore.activeBlockId = b.id
    const changed = store.applyOrderedListNumbering(pageId)

    expect(changed).toEqual([c.id])
    expect(b.content).toBe('9. B') // 正在打字：字面原样留着，交给编辑器
    expect(c.content).toBe('3. C') // 后续按推导（2）续号
    expect(a.content).toBe('1. A')
  })

  test('作用域：只归一被碰到的父组，别的段一个字段都不动', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [a, b] = await seed(store, pageId, ['5. A', '6. B'])
    const child1 = await store.createBlock({ pageId, content: '5. C', parentId: a.id })
    const child2 = await store.createBlock({ pageId, content: '6. D', parentId: a.id })

    const changed = store.applyOrderedListNumbering(pageId, { parents: [a.id] })

    expect(changed.sort()).toEqual([child1.id, child2.id].sort())
    expect([child1.content, child2.content]).toEqual(['1. C', '2. D'])
    // 根组没被碰到 ⇒ 保持原样（段首恒 1 也不越界改写）
    expect([a.content, b.content]).toEqual(['5. A', '6. B'])
  })

  test('透明块：代码块不打断段、不占号', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const a = await store.createBlock({ pageId, content: '5. A' })
    const code = await store.createBlock({ pageId, content: 'const x = 1', type: 'code' })
    const b = await store.createBlock({ pageId, content: '6. B' })

    store.applyOrderedListNumbering(pageId)

    expect([a.content, b.content]).toEqual(['1. A', '2. B'])
    expect(code.content).toBe('const x = 1')
  })

  test('高亮块：透明且自身不占号，前缀原样保留', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const a = await store.createBlock({ pageId, content: '5. A' })
    const note = await store.createBlock({ pageId, content: '3. 注意', format: { callout: 'warn' } })
    const b = await store.createBlock({ pageId, content: '6. B' })

    store.applyOrderedListNumbering(pageId)

    expect([a.content, b.content]).toEqual(['1. A', '2. B'])
    expect(note.content).toBe('3. 注意')
  })

  test('改号时行内格式跟着平移（不吞正文里的粗体）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    await seed(store, pageId, ['1. A'])
    const b = await store.createBlock({
      pageId,
      content: '9. ABC',
      format: { inlineMarks: [{ start: 3, end: 6, bold: true }] },
    })

    store.applyOrderedListNumbering(pageId)

    expect(b.content).toBe('2. ABC')
    // 前缀 9. → 2. 长度不变 → 偏移不动
    expect(readInlineMarks(b.format, b.content.length)).toEqual([{ start: 3, end: 6, bold: true }])
  })

  test('位数变化（9. → 10.）行内格式与 renderSegments 一起平移', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    await seed(store, pageId, ['1. A', '2. B', '3. C', '4. D', '5. E', '6. F', '7. G', '8. H'])
    const i = await store.createBlock({
      pageId,
      content: '9. ABC',
      format: { inlineMarks: [{ start: 3, end: 6, bold: true }] },
    })
    i.renderSegments = [{ type: 'text', start: 0, end: 6 }]

    store.applyOrderedListNumbering(pageId)

    expect(i.content).toBe('9. ABC') // 第 9 项本来就是 9 —— 不写回
    // 再插一项到前面，逼出 10.
    await store.createBlock({ pageId, content: '9. X', parentId: null, pos: i.pos - 100 })
    store.applyOrderedListNumbering(pageId)
    expect(i.content).toBe('10. ABC')
    expect(readInlineMarks(i.format, i.content.length)).toEqual([{ start: 4, end: 7, bold: true }])
    expect(i.renderSegments).toEqual([{ type: 'text', start: 1, end: 7 }])
  })

  test('缩进跨父 ⇒ 新父组里从 1 起算', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [a, b] = await seed(store, pageId, ['1. A', '5. B'])

    await store.indent(b.id)

    expect(b.parentId).toBe(a.id)
    store.applyOrderedListNumbering(pageId)
    expect(b.content).toBe('1. B')
  })

  test('Enter 续行序号 = 推导值 + 1（不是字面 + 1）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [a, b] = await seed(store, pageId, ['1. A', '7. B'])

    expect(store.nextOrderedListIndex(a.id)).toBe(2)
    expect(store.nextOrderedListIndex(b.id)).toBe(3)
  })

  test('菜单转有序列表：接上前面连续的有序列表，否则从 1 起', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    await seed(store, pageId, ['1. A', '2. B'])
    const after = await store.createBlock({ pageId, content: '随便' })
    const first = await store.createBlock({ pageId, content: '另一段', pos: -100 })

    expect(store.orderedListIndexForNew(after.id)).toBe(3)
    expect(store.orderedListIndexForNew(first.id)).toBe(1)
  })
})
