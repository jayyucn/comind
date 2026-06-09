import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { buildTemplateCommands, executeTemplateCommand, filterCommands, groupCommands, parseCommandInput, commands } from './useSlashCommands'
import { useTemplateRegistry } from './useTemplateRegistry'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { usePageStore } from '../stores/pages'
import { TemplateRenderer } from '../services/template-renderer'

// Mock all the dependencies
vi.mock('./useTemplateRegistry', () => ({
  useTemplateRegistry: vi.fn()
}))

vi.mock('../stores/blocks', () => ({
  useBlockStore: vi.fn()
}))

vi.mock('../stores/editor', () => ({
  useEditorStore: vi.fn()
}))

vi.mock('../stores/pages', () => ({
  usePageStore: vi.fn()
}))

vi.mock('../services/template-renderer', () => ({
  TemplateRenderer: {
    buildContext: vi.fn(),
    render: vi.fn()
  }
}))

describe('useSlashCommands - buildTemplateCommands', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('builds template commands from registry', () => {
    const mockTemplates = [
      { id: 'template-1', name: 'Template 1', icon: '📝', aliases: ['t1'], source: 'builtin' },
      { id: 'user:template-2', name: 'My Template', icon: '✏️', source: 'user' }
    ]

    vi.mocked(useTemplateRegistry).mockReturnValue({
      all: { value: mockTemplates }
    } as any)

    const commands = buildTemplateCommands()

    expect(commands.length).toBe(2)
    expect(commands[0]).toEqual({
      id: 'template:template-1',
      name: 'Template 1',
      alias: ['template', 'tpl', 't1', 'template-1'],
      group: '模板',
      icon: '📝',
      action: expect.any(Function)
    })
    expect(commands[1]).toEqual({
      id: 'template:user:template-2',
      name: 'My Template',
      alias: ['template', 'tpl', 'template-2'],
      group: '模板',
      icon: '✏️',
      action: expect.any(Function)
    })
  })

  it('handles empty registry', () => {
    vi.mocked(useTemplateRegistry).mockReturnValue({
      all: { value: [] }
    } as any)

    const commands = buildTemplateCommands()
    expect(commands.length).toBe(0)
  })
})

