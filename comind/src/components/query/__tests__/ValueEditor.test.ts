import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRegistry } from '../../../core/query'
import type { FieldDescriptor, ReferenceableRecord, Registry } from '../../../core/query'
import ValueEditor from '../ValueEditor.vue'

function makeRegistry(): Registry {
  const reg = createRegistry()
  const fields: FieldDescriptor[] = [
    { key: 'title', label: '标题', type: 'text', get: () => '' },
    { key: 'title2', label: '副标题', type: 'text', get: () => '' },
    { key: 'status', label: '状态', type: 'select', get: () => '', options: [{ id: 'open', label: '进行中' }] },
  ]
  for (const f of fields) reg.register('task', f)
  return reg
}

const SOURCES: ReferenceableRecord[] = [
  { id: 'r1', title: '其他记录', entityType: 'task', fields: [{ key: 'title', label: '标题' }] },
]

describe('ValueEditor 引用值弹层', () => {
  it('引用值弹层 teleport 到 body，不被 FilterBuilder 面板 overflow 裁切', async () => {
    const reg = makeRegistry()
    const descriptor = reg.get('task', 'title')!
    const w = mount(ValueEditor, {
      props: {
        descriptor,
        op: 'contains',
        entityType: 'task',
        registry: reg,
        conditionField: 'title',
        crossRecordSources: SOURCES,
      },
      attachTo: document.body,
    })
    // 打开 + 菜单
    await w.find('.qb-ref-btn').trigger('click')
    await w.vm.$nextTick()
    // 弹层应渲染在 document.body（teleport），而非组件子树内部
    const pop = document.body.querySelector('.qb-popover')
    expect(pop).not.toBeNull()
    expect(w.element.contains(pop)).toBe(false)
    // 含「其他记录…」入口（证明菜单完整渲染，未被裁切）
    expect(pop!.textContent).toContain('其他记录')
    w.unmount()
  })
})
