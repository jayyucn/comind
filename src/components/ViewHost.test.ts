import { describe, expect, it, vi } from 'vitest'

vi.mock('./Page/index.vue', () => ({ default: { name: 'Page', props: ['pageId'], template: '<div data-stub="Page" />' } }))
vi.mock('./GraphView/GraphPage.vue', () => ({ default: { name: 'GraphPage', template: '<div data-stub="GraphPage" />' } }))
vi.mock('./TaskHub/TaskHub.vue', () => ({ default: { name: 'TaskHub', template: '<div data-stub="TaskHub" />' } }))
vi.mock('./Tags/TagsLibrary.vue', () => ({ default: { name: 'TagsLibrary', template: '<div data-stub="TagsLibrary" />' } }))
vi.mock('./Tags/TagAggregatePage.vue', () => ({ default: { name: 'TagAggregatePage', props: ['tagId'], template: '<div data-stub="TagAggregatePage" />' } }))
vi.mock('./PagesLibrary/PagesLibrary.vue', () => ({ default: { name: 'PagesLibrary', template: '<div data-stub="PagesLibrary" />' } }))
vi.mock('./Trash/TrashList.vue', () => ({ default: { name: 'TrashList', template: '<div data-stub="TrashList" />' } }))
import { shallowMount } from '@vue/test-utils'

import ViewHost from './ViewHost.vue'
import type { PaneView } from '../stores/panes'

const cases: Array<[string, PaneView, string]> = [
  ['page', { kind: 'page', ref: 'page-a' }, 'Page'],
  ['graph', { kind: 'graph' }, 'GraphPage'],
  ['tasks', { kind: 'tasks' }, 'TaskHub'],
  ['tags library', { kind: 'tags' }, 'TagsLibrary'],
  ['tag aggregate', { kind: 'tags', ref: 'tag-a' }, 'TagAggregatePage'],
  ['pages', { kind: 'pages' }, 'PagesLibrary'],
  ['trash', { kind: 'trash' }, 'TrashList'],
]

describe('ViewHost（ADR-0060 单一渲染接缝）', () => {
  it.each(cases)('%s 派发到正确目的地组件', (_name, view, component) => {
    const wrapper = shallowMount(ViewHost, {
      props: { view },
      global: {
        stubs: {
          Page: { template: '<div data-stub="Page" />' },
          GraphPage: { template: '<div data-stub="GraphPage" />' },
          TaskHub: { template: '<div data-stub="TaskHub" />' },
          TagsLibrary: { template: '<div data-stub="TagsLibrary" />' },
          TagAggregatePage: { template: '<div data-stub="TagAggregatePage" />' },
          PagesLibrary: { template: '<div data-stub="PagesLibrary" />' },
          TrashList: { template: '<div data-stub="TrashList" />' },
        },
      },
    })
    expect(wrapper.find(`[data-stub="${component}"]`).exists()).toBe(true)
    expect(wrapper.findAll('[data-stub]')).toHaveLength(1)
  })

  it('page 和 tag aggregate 传递各自 ref', () => {
    const pageWrapper = shallowMount(ViewHost, {
      props: { view: { kind: 'page', ref: 'page-a' } },
      global: { stubs: { Page: { name: 'Page', props: ['pageId'], template: '<div />' } } },
    })
    expect(pageWrapper.findComponent({ name: 'Page' }).props('pageId')).toBe('page-a')

    const tagWrapper = shallowMount(ViewHost, {
      props: { view: { kind: 'tags', ref: 'tag-a' } },
      global: { stubs: { TagAggregatePage: { name: 'TagAggregatePage', props: ['tagId'], template: '<div />' } } },
    })
    expect(tagWrapper.findComponent({ name: 'TagAggregatePage' }).props('tagId')).toBe('tag-a')
  })
})