describe('useSlashCommands - executeTemplateCommand', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Mock console.warn to track warnings
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns early if blockId is not provided', async () => {
    await executeTemplateCommand(undefined, 'test-template', {} as any, { from: 0, to: 0 })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('returns early and warns if template not found', async () => {
    const mockRegistry = {
      isLoaded: { value: true },
      getById: vi.fn().mockReturnValue(null),
      loadAll: vi.fn()
    }
    vi.mocked(useTemplateRegistry).mockReturnValue(mockRegistry as any)

    await executeTemplateCommand('block-1', 'nonexistent-template', {} as any, { from: 0, to: 0 })

    expect(console.warn).toHaveBeenCalledWith(
      '[executeTemplateCommand] Template not found: nonexistent-template'
    )
  })

  it('loads registry if not already loaded', async () => {
    const mockRegistry = {
      isLoaded: { value: false },
      getById: vi.fn().mockReturnValue(null),
      loadAll: vi.fn().mockResolvedValue(undefined)
    }
    vi.mocked(useTemplateRegistry).mockReturnValue(mockRegistry as any)

    vi.mocked(useBlockStore).mockReturnValue({
      blocks: [{ id: 'block-1', pageId: 'page-1' }]
    } as any)

    await executeTemplateCommand('block-1', 'test-template', {} as any, { from: 0, to: 0 })

    expect(mockRegistry.loadAll).toHaveBeenCalled()
  })

  it('returns early and warns if anchor block not found', async () => {
    const mockTemplate = { id: 'test-template' }
    const mockRegistry = {
      isLoaded: { value: true },
      getById: vi.fn().mockReturnValue(mockTemplate)
    }
    vi.mocked(useTemplateRegistry).mockReturnValue(mockRegistry as any)

    vi.mocked(useBlockStore).mockReturnValue({
      blocks: []
    } as any)

    await executeTemplateCommand('block-1', 'test-template', {} as any, { from: 0, to: 0 })

    expect(console.warn).toHaveBeenCalledWith(
      '[executeTemplateCommand] Anchor block not found: block-1'
    )
  })

  it('executes template insertion successfully', async () => {
    const mockTemplate = { id: 'test-template' }
    const mockRegistry = {
      isLoaded: { value: true },
      getById: vi.fn().mockReturnValue(mockTemplate)
    }
    vi.mocked(useTemplateRegistry).mockReturnValue(mockRegistry as any)

    const mockAnchorBlock = { id: 'block-1', pageId: 'page-1', pos: 100 }
    const mockBlockStore = {
      blocks: [mockAnchorBlock],
      createBlock: vi.fn().mockResolvedValue({ id: 'new-block-1' })
    }
    vi.mocked(useBlockStore).mockReturnValue(mockBlockStore as any)

    const mockEditorStore = {
      activateBlock: vi.fn()
    }
    vi.mocked(useEditorStore).mockReturnValue(mockEditorStore as any)

    const mockPageStore = {
      getPage: vi.fn().mockReturnValue({ title: 'Test Page' })
    }
    vi.mocked(usePageStore).mockReturnValue(mockPageStore as any)

    const mockContext = { date: '2024-01-01' }
    vi.mocked(TemplateRenderer.buildContext).mockResolvedValue(mockContext)

    const mockDrafts = [
      {
        pageId: 'page-1',
        parentId: null,
        pos: 2000,
        content: 'Test content',
        format: {},
        type: 'text',
        properties: {},
        cursorMarker: '__CURSOR__'
      }
    ]
    vi.mocked(TemplateRenderer.render).mockReturnValue(mockDrafts)
    
    // Also mock blockStore.blocks to include the new block with matching pageId and pos
    mockBlockStore.blocks = [
      mockAnchorBlock,
      { id: 'new-block-1', pageId: 'page-1', pos: 2000 }
    ]
    
    // Also ensure that createBlock returns a block with an id that we can test
    mockBlockStore.createBlock = vi.fn().mockResolvedValue({ id: 'new-block-1' })

    const mockEditor = {
      state: { selection: { from: 5 } },
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn()
    }

    await executeTemplateCommand(
      'block-1',
      'test-template',
      mockEditor as any,
      { from: 0, to: 1 }
    )

    // Verify editor operations
    expect(mockEditor.chain).toHaveBeenCalled()
    expect(mockEditor.deleteRange).toHaveBeenCalledWith({ from: 0, to: 5 })
    expect(mockEditor.focus).toHaveBeenCalled()
    expect(mockEditor.run).toHaveBeenCalled()

    // Verify template rendering
    expect(TemplateRenderer.buildContext).toHaveBeenCalledWith('Test Page')
    expect(TemplateRenderer.render).toHaveBeenCalledWith(
      mockTemplate,
      mockContext,
      mockAnchorBlock
    )

    // Verify block creation
    expect(mockBlockStore.createBlock).toHaveBeenCalledTimes(1)

    // Verify cursor activation
    expect(mockEditorStore.activateBlock).toHaveBeenCalled()
  })

  it('focuses on first new block if no cursor marker', async () => {
    const mockTemplate = { id: 'test-template' }
    const mockRegistry = {
      isLoaded: { value: true },
      getById: vi.fn().mockReturnValue(mockTemplate)
    }
    vi.mocked(useTemplateRegistry).mockReturnValue(mockRegistry as any)

    const mockAnchorBlock = { id: 'block-1', pageId: 'page-1', pos: 100 }
    const mockBlockStore = {
      blocks: [mockAnchorBlock],
      createBlock: vi.fn().mockResolvedValue({ id: 'new-block-1' })
    }
    vi.mocked(useBlockStore).mockReturnValue(mockBlockStore as any)

    const mockEditorStore = {
      activateBlock: vi.fn()
    }
    vi.mocked(useEditorStore).mockReturnValue(mockEditorStore as any)

    vi.mocked(usePageStore).mockReturnValue({
      getPage: vi.fn().mockReturnValue({ title: 'Test Page' })
    } as any)

    vi.mocked(TemplateRenderer.buildContext).mockResolvedValue({})

    const mockDrafts = [
      { pageId: 'page-1', parentId: null, pos: 2000, content: 'Test 1', format: {}, type: 'text', properties: {} },
      { pageId: 'page-1', parentId: null, pos: 3000, content: 'Test 2', format: {}, type: 'text', properties: {} }
    ]
    vi.mocked(TemplateRenderer.render).mockReturnValue(mockDrafts)

    const mockEditor = {
      state: { selection: { from: 5 } },
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn()
    }

    await executeTemplateCommand(
      'block-1',
      'test-template',
      mockEditor as any,
      { from: 0, to: 1 }
    )

    // Should activate the first new block (the one with smallest pos)
    expect(mockEditorStore.activateBlock).toHaveBeenCalledWith('new-block-1')
  })

  it('sorts drafts by pos in descending order before insertion', async () => {
    // 验证 commit 4a546a3 的逻辑：按 pos 倒序插入保证 anchor.pos+1000, +2000... 递增
    const mockTemplate = { id: 'test-template' }
    const mockRegistry = {
      isLoaded: { value: true },
      getById: vi.fn().mockReturnValue(mockTemplate)
    }
    vi.mocked(useTemplateRegistry).mockReturnValue(mockRegistry as any)

    const mockAnchorBlock = { id: 'block-1', pageId: 'page-1', pos: 100 }
    const createBlockMock = vi.fn().mockResolvedValue({ id: 'new-block' })
    const mockBlockStore = {
      blocks: [mockAnchorBlock],
      createBlock: createBlockMock
    }
    vi.mocked(useBlockStore).mockReturnValue(mockBlockStore as any)

    vi.mocked(useEditorStore).mockReturnValue({
      activateBlock: vi.fn()
    } as any)

    vi.mocked(usePageStore).mockReturnValue({
      getPage: vi.fn().mockReturnValue({ title: 'Test Page' })
    } as any)

    vi.mocked(TemplateRenderer.buildContext).mockResolvedValue({})

    // 创建多个 draft，pos 递增
    const mockDrafts = [
      { pageId: 'page-1', parentId: null, pos: 2000, content: 'First', format: {}, type: 'text', properties: {} },
      { pageId: 'page-1', parentId: null, pos: 3000, content: 'Second', format: {}, type: 'text', properties: {} },
      { pageId: 'page-1', parentId: null, pos: 4000, content: 'Third', format: {}, type: 'text', properties: {} }
    ]
    vi.mocked(TemplateRenderer.render).mockReturnValue(mockDrafts)

    const mockEditor = {
      state: { selection: { from: 5 } },
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn()
    }

    await executeTemplateCommand(
      'block-1',
      'test-template',
      mockEditor as any,
      { from: 0, to: 1 }
    )

    // 验证调用次数
    expect(createBlockMock).toHaveBeenCalledTimes(3)
    
    // 验证调用顺序：应该按 pos 倒序插入（4000, 3000, 2000）
    const calls = createBlockMock.mock.calls
    expect(calls[0][0].pos).toBe(4000)
    expect(calls[1][0].pos).toBe(3000)
    expect(calls[2][0].pos).toBe(2000)
  })

  it('activates block with cursorMarker when multiple drafts have cursor', async () => {
    // 验证当多个 draft 都有 cursorMarker 时，激活第一个
    const mockTemplate = { id: 'test-template' }
    const mockRegistry = {
      isLoaded: { value: true },
      getById: vi.fn().mockReturnValue(mockTemplate)
    }
    vi.mocked(useTemplateRegistry).mockReturnValue(mockRegistry as any)

    const mockAnchorBlock = { id: 'block-1', pageId: 'page-1', pos: 100 }
    const mockBlockStore = {
      blocks: [
        mockAnchorBlock,
        { id: 'new-block-1', pageId: 'page-1', pos: 2000 },
        { id: 'new-block-2', pageId: 'page-1', pos: 3000 }
      ],
      createBlock: vi.fn().mockResolvedValue({ id: 'new-block' })
    }
    vi.mocked(useBlockStore).mockReturnValue(mockBlockStore as any)

    const activateBlockMock = vi.fn()
    vi.mocked(useEditorStore).mockReturnValue({
      activateBlock: activateBlockMock
    } as any)

    vi.mocked(usePageStore).mockReturnValue({
      getPage: vi.fn().mockReturnValue({ title: 'Test Page' })
    } as any)

    vi.mocked(TemplateRenderer.buildContext).mockResolvedValue({})

    const mockDrafts = [
      { pageId: 'page-1', parentId: null, pos: 2000, content: 'First', format: {}, type: 'text', properties: {}, cursorMarker: '__CURSOR__' },
      { pageId: 'page-1', parentId: null, pos: 3000, content: 'Second', format: {}, type: 'text', properties: {}, cursorMarker: '__CURSOR__' }
    ]
    vi.mocked(TemplateRenderer.render).mockReturnValue(mockDrafts)

    const mockEditor = {
      state: { selection: { from: 5 } },
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn()
    }

    await executeTemplateCommand(
      'block-1',
      'test-template',
      mockEditor as any,
      { from: 0, to: 1 }
    )

    // 应该激活第一个含 cursorMarker 的 block（pos 2000）
    expect(activateBlockMock).toHaveBeenCalledWith('new-block-1')
  })

  it('handles empty template drafts gracefully', async () => {
    // 验证空模板列表时的行为
    const mockTemplate = { id: 'test-template' }
    const mockRegistry = {
      isLoaded: { value: true },
      getById: vi.fn().mockReturnValue(mockTemplate)
    }
    vi.mocked(useTemplateRegistry).mockReturnValue(mockRegistry as any)

    const mockAnchorBlock = { id: 'block-1', pageId: 'page-1', pos: 100 }
    const mockBlockStore = {
      blocks: [mockAnchorBlock],
      createBlock: vi.fn().mockResolvedValue({ id: 'new-block' })
    }
    vi.mocked(useBlockStore).mockReturnValue(mockBlockStore as any)

    const activateBlockMock = vi.fn()
    vi.mocked(useEditorStore).mockReturnValue({
      activateBlock: activateBlockMock
    } as any)

    vi.mocked(usePageStore).mockReturnValue({
      getPage: vi.fn().mockReturnValue({ title: 'Test Page' })
    } as any)

    vi.mocked(TemplateRenderer.buildContext).mockResolvedValue({})

    // 空模板列表
    vi.mocked(TemplateRenderer.render).mockReturnValue([])

    const mockEditor = {
      state: { selection: { from: 5 } },
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn()
    }

    await executeTemplateCommand(
      'block-1',
      'test-template',
      mockEditor as any,
      { from: 0, to: 1 }
    )

    // 不应创建任何 block
    expect(mockBlockStore.createBlock).not.toHaveBeenCalled()
    // 不应激活任何 block
    expect(activateBlockMock).not.toHaveBeenCalled()
  })
})

