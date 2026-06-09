import { describe, test, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ConceptSection from './ConceptSection.vue'

describe('ConceptSection', () => {
  test('renders label and toggle icon', () => {
    const wrapper = mount(ConceptSection, {
      props: {
        section: 'definition',
        collapsed: false,
        label: '01 · 核心定义',
        labelColor: '#D97706'
      },
      slots: {
        default: '<div class="test-content">测试内容</div>'
      }
    })
    expect(wrapper.find('.concept-section-label').text()).toContain('核心定义')
    expect(wrapper.find('.test-content').text()).toBe('测试内容')
  })

  test('emits toggle event when header is clicked', async () => {
    const wrapper = mount(ConceptSection, {
      props: {
        section: 'boundary',
        collapsed: false,
        label: '02 · 边界范围',
        labelColor: '#059669'
      }
    })
    await wrapper.find('.concept-section-header').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  test('applies collapsed class to body when collapsed is true', () => {
    const wrapper = mount(ConceptSection, {
      props: {
        section: 'comparison',
        collapsed: true,
        label: '03 · 对标辨析',
        labelColor: '#6366F1'
      }
    })
    expect(wrapper.find('.concept-section-body').classes()).toContain('collapsed')
  })

  test('does not apply collapsed class when collapsed is false', () => {
    const wrapper = mount(ConceptSection, {
      props: {
        section: 'example',
        collapsed: false,
        label: '04 · 实例与应用',
        labelColor: '#7C3AED'
      }
    })
    expect(wrapper.find('.concept-section-body').classes()).not.toContain('collapsed')
  })
})
