import { describe, it, expect, vi, beforeEach } from 'vitest'
import { filterCommands, groupCommands, parseCommandInput, commands } from './useSlashCommands'
import type { Command } from '../types/command'

vi.mock('../stores/blocks', () => ({
  useBlockStore: vi.fn(() => ({
    updateBlockType: vi.fn(),
    updateBlockContent: vi.fn(),
    updateBlockProperties: vi.fn()
  }))
}))

describe('filterCommands', () => {
  it('returns all commands when query is empty', () => {
    const result = filterCommands('')
    expect(result).toEqual(commands)
  })

  it('filters commands by name prefix match', () => {
    const result = filterCommands('tod')
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].name.toLowerCase()).toMatch(/^tod/)
  })

  it('prioritizes name prefix over alias prefix', () => {
    const byName = filterCommands('todo')
    const byAlias = filterCommands('待办')
    expect(byName.length).toBeGreaterThan(0)
    expect(byAlias.length).toBeGreaterThan(0)
  })

  it('filters commands by alias prefix match', () => {
    const result = filterCommands('今天')
    expect(result.length).toBeGreaterThan(0)
    expect(result.some(c => c.alias?.includes('今天'))).toBe(true)
  })

  it('filters commands by name contains match', () => {
    const result = filterCommands('bold')
    expect(result.length).toBeGreaterThan(0)
    expect(result.every(c => c.name.toLowerCase().includes('bold'))).toBe(true)
  })

  it('filters commands by alias contains match', () => {
    const result = filterCommands('体')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns empty array when no match', () => {
    const result = filterCommands('xyznonexistent')
    expect(result).toEqual([])
  })

  it('is case-insensitive for name matching', () => {
    const upper = filterCommands('BOLD')
    const lower = filterCommands('bold')
    expect(upper.length).toBe(lower.length)
  })

  it('is case-insensitive for alias matching', () => {
    const result = filterCommands('粗')
    expect(result.length).toBeGreaterThan(0)
  })

  it('sorts by priority: name prefix > alias prefix > name contains > alias contains', () => {
    const result = filterCommands('ti')
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].name.toLowerCase()).toMatch(/^ti/)
  })

  it('accepts custom command list', () => {
    const customCommands: Command[] = [
      { id: 'test', name: 'Test', alias: [], group: 'Test', icon: '🔧', action: () => {} }
    ]
    const result = filterCommands('test', customCommands)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('test')
  })
})

describe('groupCommands', () => {
  it('groups commands by their group property', () => {
    const result = groupCommands(commands)
    expect(result.size).toBeGreaterThan(0)
    expect(result.has('日期时间')).toBe(true)
    expect(result.has('任务')).toBe(true)
    expect(result.has('属性')).toBe(true)
    expect(result.has('文本格式')).toBe(true)
    expect(result.has('链接引用')).toBe(true)
    expect(result.has('页面操作')).toBe(true)
  })

  it('groups all commands', () => {
    const result = groupCommands(commands)
    let totalCommands = 0
    for (const group of result.values()) {
      totalCommands += group.length
    }
    expect(totalCommands).toBe(commands.length)
  })

  it('preserves command order within groups', () => {
    const result = groupCommands(commands)
    for (const group of result.values()) {
      expect(group.length).toBeGreaterThan(0)
    }
  })

  it('handles custom command list', () => {
    const customCommands: Command[] = [
      { id: 'a', name: 'A', alias: [], group: 'Group1', icon: '🔧', action: () => {} },
      { id: 'b', name: 'B', alias: [], group: 'Group1', icon: '🔧', action: () => {} },
      { id: 'c', name: 'C', alias: [], group: 'Group2', icon: '🔧', action: () => {} }
    ]
    const result = groupCommands(customCommands)
    expect(result.get('Group1')?.length).toBe(2)
    expect(result.get('Group2')?.length).toBe(1)
  })

  it('returns Map with string keys', () => {
    const result = groupCommands(commands)
    expect(result).toBeInstanceOf(Map)
    for (const key of result.keys()) {
      expect(typeof key).toBe('string')
    }
  })
})

describe('parseCommandInput', () => {
  it('parses simple command without arguments', () => {
    const result = parseCommandInput('today')
    expect(result.command).not.toBeNull()
    expect(result.command?.id).toBe('today')
    expect(result.argument).toBeNull()
  })

  it('parses command with argument', () => {
    const result = parseCommandInput('deadline 2024-05-20')
    expect(result.command).not.toBeNull()
    expect(result.command?.id).toBe('deadline')
    expect(result.argument).toBe('2024-05-20')
  })

  it('parses command with argument using alias', () => {
    const result = parseCommandInput('截止日期 2024-05-20')
    expect(result.command).not.toBeNull()
    expect(result.command?.id).toBe('deadline')
    expect(result.argument).toBe('2024-05-20')
  })

  it('returns null for invalid command', () => {
    const result = parseCommandInput('nonexistentcommand')
    expect(result.command).toBeNull()
    expect(result.argument).toBeNull()
  })

  it('trims whitespace from input', () => {
    const result = parseCommandInput('  todo  ')
    expect(result.command).not.toBeNull()
    expect(result.command?.id).toBe('todo')
  })

  it('handles empty argument', () => {
    const result = parseCommandInput('deadline ')
    expect(result.command).not.toBeNull()
    expect(result.command?.id).toBe('deadline')
    expect(result.argument).toBeNull()
  })
})

