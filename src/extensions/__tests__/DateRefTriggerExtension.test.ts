import { describe, it, expect, beforeEach } from 'vitest'
import { DateRefTriggerExtension, closeDateRefMenu } from '../DateRefTriggerExtension'

// 派发侧测试：验证 DateRefTriggerExtension 在 view.dom 上正确 dispatch
// dateRefTrigger / dateRefKindSelect，并验证删除死事件 dateRefTriggerClose 后不再派发。

function makeDoc(text: string, cursorPos: number) {
  const doc = {
    text,
    descendants: (cb: (node: any, pos: number) => void) => {
      cb({ isText: true, text }, 0)
    },
    textBetween: (a: number, b: number) => text.slice(a, b),
  }
  return doc
}

function makeView(text: string, cursorPos: number) {
  const dom = document.createElement('div')
  const log: { name: string; detail: any }[] = []
  for (const name of ['dateRefTrigger', 'dateRefKindSelect', 'dateRefTriggerClose', 'dateRefKindSelectClose']) {
    dom.addEventListener(name, (e: Event) => log.push({ name, detail: (e as CustomEvent).detail }))
  }
  const view: any = {
    dom,
    state: { doc: makeDoc(text, cursorPos), selection: { from: cursorPos } },
    coordsAtPos: () => ({ left: 1, top: 2, bottom: 3 }),
  }
  const prevState = { doc: makeDoc('__different__', 0) }
  return { view, prevState, log }
}

const plugins = DateRefTriggerExtension.config.addProseMirrorPlugins()
const plugin: any = plugins[0]
const handleKeyDown = plugin.spec.props.handleKeyDown
const viewFactory = plugin.spec.view

function openMenu(view: any) {
  // 输入 '@' 把模块级 menuIsOpen 置 true
  handleKeyDown(view, { key: '@' })
}

describe('DateRefTriggerExtension — 派发侧', () => {
  beforeEach(() => {
    closeDateRefMenu()
  })

  it('@ 后跟数字 → 派发 dateRefTrigger（带 range/kind），不派发死事件 dateRefTriggerClose', () => {
    const { view, prevState, log } = makeView('x @2026', 7)
    openMenu(view)
    viewFactory().update(view, prevState)
    expect(log).toEqual([
      {
        name: 'dateRefTrigger',
        detail: { view, position: 7, range: { from: 2, to: 7 }, kind: 'ref' },
      },
    ])
  })

  it('仅 @ → 派发 dateRefKindSelect（带 coords）', () => {
    const { view, prevState, log } = makeView('x @', 3)
    openMenu(view)
    viewFactory().update(view, prevState)
    expect(log).toEqual([
      {
        name: 'dateRefKindSelect',
        detail: { view, range: { from: 2, to: 3 }, coords: { left: 1, top: 2, bottom: 3 } },
      },
    ])
  })

  it('Escape 仅派发 dateRefKindSelectClose，不再派发已删除的 dateRefTriggerClose', () => {
    const { view, log } = makeView('x @', 3)
    openMenu(view)
    handleKeyDown(view, { key: 'Escape' })
    expect(log).toEqual([{ name: 'dateRefKindSelectClose', detail: null }])
    expect(log.find((e) => e.name === 'dateRefTriggerClose')).toBeUndefined()
  })

  it('menuIsOpen 未开时 update 不派发任何事件', () => {
    const { view, prevState, log } = makeView('x @2026', 7)
    // 未 openMenu
    viewFactory().update(view, prevState)
    expect(log).toEqual([])
  })
})