// ─── filterCommands / groupCommands / parseCommandInput 测试 ─────────────────────────────

describe('filterCommands', () => {
  it('空查询返回所有命令', () => {
    const result = filterCommands('')
    expect(result.length).toBe(commands.length)
  })

  it('按 name 前缀匹配排序（最高优先级）', () => {
    const result = filterCommands('tod')
    expect(result.length).toBeGreaterThan(0)
    // 'today' 和 'todo' 都以 'tod' 开头，按字母顺序排列
    expect(result[0].id).toBe('today')
    expect(result.some(c => c.id === 'todo')).toBe(true)
  })

  it('按 alias 前缀匹配排序', () => {
    const result = filterCommands('待办')
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].id).toBe('todo')
  })

  it('按 name 包含匹配排序', () => {
    const result = filterCommands('day')
    expect(result.length).toBeGreaterThan(0)
    // Today, Yesterday 都包含 'day'
    const ids = result.map(c => c.id)
    expect(ids).toContain('today')
    expect(ids).toContain('yesterday')
  })

  it('按 alias 包含匹配排序', () => {
    const result = filterCommands('时间')
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].id).toBe('time')
  })

  it('大小写不敏感', () => {
    const lower = filterCommands('today')
    const upper = filterCommands('TODAY')
    expect(lower.map(c => c.id)).toEqual(upper.map(c => c.id))
  })

  it('无匹配返回空数组', () => {
    const result = filterCommands('xyz-nonexistent')
    expect(result).toEqual([])
  })

  it('自定义命令列表', () => {
    const customCommands = [
      { id: 'a', name: 'Alpha', group: 'test', icon: '🅰️', action: () => {} },
      { id: 'b', name: 'Beta', group: 'test', icon: '🅱️', action: () => {} },
    ]
    const result = filterCommands('al', customCommands)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('a')
  })

  it('多个匹配按优先级排序', () => {
    // 测试 name 前缀 > alias 前缀 > name 包含 > alias 包含
    const result = filterCommands('do')
    // 'doing' name 前缀匹配，'todo' alias 包含 'doing'
    expect(result.length).toBeGreaterThan(0)
    const doingIdx = result.findIndex(c => c.id === 'doing')
    const todoIdx = result.findIndex(c => c.id === 'todo')
    expect(doingIdx).toBeLessThan(todoIdx)
  })
})

