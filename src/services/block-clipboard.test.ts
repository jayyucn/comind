import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  COMIND_BLOCK_MIME,
  deserializeClipboardBlocks,
  payloadToPlainText,
  serializeBlocks,
  writeClipboardPayload,
} from './block-clipboard'
import type { Block, BlockClipPayload, BlockClipboardPayload } from '../types/block'

const PAGE_ID = 'page-1'

function mk(
  id: string,
  content: string,
  opts: { type?: Block['type']; format?: Record<string, unknown> | null } = {}
): Block {
  return {
    id,
    pageId: PAGE_ID,
    parentId: null,
    pos: 0,
    content,
    format: (opts.format === undefined ? {} : opts.format) as Record<string, unknown>,
    type: opts.type ?? 'bullet',
    createdAt: 0,
    updatedAt: 0,
  }
}

type PropsRecord = Record<string, { value: string; type: string }>

/** 注入替身：children 按 id 查表；properties 按 id 查表（缺省 null） */
function resolvers(childrenOf: Record<string, Block[]> = {}, props: Record<string, PropsRecord> = {}) {
  return {
    resolveChildren: (b: Block) => childrenOf[b.id] ?? [],
    resolveProperties: (b: Block) => props[b.id] ?? null,
  }
}

function contents(nodes: BlockClipPayload[]): string[] {
  const out: string[] = []
  const walk = (list: BlockClipPayload[]) => {
    for (const n of list) {
      out.push(n.content)
      walk(n.children)
    }
  }
  walk(nodes)
  return out
}

describe('serializeBlocks — 内部剪贴板载荷序列化', () => {
  test('顶层载荷形状（version/kind/blocks）与节点字段', () => {
    const payload = serializeBlocks([mk('a', '内容一', { type: 'code' })], resolvers())

    expect(payload.version).toBe(1)
    expect(payload.kind).toBe('blocks')
    expect(payload.blocks).toHaveLength(1)
    expect(payload.blocks[0]).toEqual({
      id: 'a',
      content: '内容一',
      type: 'code',
      format: {},
      properties: null,
      children: [],
    })
  })

  test('子树完整递归（折叠只是视图状态）', () => {
    const parent = mk('p', '父')
    const grandchild = mk('g', '孙')
    const child = mk('c', '子')
    const payload = serializeBlocks(
      [parent],
      resolvers({ p: [child], c: [grandchild] })
    )

    expect(payload.blocks).toHaveLength(1)
    expect(contents(payload.blocks)).toEqual(['父', '子', '孙'])
    expect(payload.blocks[0].children[0].children[0].content).toBe('孙')
  })

  test('format 为 null 时载荷为 null；非空时拷贝一份（不共享引用）', () => {
    const noFormat = mk('x', 'x', { format: null })
    expect(serializeBlocks([noFormat], resolvers()).blocks[0].format).toBeNull()

    const fmt: Record<string, unknown> = { collapsed: true }
    const node = serializeBlocks([mk('y', 'y', { format: fmt })], resolvers()).blocks[0]
    expect(node.format).toEqual({ collapsed: true })
    expect(node.format).not.toBe(fmt)
  })

  test('properties 由注入解析器提供，缺省为 null', () => {
    const props: Record<string, PropsRecord> = {
      a: { status: { value: 'Todo', type: 'string' } },
    }
    const payload = serializeBlocks([mk('a', '带属性'), mk('b', '无属性')], resolvers({}, props))

    expect(payload.blocks[0].properties).toEqual({ status: { value: 'Todo', type: 'string' } })
    expect(payload.blocks[1].properties).toBeNull()
  })

  test('空根列表 → 空 blocks', () => {
    expect(serializeBlocks([], resolvers()).blocks).toEqual([])
  })
})

describe('payloadToPlainText — text/plain 缩进兜底', () => {
  test('按深度 2 空格缩进、换行连接', () => {
    const payload = serializeBlocks([mk('p', '父')], resolvers({ p: [mk('c', '子')] }))
    expect(payloadToPlainText(payload)).toBe('父\n  子')
  })

  test('空载荷 → 空串', () => {
    const empty: BlockClipboardPayload = { version: 1, kind: 'blocks', blocks: [] }
    expect(payloadToPlainText(empty)).toBe('')
  })
})

describe('deserializeClipboardBlocks — 内部 MIME 反序列化', () => {
  test('往返：serialize → JSON → deserialize 还原载荷森林', () => {
    const payload = serializeBlocks(
      [mk('p', '父'), mk('s', '平级')],
      resolvers({ p: [mk('c', '子', { type: 'code' })] }, { p: { k: { value: 'v', type: 'string' } } })
    )

    const forest = deserializeClipboardBlocks(JSON.stringify(payload))

    expect(forest).toEqual(payload.blocks)
    expect(forest![0].children[0].content).toBe('子')
    expect(forest![0].properties).toEqual({ k: { value: 'v', type: 'string' } })
  })

  test('JSON 损坏 → null', () => {
    expect(deserializeClipboardBlocks('{broken json')).toBeNull()
  })

  test('空串 → null', () => {
    expect(deserializeClipboardBlocks('')).toBeNull()
  })

  test('kind 不符 → null', () => {
    expect(deserializeClipboardBlocks(JSON.stringify({ version: 1, kind: 'other', blocks: [] }))).toBeNull()
  })

  test('形状合法即解析（不额外要求 version，与既有行为一致）', () => {
    expect(deserializeClipboardBlocks(JSON.stringify({ version: 2, kind: 'blocks', blocks: [] }))).toEqual([])
  })

  test('blocks 非数组 → null', () => {
    expect(deserializeClipboardBlocks(JSON.stringify({ version: 1, kind: 'blocks', blocks: {} }))).toBeNull()
  })
})

describe('writeClipboardPayload — 落盘与降级链', () => {
  let writeMock: ReturnType<typeof vi.fn>
  let writeTextMock: ReturnType<typeof vi.fn>

  const payload: BlockClipboardPayload = {
    version: 1,
    kind: 'blocks',
    blocks: [{ content: '块', type: 'bullet', format: null, properties: null, children: [] }],
  }

  beforeEach(() => {
    writeMock = vi.fn().mockResolvedValue(undefined)
    writeTextMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      clipboard: { write: writeMock, writeText: writeTextMock },
    })
    vi.stubGlobal('ClipboardItem', class {
      items: Record<string, Blob>
      constructor(items: Record<string, Blob>) {
        this.items = items
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function writtenItem() {
    return writeMock.mock.calls[0][0][0] as { items: Record<string, Blob> }
  }

  test('双 MIME 写入：自定义 MIME JSON 载荷 + text/plain 缩进兜底', async () => {
    await writeClipboardPayload(payload)

    expect(writeMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(await writtenItem().items[COMIND_BLOCK_MIME].text())).toEqual(payload)
    expect(await writtenItem().items['text/plain'].text()).toBe('块')
  })

  test('clipboard.write 失败 → 降级为 writeText（仅纯文本）', async () => {
    writeMock.mockRejectedValue(new Error('write failed'))

    await writeClipboardPayload(payload)

    expect(writeTextMock).toHaveBeenCalledWith('块')
  })

  test('write 与 writeText 均失败 → execCommand 兜底', async () => {
    writeMock.mockRejectedValue(new Error('write failed'))
    writeTextMock.mockRejectedValue(new Error('writeText failed'))
    const execCommand = vi.fn()
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue({ value: '', style: {}, select: vi.fn() }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand,
    })

    await writeClipboardPayload(payload)

    expect(execCommand).toHaveBeenCalledWith('copy')
  })
})