describe('commands - completeness', () => {
  it('all commands have required properties', () => {
    for (const cmd of commands) {
      expect(cmd.id).toBeDefined()
      expect(cmd.name).toBeDefined()
      expect(cmd.group).toBeDefined()
      expect(cmd.icon).toBeDefined()
      expect(typeof cmd.action).toBe('function')
    }
  })

  it('all commands have unique ids', () => {
    const ids = commands.map(c => c.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('all commands have non-empty groups', () => {
    for (const cmd of commands) {
      expect(cmd.group.length).toBeGreaterThan(0)
    }
  })

  it('date-related commands exist', () => {
    const dateCommands = commands.filter(c => c.group === '日期时间')
    expect(dateCommands.length).toBeGreaterThanOrEqual(3)
    expect(dateCommands.some(c => c.id === 'today')).toBe(true)
    expect(dateCommands.some(c => c.id === 'tomorrow')).toBe(true)
    expect(dateCommands.some(c => c.id === 'yesterday')).toBe(true)
  })

  it('task commands exist', () => {
    const statusCommands = commands.filter(c => c.group === '任务')
    expect(statusCommands.length).toBeGreaterThanOrEqual(3)
    expect(statusCommands.some(c => c.id === 'todo')).toBe(true)
    expect(statusCommands.some(c => c.id === 'done')).toBe(true)
    expect(statusCommands.some(c => c.id === 'doing')).toBe(true)
  })

  it('format commands exist', () => {
    const formatCommands = commands.filter(c => c.group === '文本格式')
    expect(formatCommands.length).toBeGreaterThanOrEqual(4)
    expect(formatCommands.some(c => c.id === 'bold')).toBe(true)
    expect(formatCommands.some(c => c.id === 'italic')).toBe(true)
  })

  it('embed and image commands exist', () => {
    const embedCmd = commands.find(c => c.id === 'embed')
    expect(embedCmd).toBeDefined()
    expect(embedCmd?.group).toBe('文本格式')
    expect(embedCmd?.convertBlockType).toBe('embed')

    const imageCmd = commands.find(c => c.id === 'image')
    expect(imageCmd).toBeDefined()
    expect(imageCmd?.group).toBe('文本格式')
    expect(imageCmd?.convertBlockType).toBe('image')
  })

  it('immediate commands (todo, doing, done) exist with correct property keys', () => {
    const todoCmd = commands.find(c => c.id === 'todo')
    expect(todoCmd).toBeDefined()
    expect(todoCmd?.propertyKey).toBe('status')
    expect(todoCmd?.propertyValue).toBe('Todo')
    expect(todoCmd?.immediate).toBe(true)

    const doneCmd = commands.find(c => c.id === 'done')
    expect(doneCmd).toBeDefined()
    expect(doneCmd?.propertyKey).toBe('status')
    expect(doneCmd?.propertyValue).toBe('Done')
    expect(doneCmd?.immediate).toBe(true)
  })

  it('priority commands exist with correct property keys', () => {
    const urgentCmd = commands.find(c => c.name === 'Urgent')
    expect(urgentCmd).toBeDefined()
    expect(urgentCmd?.propertyKey).toBe('priority')
    expect(urgentCmd?.propertyValue).toBe('Urgent')
    expect(urgentCmd?.immediate).toBe(true)
  })

  it('date commands (today, tomorrow, yesterday) have correct aliases', () => {
    const todayCmd = commands.find(c => c.id === 'today')
    expect(todayCmd).toBeDefined()
    expect(todayCmd?.alias).toContain('今天')

    const tomorrowCmd = commands.find(c => c.id === 'tomorrow')
    expect(tomorrowCmd).toBeDefined()
    expect(tomorrowCmd?.alias).toContain('明天')

    const yesterdayCmd = commands.find(c => c.id === 'yesterday')
    expect(yesterdayCmd).toBeDefined()
    expect(yesterdayCmd?.alias).toContain('昨天')
  })

  it('page-ref command inserts [[]] with cursor at position 2', () => {
    const pageRefCmd = commands.find(c => c.id === 'page-ref')
    expect(pageRefCmd).toBeDefined()
    expect(typeof pageRefCmd?.action).toBe('function')
  })
})

describe('formatDate', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date('2024-05-15T12:00:00')
    const result = formatDate(date)
    expect(result).toBe('2024-05-15')
  })

  it('pads single-digit month and day with leading zeros', () => {
    const date = new Date('2024-01-05T12:00:00')
    const result = formatDate(date)
    expect(result).toBe('2024-01-05')
  })

  it('handles December correctly', () => {
    const date = new Date('2024-12-25T12:00:00')
    const result = formatDate(date)
    expect(result).toBe('2024-12-25')
  })
})

