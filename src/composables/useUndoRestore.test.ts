/**
 * useUndoRestore 单测（ADR-0046 T3 / #108）。
 * 用 vi.mock 注入 client 单例，断言 restoreEntry 生成的批量操作与 reactive 状态回写。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Block } from '../types/block'
import type { Property, PropertyType } from '../types/property'
import type { HistoryEntry } from './useUndoHistory'

const hoisted = vi.hoisted(() => {
  const client = {
    executeBatch: vi.fn(() => Promise.resolve([])),
    undeleteBlocks: vi.fn(() => Promise.resolve()),
    getBlocksByPage: vi.fn(() => Promise.resolve([])),
    getPageWithBlocks: vi.fn(() => Promise.resolve({ page: {}, blocks: [] })),
    setProperty: vi.fn(() => Promise.resolve({})),
    deleteProperty: vi.fn(() => Promise.resolve()),
  }
  return { client }
})

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(hoisted.client)),
}))

import { useBlockStore } from '../stores/blocks'
import { usePropertyStore } from '../stores/property'
import { restoreEntry, redoAndRestore, undoAndRestore } from './useUndoRestore'
import { documentState, ensureStack, canUndo, canRedo, commitNow, resetUndoHistory, _debugStats } from './useUndoHistory'

function makeBlock(id: string, pageId: string, overrides: Partial<Block> = {}): Block {
  return {
    id,
    pageId,
    parentId: null,
    pos: 0,
    content: '',
    format: {},
    type: 'text',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function makeProp(
  id: string,
  blockId: string,
  key: string,
  value: unknown,
  type: PropertyType = 'string',
): Property {
  return {
    id,
    blockId,
    key,
    value: value as Property['value'],
    type,
    sortOrder: 0,
    isHidden: false,
    isDeleted: false,
    schemaVersion: 1,
    createdAt: 0,
    updatedAt: 0,
  }
}

function entry(
  blocks: Block[],
  properties: Record<string, Property[]> = {},
): HistoryEntry {
  return { blocks, properties }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  // 撤销栈是模块级单例：不重置会让上一条用例的栈（含游标位置）泄漏到下一条
  resetUndoHistory()
})

describe('文字撤销', () => {
  it('当前 content=world，目标快照 content=hello → 生成 block update 并回写 store', async () => {
    const bs = useBlockStore()
    bs.blocks = [makeBlock('b1', 'p1', { content: 'world' })]
    const ps = usePropertyStore()
    ps.propertiesByBlock = new Map()

    await restoreEntry('p1', entry([makeBlock('b1', 'p1', { content: 'hello' })]))

    const ops = hoisted.client.executeBatch.mock.calls[0][0] as Array<{
      entity: string
      action: string
      params: Record<string, unknown>
    }>
    expect(ops).toHaveLength(1)
    expect(ops[0]).toEqual({
      entity: 'block',
      action: 'update',
      params: {
        id: 'b1',
        page_id: 'p1',
        parent_id: null,
        pos: 0,
        content: 'hello',
        format: '{}',
        type: 'text',
      },
    })
    expect(bs.getBlocksByPage('p1')[0].content).toBe('hello')
    expect(hoisted.client.undeleteBlocks).not.toHaveBeenCalled()
  })
})

describe('结构操作撤销', () => {
  it('子块 B 的 parentId/pos 还原 → 生成 B 的 update 并回写', async () => {
    const bs = useBlockStore()
    bs.blocks = [
      makeBlock('b1', 'p1', { parentId: null, pos: 0 }),
      makeBlock('b2', 'p1', { parentId: 'b1', pos: 1 }),
    ]
    const ps = usePropertyStore()
    ps.propertiesByBlock = new Map()

    await restoreEntry(
      'p1',
      entry([
        makeBlock('b1', 'p1', { parentId: null, pos: 0 }),
        makeBlock('b2', 'p1', { parentId: null, pos: 1 }),
      ]),
    )

    const ops = hoisted.client.executeBatch.mock.calls[0][0] as Array<{
      entity: string
      action: string
      params: Record<string, unknown>
    }>
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ entity: 'block', action: 'update', params: { id: 'b2', parent_id: null, pos: 1 } })
    expect(bs.getBlocksByPage('p1').find((b) => b.id === 'b2')!.parentId).toBeNull()
  })
})

describe('删除撤销（含子树级联）', () => {
  it('当前仅 A，目标含 A/B/C → undelete([B,C]) + B/C update + B 属性 set，store 恢复整棵子树', async () => {
    const bs = useBlockStore()
    bs.blocks = [makeBlock('A', 'p1', { parentId: null, pos: 0 })]
    const ps = usePropertyStore()
    ps.propertiesByBlock = new Map()

    await restoreEntry(
      'p1',
      entry(
        [
          makeBlock('A', 'p1', { parentId: null, pos: 0 }),
          makeBlock('B', 'p1', { parentId: 'A', pos: 1, content: 'child' }),
          makeBlock('C', 'p1', { parentId: 'B', pos: 2, content: 'grandchild' }),
        ],
        { B: [makeProp('pB', 'B', 'status', 'Todo', 'string')] },
      ),
    )

    const ops = hoisted.client.executeBatch.mock.calls[0][0] as Array<{
      entity: string
      action: string
      params: Record<string, unknown>
    }>
    // 精确复活 B、C 作为 executeBatch 的前缀 op（不再走独立 undeleteBlocks RPC，
    // 整批单一事务；精确集合复活不级联，故不产生 stray）
    expect(ops[0]).toEqual({ entity: 'block', action: 'undelete', params: { id: 'B' } })
    expect(ops[1]).toEqual({ entity: 'block', action: 'undelete', params: { id: 'C' } })
    const blockUpdates = ops.filter((o) => o.entity === 'block' && o.action === 'update')
    expect(blockUpdates.map((o) => o.params.id)).toEqual(['B', 'C'])
    const propSet = ops.find((o) => o.entity === 'property' && o.action === 'set')
    expect(propSet).toMatchObject({
      action: 'set',
      params: { block_id: 'B', key: 'status', value: 'Todo', type: 'string' },
    })

    const pageBlocks = bs.getBlocksByPage('p1')
    expect(pageBlocks.map((b) => b.id).sort()).toEqual(['A', 'B', 'C'])
    expect(pageBlocks.find((b) => b.id === 'B')!.parentId).toBe('A')
    expect(ps.propertiesByBlock.get('B')?.[0]).toMatchObject({ key: 'status', value: 'Todo' })
  })
})

describe('删除撤销：属性行必须随块一并复活（生产删除路径）', () => {
  it('deleteBlocks 不清客户端属性缓存 → 块复活仍须强制 property set（否则 DB 属性行停在级联软删）', async () => {
    const bs = useBlockStore()
    const ps = usePropertyStore()
    bs.blocks = [
      makeBlock('A', 'p1', { parentId: null, pos: 0 }),
      makeBlock('B', 'p1', { parentId: 'A', pos: 1, content: 'child' }),
    ]
    ps.propertiesByBlock = new Map([['B', [makeProp('pB', 'B', 'project', 'CoMind')]]])

    // 生产删除路径：store 移块，但**不清理 propertyStore** —— 与 Rust 侧
    // delete_block_cascade → PropertyService::delete_by_block_id 的级联软删不对称。
    // 于是恢复时「目标属性 == 客户端缓存」并不蕴含「DB 属性行仍 live」。
    await bs.deleteBlocks(['B'])
    expect(ps.propertiesByBlock.get('B')).toHaveLength(1)

    await restoreEntry(
      'p1',
      entry(
        [
          makeBlock('A', 'p1', { parentId: null, pos: 0 }),
          makeBlock('B', 'p1', { parentId: 'A', pos: 1, content: 'child' }),
        ],
        { B: [makeProp('pB', 'B', 'project', 'CoMind')] },
      ),
    )

    // deleteBlocks 的落库在 setTimeout 里是另一个批次，故按 undelete 定位恢复批次
    const batches = hoisted.client.executeBatch.mock.calls.map(
      (c) => c[0] as Array<{ entity: string; action: string; params: Record<string, unknown> }>,
    )
    const restoreOps = batches.find((ops) => ops.some((o) => o.action === 'undelete'))!
    expect(restoreOps.find((o) => o.entity === 'property' && o.action === 'set')).toMatchObject({
      params: { block_id: 'B', key: 'project', value: 'CoMind' },
    })
  })
})

describe('精确复活不级联（Spec #6 回声抑制的结构性解法）', () => {
  it('恢复 B1 时精确复活 B1，不连带复活不在快照中的软删子块 B2（无 stray、无补删）', async () => {
    const bs = useBlockStore()
    bs.blocks = [] // p1 当前无 live 块（B1、B2 均已软删）
    const ps = usePropertyStore()
    ps.propertiesByBlock = new Map()

    // 目标快照只含 B1；B2 是此前独立软删的子块，不在目标中。
    // 精确集合复活只复活明确列出的 id（不级联），故 B2 不会被牵连复活，
    // 也就不需要事后补删 —— Spec #6 的级联回声场景在精确复活下不可能发生。
    await restoreEntry('p1', entry([makeBlock('B1', 'p1', { parentId: null, pos: 0 })]))

    const ops = hoisted.client.executeBatch.mock.calls[0][0] as Array<{
      entity: string
      action: string
      params: Record<string, unknown>
    }>
    // 仅精确复活 B1
    expect(ops[0]).toEqual({ entity: 'block', action: 'undelete', params: { id: 'B1' } })
    // 无 stray 补删
    expect(ops.filter((o) => o.action === 'delete')).toHaveLength(0)

    // 恢复态 store 仍是目标快照：只有 B1，无 B2
    expect(bs.getBlocksByPage('p1').map((b) => b.id)).toEqual(['B1'])
  })

  it('无回声（undelete 未越界）→ 不追加任何 block delete', async () => {
    const bs = useBlockStore()
    bs.blocks = []
    const ps = usePropertyStore()
    ps.propertiesByBlock = new Map()

    // undelete 后 live 块恰为目标快照，无 stray
    hoisted.client.getBlocksByPage.mockResolvedValueOnce([
      makeBlock('B1', 'p1', { parentId: null, pos: 0 }),
    ])

    await restoreEntry('p1', entry([makeBlock('B1', 'p1', { parentId: null, pos: 0 })]))

    const ops = hoisted.client.executeBatch.mock.calls[0][0] as Array<{
      entity: string
      action: string
      params: Record<string, unknown>
    }>
    expect(ops.filter((o) => o.action === 'delete')).toHaveLength(0)
  })
})

describe('renderSegments 退化修复（Spec #5）', () => {
  it('恢复后重读 render_segments 写回 store（typed_link/date_ref 不再退化）', async () => {
    const bs = useBlockStore()
    bs.blocks = [makeBlock('B', 'p1', { content: 'hello' })]
    usePropertyStore().propertiesByBlock = new Map()

    const segs = [
      { type: 'text', start: 0, end: 6 },
      {
        type: 'typed_link',
        start: 6,
        end: 20,
        target_page_title: 'world',
        display_text: 'world',
        relationship_type: 'child',
        rel_label: '子',
        rel_color: '#3B82F6',
      },
    ]
    hoisted.client.getPageWithBlocks.mockResolvedValueOnce({
      page: {},
      blocks: [{ block: { id: 'B' }, children: [], render_segments: segs, properties: [] }],
    })

    // 快照 slim 化时剔除 renderSegments；恢复后须从 getPageWithBlocks 重读写回
    await restoreEntry('p1', entry([makeBlock('B', 'p1', { content: 'hello [[world]]' })]))

    expect(bs.getBlocksByPage('p1')[0].renderSegments).toEqual(segs)
  })

  it('getPageWithBlocks 空/无该页（WASM 兜底）→ 不写回，renderSegments 保持 undefined', async () => {
    const bs = useBlockStore()
    bs.blocks = [makeBlock('B', 'p1', { content: 'hello' })]
    usePropertyStore().propertiesByBlock = new Map()

    // 默认 mock 返回空 blocks（等价 WASM stub）
    await restoreEntry('p1', entry([makeBlock('B', 'p1', { content: 'hello [[world]]' })]))

    expect(bs.getBlocksByPage('p1')[0].renderSegments).toBeUndefined()
  })
})

describe('属性撤销', () => {
  it('status 值变更 → set；多余 priority → delete；块未变则无 block 操作', async () => {
    const bs = useBlockStore()
    bs.blocks = [makeBlock('x', 'p1')]
    const ps = usePropertyStore()
    ps.propertiesByBlock = new Map([
      [
        'x',
        [
          makeProp('pid1', 'x', 'status', 'Doing', 'string'),
          makeProp('pid2', 'x', 'priority', 'High', 'string'),
        ],
      ],
    ])

    await restoreEntry(
      'p1',
      entry([makeBlock('x', 'p1')], { x: [makeProp('pid1', 'x', 'status', 'Todo', 'string')] }),
    )

    const ops = hoisted.client.executeBatch.mock.calls[0][0] as Array<{
      entity: string
      action: string
      params: Record<string, unknown>
    }>
    expect(ops.filter((o) => o.entity === 'block')).toHaveLength(0)
    const setOp = ops.find((o) => o.entity === 'property' && o.action === 'set')
    expect(setOp).toMatchObject({ params: { block_id: 'x', key: 'status', value: 'Todo', type: 'string' } })
    const delOp = ops.find((o) => o.entity === 'property' && o.action === 'delete')
    expect(delOp).toMatchObject({ params: { id: 'pid2' } })

    const props = ps.propertiesByBlock.get('x')
    expect(props).toHaveLength(1)
    expect(props![0]).toMatchObject({ key: 'status', value: 'Todo' })
  })
})

describe('新增块撤销（absent → 软删）', () => {
  it('当前多出的块不在目标中 → block delete 并从 store / 属性表移除', async () => {
    const bs = useBlockStore()
    bs.blocks = [
      makeBlock('A', 'p1', { parentId: null, pos: 0 }),
      makeBlock('extra', 'p1', { parentId: null, pos: 1, content: '后来新建的' }),
    ]
    const ps = usePropertyStore()
    ps.propertiesByBlock = new Map([
      ['extra', [makeProp('pExtra', 'extra', 'status', 'Todo', 'string')]],
    ])

    await restoreEntry('p1', entry([makeBlock('A', 'p1', { parentId: null, pos: 0 })]))

    const ops = hoisted.client.executeBatch.mock.calls[0][0] as Array<{
      entity: string
      action: string
      params: Record<string, unknown>
    }>
    expect(ops).toEqual([{ entity: 'block', action: 'delete', params: { id: 'extra' } }])
    expect(bs.getBlocksByPage('p1').map((b) => b.id)).toEqual(['A'])
    expect(ps.propertiesByBlock.has('extra')).toBe(false)
    expect(hoisted.client.undeleteBlocks).not.toHaveBeenCalled()
  })
})

describe('落库失败回滚', () => {
  it('executeBatch 拒绝 → reactive 状态回滚到调用前并向上抛错', async () => {
    const bs = useBlockStore()
    bs.blocks = [makeBlock('b1', 'p1', { content: 'world' })]
    const ps = usePropertyStore()
    ps.propertiesByBlock = new Map()

    hoisted.client.executeBatch.mockRejectedValueOnce(new Error('db down'))

    await expect(
      restoreEntry('p1', entry([makeBlock('b1', 'p1', { content: 'hello' })])),
    ).rejects.toThrow('db down')

    // 回滚：store 恢复为调用前状态
    expect(bs.getBlocksByPage('p1')[0].content).toBe('world')
    expect(hoisted.client.undeleteBlocks).not.toHaveBeenCalled()
  })
})

describe('redo 净空（撤销→改动→redo 清空）', () => {
  async function flushChange() {
    await vi.advanceTimersByTimeAsync(600)
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('undo 回到 s0（回声被抑制，栈保持 2 项、redo 仍可）；再改 s2 → redo 清空', async () => {
    const bs = useBlockStore()
    bs.blocks = [makeBlock('b1', 'p1', { content: 's0' })]
    const ps = usePropertyStore()
    ps.propertiesByBlock = new Map()

    ensureStack('p1')
    bs.blocks[0].content = 's1'
    await flushChange()
    expect(canUndo('p1')).toBe(true)

    await undoAndRestore('p1')
    expect(bs.getBlocksByPage('p1')[0].content).toBe('s0')
    expect(canUndo('p1')).toBe(false)
    // 回声抑制：restore 触发的 watcher 不应再入栈
    await flushChange()
    expect(_debugStats().stackSizes['p1']).toBe(2)
    expect(canRedo('p1')).toBe(true)

    // 撤销后发生新改动 → 标准 redo 清空语义：s1（redo 尾）被截掉，栈 = [s0, s2]
    bs.blocks[0].content = 's2'
    await flushChange()
    expect(bs.getBlocksByPage('p1')[0].content).toBe('s2')
    expect(_debugStats().stackSizes['p1']).toBe(2)
    expect(canRedo('p1')).toBe(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})

/**
 * 撤销落点（#109 T4）：恢复必须告诉调用方「改了哪些块」，否则「受影响块置为块选区
 * + 滚入视野」无从下手。顺序不作保证（落点方按文档序重排）。
 */
