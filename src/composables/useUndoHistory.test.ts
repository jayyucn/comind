/**
 * useUndoHistory 单测（issue #107 / ADR-0046 T2）。
 * 五类：捕获触发 / idle 合并 / 预算裁切 / 派生字段剔除 / 页面隔离(+属性归因)。
 * 用假定时器把 idle 窗口注入到极短，保证确定性。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useBlockStore } from '../stores/blocks'
import { usePropertyStore } from '../stores/property'
import type { Block } from '../types/block'
import type { RenderSegment } from '../wasm/types'
import type { Property as RawProperty } from '../types/property'
import {
  ensureStack,
  commitNow,
  undo,
  redo,
  canUndo,
  canRedo,
  configureUndoHistory,
  resetUndoHistory,
  _debugStats,
} from './useUndoHistory'

function makeBlock(id: string, pageId: string, over: Partial<Block> = {}): Block {
  return {
    id,
    pageId,
    parentId: null,
    pos: 1000,
    content: 'x',
    format: {},
    type: 'bullet',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function makeProp(blockId: string, key: string, value: unknown, type: RawProperty['type'] = 'string'): RawProperty {
  return {
    id: `prop-${key}`,
    blockId,
    key,
    value,
    type,
    sortOrder: 0,
    isHidden: 0,
    isDeleted: 0,
    schemaVersion: 1,
    createdAt: 0,
    updatedAt: 0,
  }
}

/** 触发一次变更并走完 idle 窗口 */
async function flushChange(): Promise<void> {
  await nextTick()
  vi.advanceTimersByTime(50)
  await nextTick()
}