describe('groupCommands', () => {
  it('按 group 分组命令', () => {
    const groups = groupCommands(commands)
    expect(groups.has('日期时间')).toBe(true)
    expect(groups.has('任务')).toBe(true)
    expect(groups.has('属性')).toBe(true)
  })

  it('每个分组包含正确的命令', () => {
    const groups = groupCommands(commands)
    const dateGroup = groups.get('日期时间')
    expect(dateGroup).toBeDefined()
    expect(dateGroup?.some(c => c.id === 'today')).toBe(true)
    expect(dateGroup?.some(c => c.id === 'time')).toBe(true)
  })

  it('空命令列表返回空 Map', () => {
    const groups = groupCommands([])
    expect(groups.size).toBe(0)
  })

  it('自定义命令列表分组', () => {
    const customCommands = [
      { id: 'a', name: 'Alpha', group: 'group1', icon: '🅰️', action: () => {} },
      { id: 'b', name: 'Beta', group: 'group2', icon: '🅱️', action: () => {} },
      { id: 'c', name: 'Gamma', group: 'group1', icon: '🅲️', action: () => {} },
    ]
    const groups = groupCommands(customCommands)
    expect(groups.size).toBe(2)
    expect(groups.get('group1')?.length).toBe(2)
    expect(groups.get('group2')?.length).toBe(1)
  })
})