describe('返回受影响块 id', () => {
  it('文字撤销 ⇒ 返回被还原的块', async () => {
    const bs = useBlockStore()
    bs.blocks = [makeBlock('b1', 'p1', { content: 'world' })]
    usePropertyStore().propertiesByBlock = new Map()

    const ids = await restoreEntry('p1', entry([makeBlock('b1', 'p1', { content: 'hello' })]))

    expect(ids).toEqual(['b1'])
  })

  it('删除撤销（子树复活）⇒ 返回全部被复活的块', async () => {
    const bs = useBlockStore()
    bs.blocks = [makeBlock('A', 'p1', { parentId: null, pos: 0 })]
    usePropertyStore().propertiesByBlock = new Map()

    const ids = await restoreEntry(
      'p1',
      entry([
        makeBlock('A', 'p1', { parentId: null, pos: 0 }),
        makeBlock('B', 'p1', { parentId: 'A', pos: 1 }),
        makeBlock('C', 'p1', { parentId: 'B', pos: 2 }),
      ]),
    )

    expect([...ids].sort()).toEqual(['B', 'C'])
  })

  it('新增块撤销 ⇒ 返回被软删的块（已不在 store，落点方须自行过滤）', async () => {
    const bs = useBlockStore()
    bs.blocks = [
      makeBlock('A', 'p1', { parentId: null, pos: 0 }),
      makeBlock('extra', 'p1', { parentId: null, pos: 1 }),
    ]
    usePropertyStore().propertiesByBlock = new Map()

    const ids = await restoreEntry('p1', entry([makeBlock('A', 'p1', { parentId: null, pos: 0 })]))

    expect(ids).toEqual(['extra'])
  })

  it('仅属性变化 ⇒ 也要返回属性所属块（否则该次撤销没有落点）', async () => {
    const bs = useBlockStore()
    bs.blocks = [makeBlock('x', 'p1')]
    const ps = usePropertyStore()
    ps.propertiesByBlock = new Map([['x', [makeProp('pid1', 'x', 'status', 'Doing')]]])

    const ids = await restoreEntry(
      'p1',
      entry([makeBlock('x', 'p1')], { x: [makeProp('pid1', 'x', 'status', 'Todo')] }),
    )

    expect(ids).toEqual(['x'])
  })

  it('undoAndRestore / redoAndRestore 透传受影响块；无可撤/可重做时为 null', async () => {
    const bs = useBlockStore()
    bs.blocks = [makeBlock('b1', 'p1', { content: 'a' })]
    usePropertyStore().propertiesByBlock = new Map()
    ensureStack('p1')

    expect(await undoAndRestore('p1')).toBeNull() // 只有初始快照

    bs.blocks[0].content = 'b'
    commitNow('p1') // 键盘接管在撤销前会做同样的事
    expect(canUndo('p1')).toBe(true)

    expect(await undoAndRestore('p1')).toEqual(['b1'])
    expect(bs.getBlocksByPage('p1')[0].content).toBe('a')

    expect(await redoAndRestore('p1')).toEqual(['b1'])
    expect(bs.getBlocksByPage('p1')[0].content).toBe('b')
  })
})

