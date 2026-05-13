import type { Command, CommandProps } from '../types/command'

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 格式化时间为 HH:mm
 */
function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * 获取今天的日期链接
 */
function insertToday({ editor, range }: CommandProps) {
  const today = formatDate(new Date())
  editor.chain()
    .deleteRange(range)
    .insertContent(`[[${today}]]`)
    .focus()
    .run()
}

/**
 * 获取明天的日期链接
 */
function insertTomorrow({ editor, range }: CommandProps) {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  editor.chain()
    .deleteRange(range)
    .insertContent(`[[${formatDate(tomorrow)}]]`)
    .focus()
    .run()
}

/**
 * 获取昨天的日期链接
 */
function insertYesterday({ editor, range }: CommandProps) {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  editor.chain()
    .deleteRange(range)
    .insertContent(`[[${formatDate(yesterday)}]]`)
    .focus()
    .run()
}

/**
 * 插入当前时间
 */
function insertTime({ editor, range }: CommandProps) {
  const time = formatTime(new Date())
  editor.chain()
    .deleteRange(range)
    .insertContent(time)
    .focus()
    .run()
}

/**
 * 插入日期选择器（Phase 1.1 简化为插入今天日期）
 */
function insertDatePicker({ editor, range }: CommandProps) {
  // Phase 1.1 暂不实现日期选择器，直接插入今天日期
  const today = formatDate(new Date())
  editor.chain()
    .deleteRange(range)
    .insertContent(`[[${today}]]`)
    .focus()
    .run()
}

/**
 * 在 Block 开头插入状态标记
 */
function insertStatus(status: string) {
  return ({ editor, range }: CommandProps) => {
    const text = editor.getText()
    const beforeCursor = text.slice(0, range.from - 1)
    const afterCursor = text.slice(range.to - 1)

    // 如果开头已有状态标记，替换它
    const statusPattern = /^(TODO|DOING|DONE|LATER|NOW)\s*/
    const match = beforeCursor.match(statusPattern)

    let newContent: string
    if (match) {
      // 替换现有状态
      newContent = status + ' ' + beforeCursor.slice(match[0].length) + afterCursor
    } else {
      // 插入状态到开头
      newContent = status + ' ' + beforeCursor + afterCursor
    }

    editor.chain()
      .deleteRange({ from: 1, to: text.length + 1 })
      .insertContent(newContent)
      .setTextSelection(status.length + 1)
      .focus()
      .run()
  }
}

/**
 * 插入格式包裹（粗体/斜体/高亮/代码）
 */
function insertFormat(mark: string, placeholder = '|') {
  return ({ editor, range }: CommandProps) => {
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)

    if (selectedText) {
      // 包裹选中文字
      editor.chain()
        .deleteRange(range)
        .insertContent(`${mark}${selectedText}${mark}`)
        .focus()
        .run()
    } else {
      // 插入模板，光标在中间
      const beforePlaceholder = mark + placeholder + mark
      const cursorPos = range.from + mark.length
      editor.chain()
        .deleteRange(range)
        .insertContent(beforePlaceholder)
        .setTextSelection({ from: cursorPos, to: cursorPos + placeholder.length })
        .focus()
        .run()
    }
  }
}

/**
 * 插入代码块（创建新 Block）
 * Phase 1.1 简化：插入 ``` 代码块标记
 */
function insertCodeBlock({ editor, range }: CommandProps) {
  editor.chain()
    .deleteRange(range)
    .insertContent('```\n\n```')
    .setTextSelection(range.from + 4)
    .focus()
    .run()
}

/**
 * 插入页面引用链接
 */
function insertPageRef({ editor, range }: CommandProps) {
  editor.chain()
    .deleteRange(range)
    .insertContent('[[]]')
    .setTextSelection(range.from + 2)
    .focus()
    .run()
}

/**
 * 插入标签
 */
function insertTag({ editor, range }: CommandProps) {
  editor.chain()
    .deleteRange(range)
    .insertContent('#')
    .focus()
    .run()
}

/**
 * MVP 命令列表（18 个）
 */
