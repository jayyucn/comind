/**
 * 标签描述字段单测（ADR-0050 D11 身份三要素之二）。
 *
 * 这是两处挂载（标签管理页右栏 / 聚合页标题区）共用的输入原语，组件本身不持有真相，
 * 只把「用户真正改了值」这一次意图 emit 出去。父组件测试只能覆盖正常路径，
 * 下面几例专测**不该发事件**的分支（Enter→blur 去重、值未变、Esc、外部值打断）。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TagDescriptionField from './TagDescriptionField.vue'

function mountField(props: { value: string; readonly?: boolean }) {
  return mount(TagDescriptionField, { props })
}

/** 打开编辑态并返回 input 包装器。 */
async function startEdit(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('.tag-desc').trigger('click')
  return wrapper.find('input.tag-desc')
}

describe('TagDescriptionField（标签描述字段）', () => {
  it('有值时以可点按钮展示；空值时展示占位文案', () => {
    expect(mountField({ value: '与产品路线图对齐' }).find('.tag-desc').text()).toBe(
      '与产品路线图对齐',
    )

    const empty = mountField({ value: '' })
    expect(empty.find('.tag-desc').text()).toBe('添加描述')
    expect(empty.find('.tag-desc').classes()).toContain('tag-desc--empty')
  })

  it('readonly：渲染文本、无 input、点击不进入编辑态', async () => {
    const wrapper = mountField({ value: '内置定义', readonly: true })
    const desc = wrapper.find('.tag-desc')
    expect(desc.classes()).toContain('tag-desc--readonly')

    await desc.trigger('click')
    expect(wrapper.find('input.tag-desc').exists()).toBe(false)
  })

  it('readonly + 空值：什么都不渲染（不留可点占位）', () => {
    const wrapper = mountField({ value: '', readonly: true })
    expect(wrapper.find('.tag-desc').exists()).toBe(false)
  })

  it('Enter 提交：trim 后按新值落库；随后的 blur 不重复提交', async () => {
    const wrapper = mountField({ value: '旧描述' })
    const input = await startEdit(wrapper)

    await input.setValue('  新描述  ')
    await input.trigger('keydown.enter')
    // 提交后 input 已卸载；模拟浏览器在卸载前后补发的 blur
    await input.trigger('blur')

    expect(wrapper.emitted('save')).toEqual([['新描述']])
  })

  it('值未变时不 emit（不产生无意义的写与 store 重读）', async () => {
    const wrapper = mountField({ value: '描述' })
    const input = await startEdit(wrapper)

    await input.setValue('描述')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('Esc 取消：退回展示态且不 emit', async () => {
    const wrapper = mountField({ value: '旧描述' })
    const input = await startEdit(wrapper)

    await input.setValue('改了一半')
    await input.trigger('keydown.esc')

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.find('input.tag-desc').exists()).toBe(false)
    expect(wrapper.find('.tag-desc').text()).toBe('旧描述')
  })

  it('外部值变化打断编辑态（落库后 store 整体重读场景）', async () => {
    const wrapper = mountField({ value: '旧描述' })
    await startEdit(wrapper)
    expect(wrapper.find('input.tag-desc').exists()).toBe(true)

    await wrapper.setProps({ value: '别处改过的新值' })

    expect(wrapper.find('input.tag-desc').exists()).toBe(false)
    expect(wrapper.find('.tag-desc').text()).toBe('别处改过的新值')
  })

  it('清空：草稿置空后提交发空串（空串是有效值，不是「未改」）', async () => {
    const wrapper = mountField({ value: '旧描述' })
    const input = await startEdit(wrapper)

    await input.setValue('   ')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('save')).toEqual([['']])
  })
})
