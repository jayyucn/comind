/**
 * 关系引用编辑器测试（issue T5）。
 *
 * 接缝：mock 三个数据源边界——useRelationshipTypes（关系类型清单）、
 * blocks store（块清单）、pages store（页清单）；组件逻辑全真。
 * 覆盖：mount 形态（ghost / 着色 chip / 悬空降级）、面板两段（关系类型 + 目标搜索）、
 * payload 契约（两段齐备才 emit、清除 = undefined）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import RelationRefEditor from './RelationRefEditor.vue'
import type { RelationRefValue } from '../../types/field-definition'

const hoisted = vi.hoisted(() => ({
  relTypes: [] as Array<{ id: string; type: string; label: string; color: string }>,
  blocks: [] as Array<{ id: string; pageId: string; content: string }>,
  pages: [] as Array<{ id: string; title: string }>,
}))

vi.mock('../../composables/useRelationshipTypes', () => ({
  useRelationshipTypes: () => ({
    items: ref(hoisted.relTypes),
    all: ref(hoisted.relTypes),
    load: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('../../stores/blocks', () => ({
  useBlockStore: () => ({
    blocks: hoisted.blocks,
    getBlock: (id: string) => hoisted.blocks.find((b) => b.id === id),
  }),
}))

vi.mock('../../stores/pages', () => ({
  usePageStore: () => ({
    pages: hoisted.pages,
  }),
}))

const REL_A = { id: 'rt_seed_related', type: 'related', label: '相关', color: '#1890ff' }
const REL_B = { id: 'rt_seed_parent', type: 'parent', label: '父级', color: '#52c41a' }
const PAGE = { id: 'page-1', title: '项目主页' }
const BLOCK = { id: 'blk-1', pageId: 'page-1', content: '某个块的内容' }

function mountEditor(props: Record<string, unknown> = {}) {
  return mount(RelationRefEditor, { props })
}

describe('RelationRefEditor（关系引用编辑器）', () => {
  beforeEach(() => {
    hoisted.relTypes = [REL_A, REL_B]
    hoisted.blocks = [BLOCK]
    hoisted.pages = [PAGE]
    document.body.innerHTML = ''
  })

  it('无值：渲染 ghost chip「未填」，面板不展开', () => {
    const wrapper = mountEditor()
    const trigger = wrapper.find('[data-testid="rre-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.text()).toContain('未填')
    expect(trigger.classes()).toContain('block-field-zone-chip--ghost')
    expect(document.body.querySelector('[data-testid="rre-panel"]')).toBeNull()
  })

  it('展开面板：两段齐备——关系类型清单（色点 + label）与目标候选（页/块）', async () => {
    const wrapper = mountEditor()
    await (wrapper.vm as unknown as { openPanel: () => void }).openPanel()
    await flushPromises()

    const panel = document.body.querySelector('[data-testid="rre-panel"]')
    expect(panel).not.toBeNull()

    const relOptions = document.body.querySelectorAll('[data-testid="rre-rel-option"]')
    expect(relOptions).toHaveLength(2)
    expect(relOptions[0].textContent).toContain('相关')
    expect(relOptions[0].querySelector('.rre-dot')).not.toBeNull()

    const targetOptions = document.body.querySelectorAll('[data-testid="rre-target-option"]')
    expect(targetOptions).toHaveLength(2)
    expect(targetOptions[0].textContent).toContain('项目主页')
    expect(targetOptions[1].textContent).toContain('某个块的内容')
    wrapper.unmount()
  })

  it('目标搜索：按关键词过滤候选', async () => {
    const wrapper = mountEditor()
    await (wrapper.vm as unknown as { openPanel: () => void }).openPanel()

    const search = document.body.querySelector('[data-testid="rre-search"]') as HTMLInputElement
    search.value = '主页'
    search.dispatchEvent(new Event('input'))
    await flushPromises()

    const targetOptions = document.body.querySelectorAll('[data-testid="rre-target-option"]')
    expect(targetOptions).toHaveLength(1)
    expect(targetOptions[0].textContent).toContain('项目主页')
    wrapper.unmount()
  })

  it('payload 契约：无约定关系类型时只选目标不 emit（不产半成品 payload）', async () => {
    const wrapper = mountEditor()
    await (wrapper.vm as unknown as { pickTarget: (id: string) => void }).pickTarget(PAGE.id)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('payload 契约：字段定义约定关系类型 + 选目标 → emit 完整 payload 并收起面板', async () => {
    const wrapper = mountEditor({ relationshipTypeId: REL_B.id })
    await (wrapper.vm as unknown as { pickTarget: (id: string) => void }).pickTarget(BLOCK.id)
    await flushPromises()

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toHaveLength(1)
    expect(emitted![0][0]).toEqual({ targetId: BLOCK.id, relationshipTypeId: REL_B.id })
    expect(document.body.querySelector('[data-testid="rre-panel"]')).toBeNull()
  })

  it('payload 契约：已有值后改选关系类型 → emit 新 payload（目标不变）', async () => {
    const value: RelationRefValue = { targetId: PAGE.id, relationshipTypeId: REL_A.id }
    const wrapper = mountEditor({ modelValue: value })
    await (wrapper.vm as unknown as { pickRelType: (id: string) => void }).pickRelType(REL_B.id)

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toHaveLength(1)
    expect(emitted![0][0]).toEqual({ targetId: PAGE.id, relationshipTypeId: REL_B.id })
  })

  it('payload 契约：无目标时改选关系类型 → 只挂起不 emit', async () => {
    const wrapper = mountEditor({ relationshipTypeId: REL_A.id })
    await (wrapper.vm as unknown as { pickRelType: (id: string) => void }).pickRelType(REL_B.id)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('payload 契约：先挂起关系类型再选目标 → payload 用挂起值（覆盖约定值）', async () => {
    const wrapper = mountEditor({ relationshipTypeId: REL_A.id })
    const api = wrapper.vm as unknown as { pickRelType: (id: string) => void; pickTarget: (id: string) => void }
    await api.pickRelType(REL_B.id)
    await api.pickTarget(PAGE.id)

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toHaveLength(1)
    expect(emitted![0][0]).toEqual({ targetId: PAGE.id, relationshipTypeId: REL_B.id })
  })

  it('有值：渲染按关系类型着色的链接 chip（--relation-color 变量 + relation 类）', () => {
    const value: RelationRefValue = { targetId: PAGE.id, relationshipTypeId: REL_A.id }
    const wrapper = mountEditor({ modelValue: value })
    const trigger = wrapper.find('[data-testid="rre-trigger"]')
    expect(trigger.classes()).toContain('block-field-zone-chip--relation')
    expect(trigger.classes()).not.toContain('block-field-zone-chip--dangling')
    expect(trigger.text()).toContain('项目主页')
    expect(trigger.text()).toContain('相关')
    expect(trigger.attributes('style')).toContain('--relation-color')
    expect(trigger.attributes('style')).toContain('#1890ff')
  })

  it('悬空 targetId 降级：目标不在清单 →「未知目标」+ dangling 中性类，无着色变量', () => {
    const value: RelationRefValue = { targetId: 'gone-target', relationshipTypeId: REL_A.id }
    const wrapper = mountEditor({ modelValue: value })
    const trigger = wrapper.find('[data-testid="rre-trigger"]')
    expect(trigger.classes()).toContain('block-field-zone-chip--dangling')
    expect(trigger.classes()).not.toContain('block-field-zone-chip--relation')
    expect(trigger.text()).toContain('未知目标')
    expect(trigger.attributes('style') ?? '').not.toContain('--relation-color')
  })

  it('清除 ×：emit undefined（删行语义）', async () => {
    const value: RelationRefValue = { targetId: PAGE.id, relationshipTypeId: REL_A.id }
    const wrapper = mountEditor({ modelValue: value })
    await wrapper.find('[data-testid="rre-clear"]').trigger('click')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toHaveLength(1)
    expect(emitted![0][0]).toBeUndefined()
  })
})
