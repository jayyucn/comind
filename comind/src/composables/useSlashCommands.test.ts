import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { buildTemplateCommands, executeTemplateCommand } from './useSlashCommands'
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
})
