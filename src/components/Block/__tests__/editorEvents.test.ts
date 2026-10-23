import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
    tagMenuVisible: ref(false),
    tagMenuPosition: ref({ x: 0, y: 0 }),
    tagMenuRange: ref({ from: 0, to: 0 }),
    tagMenuQuery: ref(''),
    tagMenuRef: ref({ confirmSelect: vi.fn(), close: vi.fn(), selectNext: vi.fn(), selectPrev: vi.fn() }),
    tagMenuAnchorEl: ref(null),
    kindSelectorVisible: ref(false),
    kindSelectorPosition: ref({ left: 0, top: 0, bottom: 0 }),
    kindSelectorRange: ref({ from: 0, to: 0 }),
    kindSelectorView: ref(null),
    relMenu: { open: vi.fn(), close: vi.fn() },
    openDateRefPanel: vi.fn(),
    closeWikiLinkMenuByEditor: vi.fn(),
    closeTagMenuByEditor: vi.fn(),
    navigateToTag: vi.fn(),
    navigateToPage: vi.fn(),
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
    const cases: { detail: Record<string, unknown>; expectArgs: unknown[] }[] = [
      { detail: { type: 'split', pos: 7 }, expectArgs: ['split', 7] },
      { detail: { type: 'delete' }, expectArgs: ['delete'] },
      { detail: { type: 'merge' }, expectArgs: ['merge'] },
      { detail: { type: 'indent' }, expectArgs: ['indent'] },
      { detail: { type: 'outdent' }, expectArgs: ['outdent'] },
      { detail: { type: 'moveUp', x: 50 }, expectArgs: ['moveUp', 50] },
      { detail: { type: 'moveDown', x: 80 }, expectArgs: ['moveDown', 80] },
      { detail: { type: 'moveLeft', x: 12 }, expectArgs: ['moveLeft', 12] },
      { detail: { type: 'moveRight', x: 34 }, expectArgs: ['moveRight', 34] },
      { detail: { type: 'exitEdit' }, expectArgs: ['exitEdit'] },
    ]
    for (const c of cases) {
      dom.dispatchEvent(new CustomEvent('enter-as-block', { detail: c.detail }))
      expect(ctx.emit).toHaveBeenCalledWith(...c.expectArgs)
    }
  })

  it('enter-as-block save 读取编辑器文本 emit', () => {
    const ctx = makeCtx({ getEditor: () => ({ getText: () => 'hello' }) as any })
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('enter-as-block', { detail: { type: 'save' } }))
    expect(ctx.emit).toHaveBeenCalledWith('save', 'hello')
  })

  /**
   * 死接线回归网（本网钉的是 `moveLeft`/`moveRight` 那一类）：事件表 `ctx.emit('x')` 的名字
   * 必须在宿主 `Editor.vue` 的 `defineEmits` 里声明，否则 Vue 只在**开发期**打一行警告，
   * 并把事件拐去 `$attrs` —— 消费方（`Block` 的 `@move-left`）永远收不到。而按键已被扩展
   * `return true` 吞掉，表现为「块首按左键没反应」，静默且难归因。生产期连警告都没有。
   */
  it('事件表 emit 的事件名都已在 Editor.vue 的 emits 中声明', () => {
    const emitNames = (source: string, re: RegExp) =>
      new Set([...source.matchAll(re)].map((m) => m[1]))
    const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

    const declared = emitNames(read('src/components/Editor.vue'), /\(e: '([\w-]+)'/g)
    const emitted = emitNames(read('src/components/Block/editorEvents.ts'), /ctx\.emit\('([\w-]+)'/g)

    expect([...emitted].length).toBeGreaterThan(0)
    expect([...emitted].filter((name) => !declared.has(name))).toEqual([])
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

  it('返回的事件表恰好覆盖 handler（含 tag 菜单）', () => {
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
      'tag-trigger',
      'tag-update',
      'tag-close',
      'tag-menu-enter',
      'tag-menu-escape',
      'tag-menu-arrowdown',
      'tag-menu-arrowup',
      'enter-as-block',
      'relationship-trigger',
      'relationship-close',
      'dateRefTrigger',
      'dateRefClick',
      'inlineTagClick',
      'wikiLinkClick',
      'dateRefKindSelect',
      'dateRefKindSelectClose',
    ])
  })

  it('tag-trigger 设置 tag 菜单状态', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    const fakeView = { coordsAtPos: () => ({ left: 10, bottom: 20 }) }
    dom.dispatchEvent(new CustomEvent('tag-trigger', {
      detail: { view: fakeView, position: 5, range: { from: 1, to: 3 }, query: 'foo' },
    }))
    expect(ctx.tagMenuVisible.value).toBe(true)
    expect(ctx.tagMenuQuery.value).toBe('foo')
    expect(ctx.tagMenuRange.value).toEqual({ from: 1, to: 3 })
    expect(ctx.tagMenuPosition.value).toEqual({ x: 10, y: 28 })
  })

  it('tag-update 更新查询', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('tag-update', { detail: { query: 'bar' } }))
    expect(ctx.tagMenuQuery.value).toBe('bar')
  })

  it('tag-close 关闭 tag 菜单并通知扩展', () => {
    const ctx = makeCtx()
    ctx.tagMenuVisible.value = true
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('tag-close', {}))
    expect(ctx.tagMenuVisible.value).toBe(false)
  })

  it('tag-menu-enter/escape/arrowdown/arrowup 委托给 tagMenuRef', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('tag-menu-enter', {}))
    dom.dispatchEvent(new CustomEvent('tag-menu-escape', {}))
    dom.dispatchEvent(new CustomEvent('tag-menu-arrowdown', {}))
    dom.dispatchEvent(new CustomEvent('tag-menu-arrowup', {}))
    expect(ctx.tagMenuRef.value?.confirmSelect).toHaveBeenCalled()
    expect(ctx.tagMenuRef.value?.close).toHaveBeenCalled()
    expect(ctx.tagMenuRef.value?.selectNext).toHaveBeenCalled()
    expect(ctx.tagMenuRef.value?.selectPrev).toHaveBeenCalled()
  })

  // ── 编辑态 inline 单元点击导航（与渲染态 handleContentClick 同口径）──

  it('inlineTagClick → navigateToTag(tagId)', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('inlineTagClick', {
      detail: { title: '项目', tagId: 't-1' },
    }))
    expect(ctx.navigateToTag).toHaveBeenCalledWith('t-1')
    expect(ctx.navigateToPage).not.toHaveBeenCalled()
  })

  it('inlineTagClick 缺 tagId → no-op（不误跳 /tags/ 空参路由）', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('inlineTagClick', { detail: { title: 'x', tagId: '' } }))
    expect(ctx.navigateToTag).not.toHaveBeenCalled()
  })

  it('wikiLinkClick → navigateToPage(page)', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('wikiLinkClick', { detail: { page: 'MyPage' } }))
    expect(ctx.navigateToPage).toHaveBeenCalledWith('MyPage')
    expect(ctx.navigateToTag).not.toHaveBeenCalled()
  })

  it('wikiLinkClick 缺 page → no-op', () => {
    const ctx = makeCtx()
    const { dom } = setup(ctx)
    dom.dispatchEvent(new CustomEvent('wikiLinkClick', { detail: { page: '' } }))
    expect(ctx.navigateToPage).not.toHaveBeenCalled()
  })
})

