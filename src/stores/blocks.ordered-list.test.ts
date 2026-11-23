import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 有序列表序号推导（store 层）。
 *
 * 纯函数层的推演规则见 `composables/__tests__/ordered-list-index.test.ts`；这里只钉
 * 「纯函数管不了」的四件事：谁被写回（活动块跳过）、锚点的生灭、派生数据（行内格式 /
 * renderSegments）跟着平移、以及各结构入口（删除 / 缩进 / 拖动 / 粘贴）有没有触发重排。
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

  test('手写跳号 ⇒ 落成锚点，后续跟着变、前面不动（1, 10, 11）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [a, b, c] = await seed(store, pageId, ['1. A', '2. B', '3. C'])

    // 用户把第 2 项手改成 `10. `
    await store.updateBlockContent(b.id, '10. B')
    store.applyOrderedListNumbering(pageId, { authoredBlockId: b.id })

    expect(b.format.olIndex).toBe(10)
    expect([a.content, b.content, c.content]).toEqual(['1. A', '10. B', '11. C'])
  })

  test('手写值回到自然顺排 ⇒ 锚点清除', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [a, b] = await seed(store, pageId, ['1. A', '10. B'])
    b.format = { ...b.format, olIndex: 10 }

    await store.updateBlockContent(b.id, '2. B')
    store.applyOrderedListNumbering(pageId, { authoredBlockId: b.id })

    expect(b.format.olIndex).toBeUndefined()
    expect([a.content, b.content]).toEqual(['1. A', '2. B'])
  })

  test('锚点与字面不符时以锚点为准（写回对齐，不丢手写跳号）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [, b, c] = await seed(store, pageId, ['1. A', '5. B', '6. C'])
    b.format = { ...b.format, olIndex: 10 }

    store.applyOrderedListNumbering(pageId)

    expect([b.content, c.content]).toEqual(['10. B', '11. C'])
  })

  test('删段首 ⇒ 接替者锚定为 1，随后整段从 1 重排', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [a, b, c] = await seed(store, pageId, ['1. A', '2. B', '3. C'])

    await store.deleteBlocks([a.id])

    expect(b.format.olIndex).toBe(1)
    store.applyOrderedListNumbering(pageId)
    expect([b.content, c.content]).toEqual(['1. B', '2. C'])
  })

  test('删段中项 ⇒ 不打锚点，只顺排', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [a, b, c] = await seed(store, pageId, ['1. A', '2. B', '3. C'])

    await store.deleteBlocks([b.id])

    expect(a.format.olIndex).toBeUndefined()
    expect(c.format.olIndex).toBeUndefined()
    store.applyOrderedListNumbering(pageId)
    expect(c.content).toBe('2. C')
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

  test('缩进跨父 ⇒ 锚点作废（锚点只在本父层内有效）', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'
    const [a, b] = await seed(store, pageId, ['1. A', '5. B'])
    b.format = { ...b.format, olIndex: 5 }

    await store.indent(b.id)

    expect(b.parentId).toBe(a.id)
    expect(b.format.olIndex).toBeUndefined()
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