/**
 * op 哨兵（#113）：block update op 的 params 是与 Rust block_update 的契约，
 * 构造保持手工——本哨兵只保证它**不漂移出信封**：params 键集 − {id} 必须落在
 * documentState 字段集（camelCase → snake_case 约定）内。op 检测到了信封没有的
 * 字段（或信封字段改名后 op 没跟上）都会在这里变红，而不是静默丢改动。
 */
describe('op 哨兵（#113）', () => {
  function camelToSnake(s: string): string {
    return s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
  }

  it('block update op 的 params 键集 ⊆ documentState 字段集（camel→snake）+ id', async () => {
    const bs = useBlockStore()
    bs.blocks = [makeBlock('b1', 'p1', { content: 'world' })]
    usePropertyStore().propertiesByBlock = new Map()

    await restoreEntry('p1', entry([makeBlock('b1', 'p1', { content: 'hello' })]))

    const ops = hoisted.client.executeBatch.mock.calls[0][0] as Array<{
      entity: string
      action: string
      params: Record<string, unknown>
    }>
    const updateOps = ops.filter((o) => o.entity === 'block' && o.action === 'update')
    expect(updateOps.length).toBeGreaterThan(0)

    const envelopeParamKeys = new Set([
      'id',
      ...Object.keys(documentState(makeBlock('x', 'p1'))).map(camelToSnake),
    ])
    for (const op of updateOps) {
      for (const key of Object.keys(op.params)) {
        expect(envelopeParamKeys.has(key)).toBe(true)
      }
    }
  })
})
