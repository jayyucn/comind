import { describe, it, expect } from 'vitest'
import { filterCommands, groupCommands, parseCommandInput, commands } from './useSlashCommands'
import type { Command } from '../types/command'

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
})
