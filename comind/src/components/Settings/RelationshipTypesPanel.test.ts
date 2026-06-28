import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RelationshipTypesPanel from './RelationshipTypesPanel.vue'
import { useRelationshipTypes } from '../../composables/useRelationshipTypes'
import { getCore } from '../../core'

function mountPanel() {
  return mount(RelationshipTypesPanel, {
    global: {
      stubs: {
        ArrowUp: true,
        ArrowDown: true,
        Pencil: true,
        Trash2: true,
        Plus: true,
        ChevronDown: true,
        ChevronRight: true,
        Undo2: true,
        X: true,
        Check: true
      }
    }
  })
}

describe('RelationshipTypesPanel', () => {
  beforeEach(async () => {
    // Clean up storage first to ensure test isolation
    const core = getCore()
    const activeResult = await core.relationshipTypeService.getActive()
    for (const r of activeResult) {
      await core.relationshipTypeService.softDelete(r.id)
    }
    const allResult = await core.storage.relationshipTypes.findAll()
    for (const r of allResult.items) {
      await core.storage.relationshipTypes.delete(r.id)
    }

    const { _resetForTest, load } = useRelationshipTypes()
    _resetForTest()
    await load()
  })

  it('渲染 8 个内置关系类型', () => {
    const wrapper = mountPanel()
    const rows = wrapper.findAll('.rel-row')
    expect(rows.length).toBeGreaterThanOrEqual(8)
    expect(wrapper.text()).toContain('是一个')
    expect(wrapper.text()).toContain('依赖')
  })

  it('显示态每行有强度标记', () => {
    const wrapper = mountPanel()
    const badges = wrapper.findAll('.rel-strength-badge')
    expect(badges.length).toBeGreaterThanOrEqual(8)
    // is-a 应该是 strong
    const isARow = wrapper.findAll('.rel-row').find(r => r.text().includes('是一个'))
    expect(isARow?.find('.rel-strength-badge--strong').exists()).toBe(true)
  })

  it('点编辑切换为编辑态', async () => {
    const wrapper = mountPanel()
    const editButtons = wrapper.findAll('[title="编辑"]')
    expect(editButtons.length).toBeGreaterThan(0)
    await editButtons[0].trigger('click')
    expect(wrapper.find('.rel-row--editing').exists()).toBe(true)
    expect(wrapper.find('input[placeholder*="type"]').exists()).toBe(true)
    expect(wrapper.find('select[title="强度等级"]').exists()).toBe(true)
  })

  it('点删除出现 toast', async () => {
    const wrapper = mountPanel()
    const deleteButtons = wrapper.findAll('[title="删除"]')
    expect(deleteButtons.length).toBeGreaterThan(0)
    await deleteButtons[0].trigger('click')
    expect(wrapper.find('.rel-toast').exists()).toBe(true)
  })

  it('点 + 新增关系类型出现空编辑行', async () => {
    const wrapper = mountPanel()
    const addBtn = wrapper.find('.rel-add-btn')
    expect(addBtn.exists()).toBe(true)
    await addBtn.trigger('click')
    expect(wrapper.find('.rel-row--new').exists()).toBe(true)
  })

  it('软删的 type 不出现在主列表，但出现在"已删除"分组', async () => {
    const wrapper = mountPanel()
    const { softDelete } = useRelationshipTypes()
    await softDelete('rt_seed_is-a')
    await wrapper.vm.$nextTick()
    const rows = wrapper.findAll('.rel-row:not(.rel-row--deleted)')
    const text = rows.map(r => r.text()).join('')
    expect(text).not.toContain('是一个')
    const deletedToggle = wrapper.find('.rel-deleted-toggle')
    expect(deletedToggle.exists()).toBe(true)
    expect(deletedToggle.text()).toContain('已删除（1）')
  })
})