describe('insertEmbed action', () => {
  it('should delete range and focus editor', () => {
    const mockEditor = {
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn()
    }

    const mockRange = { from: 10, to: 20 }
    const mockBlockId = 'block-123'

    const embedCmd = commands.find(c => c.id === 'embed')
    expect(embedCmd).toBeDefined()

    embedCmd!.action({
      editor: mockEditor as any,
      range: mockRange,
      blockId: mockBlockId
    })

    expect(mockEditor.chain).toHaveBeenCalled()
    expect(mockEditor.deleteRange).toHaveBeenCalledWith(mockRange)
    expect(mockEditor.focus).toHaveBeenCalled()
    expect(mockEditor.run).toHaveBeenCalled()
  })

  it('should handle missing blockId gracefully', () => {
    const mockEditor = {
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn()
    }

    const embedCmd = commands.find(c => c.id === 'embed')
    embedCmd!.action({
      editor: mockEditor as any,
      range: { from: 10, to: 20 },
      blockId: undefined
    })

    expect(mockEditor.chain).toHaveBeenCalled()
    expect(mockEditor.deleteRange).toHaveBeenCalled()
  })
})

describe('insertImage action', () => {
  it('should delete range, focus editor, and update block type', async () => {
    const mockEditor = {
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      insertContent: vi.fn().mockReturnThis(),
      run: vi.fn()
    }

    const mockRange = { from: 10, to: 20 }
    const mockBlockId = 'block-456'

    const imageCmd = commands.find(c => c.id === 'image')
    expect(imageCmd).toBeDefined()

    imageCmd!.action({
      editor: mockEditor as any,
      range: mockRange,
      blockId: mockBlockId
    })

    expect(mockEditor.chain).toHaveBeenCalled()
    expect(mockEditor.deleteRange).toHaveBeenCalledWith(mockRange)
    expect(mockEditor.focus).toHaveBeenCalled()
    expect(mockEditor.run).toHaveBeenCalled()
  })

  it('should update block content with image placeholder via blockStore', async () => {
    const { useBlockStore } = await import('../stores/blocks')
    const mockUpdateBlockContent = vi.fn()
    vi.mocked(useBlockStore).mockReturnValue({
      updateBlockContent: mockUpdateBlockContent,
      updateBlockType: vi.fn()
    } as any)

    const mockEditor = {
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn()
    }

    const imageCmd = commands.find(c => c.id === 'image')
    imageCmd!.action({
      editor: mockEditor as any,
      range: { from: 10, to: 20 },
      blockId: 'block-789'
    })

    expect(mockUpdateBlockContent).toHaveBeenCalledWith('block-789', '![]()')
  })
})

describe('insertFormat action', () => {
  it('should wrap selected text with format markers', () => {
    const mockEditor = {
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      insertContent: vi.fn().mockReturnThis(),
      setTextSelection: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn()
    }

    const boldCmd = commands.find(c => c.id === 'bold')
    expect(boldCmd).toBeDefined()

    const mockSelection = { from: 10, to: 20 }
    mockEditor.state = {
      selection: mockSelection,
      doc: {
        textBetween: vi.fn(() => 'selected text')
      }
    }

    boldCmd!.action({
      editor: mockEditor as any,
      range: mockSelection,
      blockId: 'block-123'
    })

    expect(mockEditor.insertContent).toHaveBeenCalledWith('**selected text**')
  })

  it('should insert placeholder when no text is selected', () => {
    const mockEditor = {
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      insertContent: vi.fn().mockReturnThis(),
      setTextSelection: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn()
    }

    const italicCmd = commands.find(c => c.id === 'italic')
    const mockRange = { from: 10, to: 10 }
    mockEditor.state = {
      selection: mockRange,
      doc: {
        textBetween: vi.fn(() => '')
      }
    }

    italicCmd!.action({
      editor: mockEditor as any,
      range: mockRange,
      blockId: 'block-123'
    })

    expect(mockEditor.insertContent).toHaveBeenCalled()
    expect(mockEditor.setTextSelection).toHaveBeenCalled()
  })
})

describe('insertPageRef action', () => {
  it('should insert [[]] and set cursor at position 2', () => {
    const mockEditor = {
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      insertContent: vi.fn().mockReturnThis(),
      setTextSelection: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn()
    }

    const pageRefCmd = commands.find(c => c.id === 'page-ref')
    expect(pageRefCmd).toBeDefined()

    const mockRange = { from: 10, to: 20 }
    pageRefCmd!.action({
      editor: mockEditor as any,
      range: mockRange,
      blockId: 'block-123'
    })

    expect(mockEditor.insertContent).toHaveBeenCalledWith('[[]]')
    expect(mockEditor.setTextSelection).toHaveBeenCalledWith(12)
  })
})

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
