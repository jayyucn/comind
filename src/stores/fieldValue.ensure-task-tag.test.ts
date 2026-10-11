/**
 * ensureTaskTagMounted 写侧基准回归（防抖窗口内的正文复活 bug）
 *
 * 场景：活动块编辑器里有尚未落 store 的正文（Editor onUpdate → debouncedEmitSave
 * 300ms 防抖）。ensureTodo 的调用方（/schedule dateRef 自动打标、tags 同步自动补
 * Todo 等）在活动块上执行时：ensureTaskTagMounted 若以 store 的 block.content
 * （防抖前的旧正文，如 "/l"）为拼接基准 → 写回 "/l #任务"，编辑器里刚发生的
 * 删除/输入丢失，且 watch(props.content) 的 setContent 把旧文本顶回编辑器。
 *
 * 修复后：活动块以 activeEditor.getText()（与落库 save 同源的序列化）为基准；
 * 非活动块维持 store 兜底。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'

const hoisted = vi.hoisted(() => {
  const client = {
    saveBlockTree: vi.fn(),
    executeBatch: vi.fn(() => Promise.resolve()),
    getFieldValues: vi.fn(() => Promise.resolve([])),
    setFieldValue: vi.fn(() => Promise.resolve({})),
    getOutlinks: vi.fn(() => Promise.resolve([])),
    getDateRefsByBlock: vi.fn(() => Promise.resolve([])),
    syncPayloadForBlock: vi.fn(() => Promise.resolve()),
  }
  return { client }
})

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(hoisted.client)),
  getCoreClient: vi.fn(() => hoisted.client),
  isTauriEnvironment: vi.fn(() => false),
}))

const SYSTEM_TASK_ID = 'sys-tag-system-task'
const TASK_TAG = {
  id: SYSTEM_TASK_ID,
  title: '任务',
  field_ids: ['fd-status'],
  parent_id: null,
  description: '',
  color: '',
  is_system: true,
  created_at: 0,
  updated_at: 0,
  version: 1,
  deleted_at: null,
}

vi.mock('../stores/tags', () => ({
  useTagsStore: vi.fn(() => ({
    allTags: [TASK_TAG],
    // systemTaskTagId 判据：is_system 且有效字段含 key==='status'
    effectiveFieldDefinitions: () => [{
      id: 'fd-status',
      key: 'status',
      title: '状态',
      type: 'string',
      closed_values: null,
      default_value: null,
      hide_when: 'never',
      is_system: true,
      created_at: 0,
      updated_at: 0,
      version: 1,
      deleted_at: null,
    }],
    ensureLoaded: vi.fn(() => Promise.resolve()),
    getTagById: vi.fn(() => TASK_TAG),
  })),
}))

import { useBlockStore } from './blocks'
import { useEditorStore } from './editor'
import { useFieldValueStore } from './fieldValue'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  // 保存结果：沿用传入 block 的 id（避免触发 id 同步分支）
  hoisted.client.saveBlockTree.mockImplementation((updates: { id: string }[]) =>
    Promise.resolve([{ block: { id: updates[0].id, tags: [] }, render_segments: [] }]),
  )
  hoisted.client.setFieldValue.mockResolvedValue({})
})

/** 落一个 block，返回其 id */
async function seed(content: string): Promise<string> {
  const blockStore = useBlockStore()
  const block = await blockStore.createBlock({
    pageId: 'p1',
    content,
    pos: 1,
    type: 'bullet',
  })
  return block.id
}

/** 把某块伪造成「活动编辑中」：store 仍是旧正文，编辑器已是新正文（防抖未落库） */
function setActiveEditorText(blockId: string, text: string) {
  const editorStore = useEditorStore()
  editorStore.activeBlockId = blockId
  editorStore.activeEditor = { getText: () => text } as never
}

describe('ensureTaskTagMounted — 写侧基准 = 渲染侧（活动编辑器正文）', () => {
  it('活动块：编辑器已删空命令文本、store 仍是旧正文 "/l" → 以编辑器为基准，不复活 "/l"', async () => {
    const blockStore = useBlockStore()
    const fieldValueStore = useFieldValueStore()
    const id = await seed('/l')
    // 模拟斜杠命令执行时序：deleteRange 已清空编辑器，防抖保存尚未把 "" 落 store
    setActiveEditorText(id, '')

    await fieldValueStore.ensureTodo(id)
    await flushPromises()

    // 旧实现：block.content（"/l"）+ " #任务" → "/l #任务"（命令文本复活）
    expect(blockStore.getBlock(id)?.content).toBe('#任务')
  })

  it('活动块：以编辑器当前正文为拼接基准（编辑器有新正文时不用 store 旧正文）', async () => {
    const blockStore = useBlockStore()
    const fieldValueStore = useFieldValueStore()
    const id = await seed('/l')
    setActiveEditorText(id, 'hello')

    await fieldValueStore.ensureTodo(id)
    await flushPromises()

    expect(blockStore.getBlock(id)?.content).toBe('hello #任务')
  })

  it('非活动块：维持 store 兜底（旧正文 + " #任务"）', async () => {
    const blockStore = useBlockStore()
    const fieldValueStore = useFieldValueStore()
    const id = await seed('/l')

    await fieldValueStore.ensureTodo(id)
    await flushPromises()

    expect(blockStore.getBlock(id)?.content).toBe('/l #任务')
  })
})
