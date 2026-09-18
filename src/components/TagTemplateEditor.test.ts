import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TagTemplateEditor from './TagTemplateEditor.vue'
import { useTagStore } from '../composables/useTagStore'
import type { TagFieldSpec } from '../composables/useTagStore'

vi.mock('../composables/useTagStore', () => ({ useTagStore: vi.fn() }))

const TEMPLATE: TagFieldSpec[] = [
  { key: 'author', label: '作者', type: 'string' },
  { key: 'rating', label: '评分', type: 'number' },
  { key: 'status', label: '状态', type: 'select', options: [{ id: 'reading', label: '在读' }] },
]

function mountEditor(template: TagFieldSpec[] = TEMPLATE, tagPageId = 'tag-book') {
  const setTagTemplate = vi.fn().mockResolvedValue(undefined)
  const getTagTemplate = vi.fn().mockResolvedValue(template)
  vi.mocked(useTagStore).mockReturnValue({ getTagTemplate, setTagTemplate } as any)
  const wrapper = mount(TagTemplateEditor, { props: { tagPageId } })
  return { wrapper, setTagTemplate, getTagTemplate }
}

/** 展开面板（默认折叠，避免占用标签页正文） */
async function expand(wrapper: ReturnType<typeof mountEditor>['wrapper']) {
  await wrapper.find('[data-testid="tte-toggle"]').trigger('click')
  await flushPromises()
}

/** 取最近一次落库的模板（setTagTemplate 的第二参） */
function lastPersisted(setTagTemplate: ReturnType<typeof vi.fn>): TagFieldSpec[] {
  const calls = setTagTemplate.mock.calls
  return calls[calls.length - 1][1] as TagFieldSpec[]
}

/** 就地改输入框的值并派发 change（setValue 只发 input，本组件听 change） */
async function changeValue(el: { element: Element; trigger: (e: string) => Promise<void> }, value: string) {
  ;(el.element as HTMLInputElement).value = value
  await el.trigger('change')
}

describe('TagTemplateEditor（#131 模板结构化编辑）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('挂载按 tagPageId 读模板；默认折叠、展开后按模板顺序渲染', async () => {
    const { wrapper, getTagTemplate } = mountEditor()
    await flushPromises()

    expect(getTagTemplate).toHaveBeenCalledWith('tag-book')
    // 折叠态不渲染行
    expect(wrapper.findAll('[data-testid="tte-row"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('3 个字段')

    await expand(wrapper)
    const rows = wrapper.findAll('[data-testid="tte-row"]')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('author')
    expect(rows[1].text()).toContain('rating')
    expect(rows[2].text()).toContain('status')
  })

  it('新增字段：key 唯一才可加；显示名留空回退 key；落库追加在末尾', async () => {
    const { wrapper, setTagTemplate } = mountEditor()
    await flushPromises()
    await expand(wrapper)

    // key 为空 → 按钮禁用
    expect(wrapper.find('[data-testid="tte-add"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="tte-new-key"]').setValue('publisher')
    expect(wrapper.find('[data-testid="tte-add"]').attributes('disabled')).toBeUndefined()
    await wrapper.find('[data-testid="tte-new-type"]').setValue('string')
    await wrapper.find('[data-testid="tte-add"]').trigger('click')
    await flushPromises()

    const persisted = lastPersisted(setTagTemplate)
    expect(persisted).toHaveLength(4)
    expect(persisted[3]).toEqual({ key: 'publisher', label: 'publisher', type: 'string' })
  })

  it('重复 key 不可新增（按钮禁用）', async () => {
    const { wrapper, setTagTemplate } = mountEditor()
    await flushPromises()
    await expand(wrapper)

    await wrapper.find('[data-testid="tte-new-key"]').setValue('author')
    expect(wrapper.find('[data-testid="tte-add"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="tte-add"]').trigger('click')
    await flushPromises()
    expect(setTagTemplate).not.toHaveBeenCalled()
  })

  it('删除字段：落库剩余项（key 不可变，保持顺序）', async () => {
    const { wrapper, setTagTemplate } = mountEditor()
    await flushPromises()
    await expand(wrapper)

    await wrapper.findAll('[data-testid="tte-del"]')[1].trigger('click')
    await flushPromises()

    expect(lastPersisted(setTagTemplate).map(f => f.key)).toEqual(['author', 'status'])
  })

  it('就地改显示名 → 落库更新该字段 label', async () => {
    const { wrapper, setTagTemplate } = mountEditor()
    await flushPromises()
    await expand(wrapper)

    await changeValue(wrapper.findAll('[data-testid="tte-label"]')[0], '作者名')
    await flushPromises()

    expect(lastPersisted(setTagTemplate)[0].label).toBe('作者名')
  })

  it('select 选项以逗号串编辑；切回文本类型清掉残留选项', async () => {
    const { wrapper, setTagTemplate } = mountEditor()
    await flushPromises()
    await expand(wrapper)

    // status 行（第 3 行）为 select → 显示选项输入，回显现选项
    const rows = wrapper.findAll('[data-testid="tte-row"]')
    const optionsInput = rows[2].find('[data-testid="tte-options"]')
    expect(optionsInput.exists()).toBe(true)
    expect((optionsInput.element as HTMLInputElement).value).toBe('在读')

    await changeValue(optionsInput, '在读, 已读')
    await flushPromises()
    expect(lastPersisted(setTagTemplate)[2].options).toEqual([
      { id: '在读', label: '在读' },
      { id: '已读', label: '已读' },
    ])

    // 切回文本 → 选项清除（不留在模板里）
    await rows[2].find('[data-testid="tte-type"]').setValue('string')
    await flushPromises()
    const persisted = lastPersisted(setTagTemplate)[2]
    expect(persisted.type).toBe('string')
    expect(persisted.options).toBeUndefined()
  })

  it('拖拽排序后落库新顺序', async () => {
    const { wrapper, setTagTemplate } = mountEditor()
    await flushPromises()
    await expand(wrapper)

    const vm = wrapper.vm as any
    vm.__test_setOrder(['status', 'author', 'rating'])
    await vm.onDragEnd()
    await flushPromises()

    expect(lastPersisted(setTagTemplate).map(f => f.key)).toEqual(['status', 'author', 'rating'])
  })

  it('空模板：显示空态且不因新增校验崩溃', async () => {
    const { wrapper } = mountEditor([])
    await flushPromises()
    await expand(wrapper)

    expect(wrapper.findAll('[data-testid="tte-row"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('尚无字段')
  })
})