beforeEach(() => {
  setActivePinia(createPinia())
  resetUndoHistory()
  configureUndoHistory({ idleMs: 20, maxBytes: 32 * 1024 * 1024 })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('捕获触发', () => {
  it('改 content → idle 后入栈，canUndo 变 true，undo 回到初始', async () => {
    const blockStore = useBlockStore()
    blockStore.blocks = [makeBlock('b1', 'p1', { content: 'hello' })]
    ensureStack('p1')
    expect(canUndo('p1')).toBe(false)

    blockStore.blocks[0].content = 'world'
    await flushChange()

    expect(canUndo('p1')).toBe(true)
    const snap = undo('p1')
    expect(snap?.blocks[0].content).toBe('hello')
  })
})

describe('idle 合并', () => {
  it('分步：每次走完一个 idle 窗口各算一步（连续 3 次 = 初始 + 3 = 4 条）', async () => {
    const blockStore = useBlockStore()
    blockStore.blocks = [makeBlock('b1', 'p1', { content: 'a' })]
    ensureStack('p1')

    blockStore.blocks[0].content = 'b'
    await flushChange() // 第一次改动 → 入栈 [a, b]
    blockStore.blocks[0].content = 'c'
    await flushChange() // 第二次（上一个窗口已走完，新窗口）
    blockStore.blocks[0].content = 'd'
    await flushChange() // 第三次

    // 每次 flushChange 都走完一个 idle 窗口 ⇒ 每次都是独立一步
    expect(_debugStats().stackSizes['p1']).toBe(4) // [a,b,c,d]
    expect(undo('p1')?.blocks[0].content).toBe('c')
  })

  it('窗口内的多次写入合成一步：改 3 次但只 reset 一次计时器', async () => {
    const blockStore = useBlockStore()
    blockStore.blocks = [makeBlock('b1', 'p1', { content: 'a' })]
    ensureStack('p1')

    blockStore.blocks[0].content = 'b'
    await nextTick()
    vi.advanceTimersByTime(5)
    blockStore.blocks[0].content = 'c'
    await nextTick()
    vi.advanceTimersByTime(5)
    blockStore.blocks[0].content = 'd'
    await nextTick()
    vi.advanceTimersByTime(40) // 只在最后走完窗口
    await nextTick()

    expect(_debugStats().stackSizes['p1']).toBe(2) // [a, d] 合并
    expect(canUndo('p1')).toBe(true)
    expect(undo('p1')?.blocks[0].content).toBe('a')
  })
})

describe('预算裁切', () => {
  it('超字节预算 ⇒ 裁最旧，总字节回落预算内', async () => {
    const blockStore = useBlockStore()
    configureUndoHistory({ idleMs: 10, maxBytes: 300 })
    blockStore.blocks = [makeBlock('b1', 'p1', { content: 'seed' })]
    ensureStack('p1')

    for (let i = 0; i < 10; i++) {
      blockStore.blocks[0].content = 'payload-' + i + '-yyyyyyyy'
      await flushChange()
    }

    const stats = _debugStats()
    expect(stats.totalBytes).toBeLessThanOrEqual(300)
    expect(stats.stackSizes['p1']).toBeLessThan(11) // 初始 + 10 次被裁
  })

  it('#110 验收#4：>1000 块页在默认 32MB 预算下超限裁最旧', async () => {
    const blockStore = useBlockStore()
    const N = 1001
    // >1000 块页：内容带填充，使单份快照体积可观，32MB 预算在可接受步数内被越过。
    // 各块 id 用短名（非真实 uuid），故用较长正文补偿体积，确保「250 步 × 单份快照」远大于 32MB。
    const blocks: Block[] = []
    for (let i = 0; i < N; i++) {
      blocks.push(makeBlock(`b${i}`, 'p1', { content: `block-${i}-${'x'.repeat(200)}` }))
    }
    blockStore.blocks = blocks
    // 默认 32MB（不注入小预算）
    configureUndoHistory({ idleMs: 10, maxBytes: 32 * 1024 * 1024 })
    ensureStack('p1')
    expect(_debugStats().totalBytes).toBeLessThan(32 * 1024 * 1024)

    // 反复改一个块并立即封口（同键盘接管路径）；250 步累计远超 32MB ⇒ 必然触发裁最旧
    const steps = 250
    for (let i = 0; i < steps; i++) {
      blockStore.blocks[0].content = `step-${i}-${'y'.repeat(200)}`
      commitNow('p1')
    }

    const stats = _debugStats()
    expect(stats.totalBytes).toBeLessThanOrEqual(32 * 1024 * 1024)
    // 裁切发生：若未裁，栈长应为 steps + 1（初始 + 250）；裁后远小于此
    expect(stats.stackSizes['p1']).toBeLessThan(steps + 1)
  })
})

describe('派生字段剔除', () => {
  it('renderSegments/properties 不入栈；format 深拷贝且引用独立；属性进 envelope', async () => {
    const blockStore = useBlockStore()
    const propertyStore = usePropertyStore()
    const block = makeBlock('b1', 'p1', { content: 'c', format: { collapsed: false } })
    const seg: RenderSegment = { kind: 'text', text: 'x' } as RenderSegment
    block.renderSegments = [seg]
    block.properties = [makeProp('b1', 'k', 'v')]
    blockStore.blocks = [block]
    propertyStore.propertiesByBlock = new Map([
      ['b1', [makeProp('b1', 'status', 'Todo')]],
    ])
    ensureStack('p1')

    blockStore.blocks[0].format.collapsed = true
    await flushChange()

    // 已在最新态，redo 返回 null；先 undo 回初始再 redo 取回最新快照
    undo('p1')
    const latest = redo('p1')!
    const sb = latest.blocks[0]
    expect((sb as unknown as { renderSegments?: unknown }).renderSegments).toBeUndefined()
    expect((sb as unknown as { properties?: unknown }).properties).toBeUndefined()
    expect(sb.format).toEqual({ collapsed: true })

    // 深拷贝独立：改原 block.format，快照不受影响
    blockStore.blocks[0].format.collapsed = false
    expect(sb.format).toEqual({ collapsed: true })

    // 属性被捕获进 envelope
    expect(latest.properties['b1']?.[0]?.value).toBe('Todo')
  })
})

describe('页面隔离', () => {
  it('仅改动页 A ⇒ 页 A 栈增长，页 B 不受影响；各自撤销互不干扰', async () => {
    const blockStore = useBlockStore()
    blockStore.blocks = [
      makeBlock('a1', 'pA', { content: 'a-orig' }),
      makeBlock('a2', 'pA', { content: 'a2' }),
      makeBlock('b1', 'pB', { content: 'b-orig' }),
      makeBlock('b2', 'pB', { content: 'b2' }),
    ]
    ensureStack('pA')
    ensureStack('pB')
    expect(canUndo('pA')).toBe(false)
    expect(canUndo('pB')).toBe(false)

    blockStore.blocks.find((b) => b.id === 'a1')!.content = 'A-changed'
    await flushChange()
    expect(canUndo('pA')).toBe(true)
    expect(canUndo('pB')).toBe(false)

    blockStore.blocks.find((b) => b.id === 'b1')!.content = 'B-changed'
    await flushChange()
    expect(canUndo('pB')).toBe(true)

    const snapA = undo('pA')!
    expect(snapA.blocks.find((b) => b.id === 'a1')!.content).toBe('a-orig')
    // 页 B 的栈未受页 A 撤销影响
    expect(canRedo('pB')).toBe(false)
  })

  it('属性变更归因到所属页 ⇒ 改块属性也入栈', async () => {
    const blockStore = useBlockStore()
    const propertyStore = usePropertyStore()
    blockStore.blocks = [makeBlock('a1', 'pA', { content: 'c' })]
    propertyStore.propertiesByBlock = new Map([['a1', []]])
    ensureStack('pA')

    // 模拟 setProperty 写路径：以新 Map 替换该 block 的属性
    propertyStore.propertiesByBlock = new Map([['a1', [makeProp('a1', 'status', 'Done')]]])
    await flushChange()

    expect(canUndo('pA')).toBe(true)
    const snap = undo('pA')!
    // 撤销回无属性状态
    expect(snap.properties['a1']).toBeUndefined()
  })
})

describe('commitNow 封口', () => {
  it('改动后不等 idle 直接封口 ⇒ 立即可撤，且到期的定时器不会重复入栈', async () => {
    const blockStore = useBlockStore()
    blockStore.blocks = [makeBlock('b1', 'p1', { content: 'a' })]
    ensureStack('p1')

    blockStore.blocks[0].content = 'b'
    await nextTick()
    expect(canUndo('p1')).toBe(false) // idle 窗口未到 ⇒ 尚未入栈

    commitNow('p1')
    expect(canUndo('p1')).toBe(true)
    expect(_debugStats().stackSizes['p1']).toBe(2)

    // 封口已取消 pending 定时器：再走完一个 idle 窗口不应压出第三条
    vi.advanceTimersByTime(50)
    await nextTick()
    expect(_debugStats().stackSizes['p1']).toBe(2)
    expect(undo('p1')?.blocks[0].content).toBe('a')
  })

  it('状态未变（当前 = 游标处快照）⇒ no-op：不增栈、不截 redo 尾', async () => {
    const blockStore = useBlockStore()
    blockStore.blocks = [makeBlock('b1', 'p1', { content: 'a' })]
    ensureStack('p1')
    blockStore.blocks[0].content = 'b'
    await flushChange() // 栈 = [a, b]，游标 1

    undo('p1')
    // 模拟 restoreEntry 把 store 回退到游标处快照：此后「当前 = 游标处」
    blockStore.blocks[0].content = 'a'
    await nextTick()

    commitNow('p1')
    expect(_debugStats().stackSizes['p1']).toBe(2) // 未新增
    expect(canRedo('p1')).toBe(true) // redo 尾未被截断 —— 连按两次 Ctrl+Z 不会吃掉重做分支
  })

  it('撤销后发生新改动并封口 ⇒ 标准 redo 清空语义', async () => {
    const blockStore = useBlockStore()
    blockStore.blocks = [makeBlock('b1', 'p1', { content: 'a' })]
    ensureStack('p1')
    blockStore.blocks[0].content = 'b'
    await flushChange()

    undo('p1')
    blockStore.blocks[0].content = 'a'
    await nextTick()

    blockStore.blocks[0].content = 'c'
    await nextTick()
    commitNow('p1')

    expect(redo('p1')).toBeNull()
    expect(_debugStats().stackSizes['p1']).toBe(2) // [a, c]
  })

  it('未建栈的页封口 ⇒ 静默 no-op（不抛错、不留下半截栈）', () => {
    expect(() => commitNow('never-visited')).not.toThrow()
    expect(_debugStats().stackSizes['never-visited']).toBeUndefined()
  })
})
