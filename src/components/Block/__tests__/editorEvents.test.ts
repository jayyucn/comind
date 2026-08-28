import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { createEditorEvents, type EditorEventCtx } from '../editorEvents'

function makeCtx(overrides: Partial<EditorEventCtx> = {}): EditorEventCtx {
  return {
    emit: vi.fn(),
    getEditor: () => undefined,
    props: { blockId: 'b1' },
    menuVisible: ref(false),
    menuPosition: ref({ x: 0, y: 0 }),
    menuRange: ref({ from: 0, to: 0 }),
    menuQuery: ref(''),
    menuRef: ref({ confirmSelect: vi.fn(), close: vi.fn(), selectNext: vi.fn(), selectPrev: vi.fn() }),
    menuAnchorEl: ref(null),
    kindSelectorVisible: ref(false),
    kindSelectorPosition: ref({ left: 0, top: 0, bottom: 0 }),
    kindSelectorRange: ref({ from: 0, to: 0 }),
    kindSelectorView: ref(null),
    relMenu: { open: vi.fn(), close: vi.fn() },
    openDateRefPanel: vi.fn(),
    closeWikiLinkMenuByEditor: vi.fn(),
    ...overrides,
  }
}

/** 注册全部事件 handler 到 dom，返回 ctx 与 dom 以便逐一 dispatch 断言 */
function setup(ctx: EditorEventCtx) {
  const events = createEditorEvents(ctx)
  const dom = document.createElement('div')
  for (const [name, handler] of Object.entries(events)) {
    dom.addEventListener(name, handler)
  }
  return { events, dom }
}