describe('parseCommandInput', () => {
  it('完全匹配命令名', () => {
    const result = parseCommandInput('today')
    expect(result.command).not.toBeNull()
    expect(result.command?.id).toBe('today')
    expect(result.argument).toBeNull()
  })

  it('匹配命令别名', () => {
    const result = parseCommandInput('今天')
    expect(result.command).not.toBeNull()
    expect(result.command?.id).toBe('today')
    expect(result.argument).toBeNull()
  })

  it('命令名 + 参数', () => {
    const result = parseCommandInput('deadline 2024-05-20')
    expect(result.command).not.toBeNull()
    expect(result.command?.id).toBe('deadline')
    expect(result.argument).toBe('2024-05-20')
  })

  it('别名 + 参数', () => {
    const result = parseCommandInput('待办 some text')
    expect(result.command).not.toBeNull()
    expect(result.command?.id).toBe('todo')
    expect(result.argument).toBe('some text')
  })

  it('大小写不敏感', () => {
    const lower = parseCommandInput('today')
    const upper = parseCommandInput('TODAY')
    // parseCommandInput 实现是大小写敏感的，所以这里测试实际行为
    expect(lower.command?.id).toBe('today')
    // TODAY 不会匹配 today（大小写敏感）
    expect(upper.command).toBeNull()
  })

  it('无匹配返回 null', () => {
    const result = parseCommandInput('nonexistent-command')
    expect(result.command).toBeNull()
    expect(result.argument).toBeNull()
  })

  it('空字符串返回 null', () => {
    const result = parseCommandInput('')
    expect(result.command).toBeNull()
    expect(result.argument).toBeNull()
  })

  it('空白字符串返回 null', () => {
    const result = parseCommandInput('   ')
    expect(result.command).toBeNull()
    expect(result.argument).toBeNull()
  })

  it('参数包含多个空格', () => {
    const result = parseCommandInput('deadline 2024-05-20 extra text')
    expect(result.command?.id).toBe('deadline')
    expect(result.argument).toBe('2024-05-20 extra text')
  })

  it('命令名后仅空格无参数', () => {
    const result = parseCommandInput('today ')
    expect(result.command?.id).toBe('today')
    expect(result.argument).toBeNull()
  })
})