export const commands: Command[] = [
  // 日期时间
  {
    id: 'today',
    name: 'Today',
    alias: ['今天', 'date'],
    group: '日期时间',
    icon: '📆',
    action: insertToday
  },
  {
    id: 'tomorrow',
    name: 'Tomorrow',
    alias: ['明天'],
    group: '日期时间',
    icon: '📅',
    action: insertTomorrow
  },
  {
    id: 'yesterday',
    name: 'Yesterday',
    alias: ['昨天'],
    group: '日期时间',
    icon: '📅',
    action: insertYesterday
  },
  {
    id: 'time',
    name: 'Time',
    alias: ['时间'],
    group: '日期时间',
    icon: '⏰',
    action: insertTime
  },
  {
    id: 'date-picker',
    name: 'Date picker',
    alias: ['日期选择'],
    group: '日期时间',
    icon: '🗓️',
    action: insertDatePicker
  },

  // 任务状态
  {
    id: 'todo',
    name: 'TODO',
    alias: ['待办'],
    group: '任务状态',
    icon: '☐',
    action: insertStatus('TODO')
  },
  {
    id: 'doing',
    name: 'DOING',
    alias: ['进行中'],
    group: '任务状态',
    icon: '◐',
    action: insertStatus('DOING')
  },
  {
    id: 'done',
    name: 'DONE',
    alias: ['完成'],
    group: '任务状态',
    icon: '✓',
    action: insertStatus('DONE')
  },
  {
    id: 'later',
    name: 'LATER',
    alias: ['稍后'],
    group: '任务状态',
    icon: '⏳',
    action: insertStatus('LATER')
  },
  {
    id: 'now',
    name: 'NOW',
    alias: ['现在'],
    group: '任务状态',
    icon: '🎯',
    action: insertStatus('NOW')
  },

  // 文本格式
  {
    id: 'bold',
    name: 'Bold',
    alias: ['粗体'],
    group: '文本格式',
    icon: '𝐁',
    action: insertFormat('**')
  },
  {
    id: 'italic',
    name: 'Italic',
    alias: ['斜体'],
    group: '文本格式',
    icon: '𝐼',
    action: insertFormat('*')
  },
  {
    id: 'highlight',
    name: 'Highlight',
    alias: ['高亮'],
    group: '文本格式',
    icon: '🖍️',
    action: insertFormat('^^')
  },
  {
    id: 'code',
    name: 'Code',
    alias: ['代码'],
    group: '文本格式',
    icon: '💻',
    action: insertFormat('`')
  },
  {
    id: 'code-block',
    name: 'Code block',
    alias: ['代码块'],
    group: '文本格式',
    icon: '📄',
    action: insertCodeBlock
  },

  // 链接引用
  {
    id: 'page-ref',
    name: 'Page reference',
    alias: ['页面引用', 'link', '链接'],
    group: '链接引用',
    icon: '🔗',
    action: insertPageRef
  },
  {
    id: 'tag',
    name: 'Tag',
    alias: ['标签'],
    group: '链接引用',
    icon: '🏷️',
    action: insertTag
  },

  // 页面操作（占位，由 SlashCommandMenu 特殊处理）
  {
    id: 'search-page',
    name: 'Search or create page',
    alias: ['搜索页面', 'page'],
    group: '页面操作',
    icon: '🔍',
    action: () => {
      // 由 SlashCommandMenu.vue 特殊处理
    }
  },
  {
    id: 'property',
    name: 'Add property',
    alias: ['属性', 'property', 'prop'],
    group: '属性',
    icon: '🏷️',
    action: () => {
      // 由 SlashCommandMenu.vue 特殊处理
    }
  }
]

/**
 * 过滤命令（模糊匹配 + 排序）
 * 排序优先级：name前缀匹配 > alias前缀匹配 > name包含匹配 > alias包含匹配
 */
export function filterCommands(query: string, commandList: Command[] = commands): Command[] {
  if (!query) return commandList

  const lowerQuery = query.toLowerCase()

  const scored = commandList.map(cmd => {
    const name = cmd.name.toLowerCase()
    const alias = cmd.alias?.map(a => a.toLowerCase()) || []

    let score = Infinity

    // name 前缀匹配（最高优先级）
    if (name.startsWith(lowerQuery)) score = 0
    // alias 前缀匹配
    else if (alias.some(a => a.startsWith(lowerQuery))) score = 1
    // name 包含匹配
    else if (name.includes(lowerQuery)) score = 2
    // alias 包含匹配
    else if (alias.some(a => a.includes(lowerQuery))) score = 3

    return { cmd, score }
  })

  return scored
    .filter(item => item.score !== Infinity)
    .sort((a, b) => a.score - b.score)
    .map(item => item.cmd)
}

/**
 * 按分组组织命令
 */
export function groupCommands(commandList: Command[]): Map<string, Command[]> {
  const groups = new Map<string, Command[]>()

  commandList.forEach(cmd => {
    if (!groups.has(cmd.group)) {
      groups.set(cmd.group, [])
    }
    groups.get(cmd.group)!.push(cmd)
  })

  return groups
}

/**
 * Slash Commands composable
 */
export function useSlashCommands() {
  return {
    commands,
    filterCommands,
    groupCommands
  }
}