describe('createEditorEvents — 声明式事件表', () => {
  it('wiki-link-trigger 设置菜单状态', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    const fakeView = { coordsAtPos: () => ({ left: 10, bottom: 20 }) }
    dom.dispatchEvent(new CustomEvent('wiki-link-trigger', {
      detail: { view: fakeView, position: 5, range: { from: 1, to: 3 }, query: 'foo' },
    }))
    expect(ctx.menuVisible.value).toBe(true)
    expect(ctx.menuQuery.value).toBe('foo')
    expect(ctx.menuRange.value).toEqual({ from: 1, to: 3 })
    expect(ctx.menuPosition.value).toEqual({ x: 10, y: 28 })
  })

  it('wiki-link-update 更新查询', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('wiki-link-update', { detail: { query: 'bar' } }))
    expect(ctx.menuQuery.value).toBe('bar')
  })

  it('wiki-link-close 关闭菜单并通知扩展', () => {
    const ctx = makeCtx()
    ctx.menuVisible.value = true
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('wiki-link-close', {}))
    expect(ctx.menuVisible.value).toBe(false)
    expect(ctx.closeWikiLinkMenuByEditor).toHaveBeenCalled()
  })

  it('wiki-link-menu-enter/escape/arrowdown/arrowup 委托给 menuRef', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('wiki-link-menu-enter', {}))
    dom.dispatchEvent(new CustomEvent('wiki-link-menu-escape', {}))
    dom.dispatchEvent(new CustomEvent('wiki-link-menu-arrowdown', {}))
    dom.dispatchEvent(new CustomEvent('wiki-link-menu-arrowup', {}))
    expect(ctx.menuRef.value?.confirmSelect).toHaveBeenCalled()
    expect(ctx.menuRef.value?.close).toHaveBeenCalled()
    expect(ctx.menuRef.value?.selectNext).toHaveBeenCalled()
    expect(ctx.menuRef.value?.selectPrev).toHaveBeenCalled()
  })

  it('enter-as-block 各类型正确 emit', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    const types: [string, string, unknown?][] = [
      ['split', 'split', 7],
      ['delete', 'delete'],
      ['merge', 'merge'],
      ['indent', 'indent'],
      ['outdent', 'outdent'],
      ['moveUp', 'moveUp'],
      ['moveDown', 'moveDown'],
      ['exitEdit', 'exitEdit'],
    ]
    for (const [detailType, emitName, arg] of types) {
      dom.dispatchEvent(new CustomEvent('enter-as-block', { detail: { type: detailType, pos: arg } }))
      if (arg !== undefined) {
        expect(ctx.emit).toHaveBeenCalledWith(emitName, arg)
      } else {
        expect(ctx.emit).toHaveBeenCalledWith(emitName)
      }
    }
  })

  it('enter-as-block save 读取编辑器文本 emit', () => {
    const ctx = makeCtx({ getEditor: () => ({ getText: () => 'hello' }) as any })
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('enter-as-block', { detail: { type: 'save' } }))
    expect(ctx.emit).toHaveBeenCalledWith('save', 'hello')
  })

  it('relationship-trigger 打开关系菜单并传入 onSelect', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    const fakeView = { coordsAtPos: () => ({ left: 1, bottom: 2 }) }
    dom.dispatchEvent(new CustomEvent('relationship-trigger', {
      detail: { view: fakeView, position: 3, range: { from: 0, to: 2 }, relationshipType: '' },
    }))
    expect(ctx.relMenu.open).toHaveBeenCalledTimes(1)
    const opts = (ctx.relMenu.open as any).mock.calls[0][0]
    expect(opts.position).toEqual({ x: 1, y: 8 })
    expect(typeof opts.onSelect).toBe('function')
  })

  it('relationship-close 关闭关系菜单', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('relationship-close', {}))
    expect(ctx.relMenu.close).toHaveBeenCalled()
  })

  it('dateRefTrigger 打开面板并解析 blockId', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    const fakeView = {
      coordsAtPos: () => ({ left: 5, bottom: 6 }),
      // 文本节点(nodeType 3) → handler 会取其 parentElement 再 closest('[data-block-id]')
      domAtPos: () => ({ node: { nodeType: 3, parentElement: { closest: () => ({ dataset: { blockId: 'x' } }) } } }),
    }
    dom.dispatchEvent(new CustomEvent('dateRefTrigger', {
      detail: { view: fakeView, position: 4, range: { from: 1, to: 2 }, kind: 'schedule' },
    }))
    expect(ctx.openDateRefPanel).toHaveBeenCalledTimes(1)
    const [cfg, source] = (ctx.openDateRefPanel as any).mock.calls[0]
    expect(cfg.blockId).toBe('x')
    expect(cfg.kind).toBe('schedule')
    expect(source).toBe('editor')
  })

  it('dateRefClick 用 payload 打开面板（blockId 来自 props）', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('dateRefClick', {
      detail: { from: 1, to: 2, kind: 'deadline', iso: '2026-01-01', recurrence: 'none', leadMinutes: 0 },
    }))
    expect(ctx.openDateRefPanel).toHaveBeenCalledTimes(1)
    const [cfg, source] = (ctx.openDateRefPanel as any).mock.calls[0]
    expect(cfg.blockId).toBe('b1')
    expect(cfg.kind).toBe('deadline')
    expect(source).toBe('editor')
  })

  it('dateRefKindSelect 设置 kind 选择器状态', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('dateRefKindSelect', {
      detail: { view: {}, range: { from: 1, to: 2 }, coords: { left: 3, top: 4, bottom: 5 } },
    }))
    expect(ctx.kindSelectorVisible.value).toBe(true)
    expect(ctx.kindSelectorRange.value).toEqual({ from: 1, to: 2 })
    expect(ctx.kindSelectorPosition.value).toEqual({ left: 3, top: 4, bottom: 5 })
  })

  it('dateRefKindSelectClose 关闭 kind 选择器', () => {
    const ctx = makeCtx()
    ctx.kindSelectorVisible.value = true
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('dateRefKindSelectClose', {}))
    expect(ctx.kindSelectorVisible.value).toBe(false)
  })

  it('返回的事件表恰好覆盖 14 个 handler', () => {
    const ctx = makeCtx()
    const events = createEditorEvents(ctx)
    expect(Object.keys(events)).toEqual([
      'wiki-link-trigger',
      'wiki-link-update',
      'wiki-link-close',
      'wiki-link-menu-enter',
      'wiki-link-menu-escape',
      'wiki-link-menu-arrowdown',
      'wiki-link-menu-arrowup',
      'enter-as-block',
      'relationship-trigger',
      'relationship-close',
      'dateRefTrigger',
      'dateRefClick',
      'dateRefKindSelect',
      'dateRefKindSelectClose',
    ])
  })
})
