import { TASK_PRIORITY_ICONS, TASK_STATUS_ICONS } from '../components/Icons'
import { nextTick } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { Command, CommandProps } from '../types/command'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { usePageStore } from '../stores/pages'
import { useTemplateRegistry } from './useTemplateRegistry'
import { TemplateRenderer } from '../services/template-renderer'

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
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  editor.chain()
    .deleteRange(range)
    .insertContent(time)
    .focus()
    .run()
}

/**
 * 插入日期选择器占位符
 */
function insertDatePicker({ editor, range }: CommandProps) {
  const today = formatDate(new Date())
  editor.chain()
    .deleteRange(range)
    .insertContent(`[[${today}]]`)
    .focus()
    .run()
}

/**
 * 插入格式包裹（粗体/斜体/高亮/代码）
 */
function insertFormat(mark: string, placeholder = '|') {
  return ({ editor, range }: CommandProps) => {
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)

    if (selectedText) {
      editor.chain()
        .deleteRange(range)
        .insertContent(`${mark}${selectedText}${mark}`)
        .focus()
        .run()
    } else {
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
 * 插入代码块
 */
function insertCodeBlock({ editor, range, blockId }: CommandProps) {
  // 删除斜杠命令文本
  editor.chain()
    .deleteRange(range)
    .focus()
    .run()
  
  // 切换到 code block 类型
  const blockStore = useBlockStore()
  if (blockId) {
    blockStore.updateBlockType(blockId, 'code')
  }
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
 * 插入标签（# 页面链接）
 */
function insertTag({ editor, range }: CommandProps) {
  editor.chain()
    .deleteRange(range)
    .insertContent('#')
    .focus()
    .run()
}

/**
 * 插入 Image Block
 */
function insertImage({ editor, range, blockId }: CommandProps) {
  editor.chain()
    .deleteRange(range)
    .focus()
    .run()

  const blockStore = useBlockStore()
  if (blockId) {
    blockStore.updateBlockType(blockId, 'image')
    blockStore.updateBlockContent(blockId, '![]()')
  }
}

/**
 * 插入 Embed Block
 */
function insertEmbed({ editor, range, blockId }: CommandProps) {
  editor.chain()
    .deleteRange(range)
    .focus()
    .run()

  const blockStore = useBlockStore()
  if (blockId) {
    blockStore.updateBlockType(blockId, 'embed')
  }
}

/**
 * 插入 Concept Block（每页最多一个，固定在页面顶部）
 */
async function insertConcept({ editor, range, blockId }: { editor: any, range: { from: number, to: number }, blockId?: string }) {
  if (!blockId) return

  const blockStore = useBlockStore()
  const editorStore = useEditorStore()

  const currentBlock = blockStore.blocks.find(b => b.id === blockId)
  if (!currentBlock) return

  const pageId = currentBlock.pageId

  // 检查该页面是否已有 Concept Block
  const existing = blockStore.blocks.find(
    b => b.pageId === pageId && b.type === 'concept'
  )
  if (existing) {
    // 已有则激活它
    editor.chain().deleteRange(range).focus().run()
    await nextTick()
    editorStore.activateBlock(existing.id, 1)
    return
  }

  // 清除斜杠命令文本
  editor.chain()
    .deleteRange(range)
    .focus()
    .run()

  // 转换当前 Block 为 concept 类型
  await blockStore.updateBlockType(blockId, 'concept')

  // 将 Concept Block 移到页面顶部
  await blockStore.moveBlock({ blockId, toParentId: null, newIndex: 0 })

  // 激活 Concept Block 进入编辑模式
  await nextTick()
  editorStore.activateBlock(blockId, 1)
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

  // 任务状态（立即执行）
  {
    id: 'todo',
    name: 'Todo',
    alias: ['待办'],
    group: '任务',
    icon: TASK_STATUS_ICONS.Todo,
    action: () => {},
    propertyKey: 'status',
    propertyValue: 'Todo',
    immediate: true
  },
  {
    id: 'doing',
    name: 'Doing',
    alias: ['进行中'],
    group: '任务',
    icon: TASK_STATUS_ICONS.Doing,
    action: () => {},
    propertyKey: 'status',
    propertyValue: 'Doing',
    immediate: true
  },
  {
    id: 'done',
    name: 'Done',
    alias: ['完成'],
    group: '任务',
    icon: TASK_STATUS_ICONS.Done,
    action: () => {},
    propertyKey: 'status',
    propertyValue: 'Done',
    immediate: true
  },

  // 优先级（立即执行）
  {
    id: TASK_PRIORITY_ICONS.Urgent,
    name: 'Urgent',
    alias: ['重要紧急', 'urgent'],
    group: '属性',
    icon: TASK_PRIORITY_ICONS.Urgent,
    action: () => {},
    propertyKey: 'priority',
    propertyValue: 'Urgent',
    immediate: true
  },
  {
    id: TASK_PRIORITY_ICONS.High,
    name: 'High',
    alias: ['紧急不重要', 'high'],
    group: '属性',
    icon: TASK_PRIORITY_ICONS.High,
    action: () => {},
    propertyKey: 'priority',
    propertyValue: 'High',
    immediate: true
  },
  {
    id: TASK_PRIORITY_ICONS.Medium,
    name: 'Medium',
    alias: ['重要不紧急', 'medium'],
    group: '属性',
    icon: TASK_PRIORITY_ICONS.Medium,
    action: () => {},
    propertyKey: 'priority',
    propertyValue: 'Medium',
    immediate: true
  },
  {
    id: TASK_PRIORITY_ICONS.Low,
    name: 'Low',
    alias: ['不重要不紧急', 'low'],
    group: '属性',
    icon: TASK_PRIORITY_ICONS.Low,
    action: () => {},
    propertyKey: 'priority',
    propertyValue: 'Low',
    immediate: true
  },
  // 属性编辑（打开编辑器）
  {
    id: 'status',
    name: 'Status',
    alias: ['状态', 's'],
    group: '属性',
    icon: '📋',
    action: () => {},
    propertyKey: 'status',
    openEditor: true
  },
  {
    id: 'priority',
    name: 'Priority',
    alias: ['优先级', 'p'],
    group: '属性',
    icon: '🔴',
    action: () => {},
    propertyKey: 'priority',
    openEditor: true
  },
  {
    id: 'deadline',
    name: 'Deadline',
    alias: ['截止日期', 'due'],
    group: '属性',
    icon: '📅',
    action: () => {},
    propertyKey: 'deadline',
    openEditor: true,
    acceptArgument: true
  },
  {
    id: 'scheduled',
    name: 'Scheduled',
    alias: ['计划日期', 'sched'],
    group: '属性',
    icon: '📅',
    action: () => {},
    propertyKey: 'scheduled',
    openEditor: true,
    acceptArgument: true
  },
  {
    id: 'project',
    name: 'Project',
    alias: ['项目', 'proj'],
    group: '属性',
    icon: '📁',
    action: () => {},
    propertyKey: 'project',
    openEditor: true,
    acceptArgument: true
  },
  {
    id: 'area',
    name: 'Area',
    alias: ['领域'],
    group: '属性',
    icon: '🌐',
    action: () => {},
    propertyKey: 'area',
    openEditor: true,
    acceptArgument: true
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
    action: insertCodeBlock
  },
  {
    id: 'code-block',
    name: 'Code block',
    alias: ['代码块'],
    group: '文本格式',
    icon: '📄',
    action: insertCodeBlock
  },
  {
    id: 'image',
    name: 'Image',
    alias: ['图片', 'img'],
    group: '文本格式',
    icon: '🖼️',
    action: insertImage,
    convertBlockType: 'image'
  },
  {
    id: 'embed',
    name: 'Embed',
    alias: ['嵌入', '引用'],
    group: '文本格式',
    icon: '📌',
    action: insertEmbed,
    convertBlockType: 'embed'
  },
  {
    id: 'concept',
    name: 'Concept',
    alias: ['概念', 'concept-block'],
    group: '文本格式',
    icon: '🧠',
    action: insertConcept,
    convertBlockType: 'concept'
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
    alias: ['属性', 'prop'],
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
 * 解析命令和参数（例如 "/deadline 2024-05-20" -> { command: deadlineCommand, argument: "2024-05-20" }）
 */
export function parseCommandInput(input: string): {
  command: Command | null,
  argument: string | null
} {
  const trimmedInput = input.trim()

  // 查找匹配的命令
  for (const cmd of commands) {
    // 检查命令名是否匹配
    const commandNames = [cmd.name.toLowerCase(), ...(cmd.alias?.map(a => a.toLowerCase()) || [])]

    for (const name of commandNames) {
      // 完全匹配或者匹配前缀（后面跟空格）
      if (trimmedInput === name || trimmedInput.startsWith(name + ' ')) {
        const argument = trimmedInput.slice(name.length).trim()
        return {
          command: cmd,
          argument: argument || null
        }
      }
    }
  }

  return { command: null, argument: null }
}

/**
 * Slash Commands composable
 */
export function useSlashCommands() {
  return {
    commands,
    filterCommands,
    groupCommands,
    parseCommandInput
  }
}

// ─── 模板命令（Plan B Task 2） ─────────────────────────────────

/**
 * 触发模板插入：清除斜杠命令文本 → 渲染 → 写入 blocksStore → 定位光标。
 * 由 SlashCommandMenu.vue 在 command.id 形如 `template:<id>` 时调用。
 */
export async function executeTemplateCommand(
  blockId: string | undefined,
  templateId: string,
  editorInstance: Editor,
  range: { from: number; to: number }
): Promise<void> {
  if (!blockId) return

  const registry = useTemplateRegistry()
  if (!registry.isLoaded.value) {
    await registry.loadAll()
  }
  const template = registry.getById(templateId)
  if (!template) {
    console.warn(`[executeTemplateCommand] Template not found: ${templateId}`)
    return
  }

  const blockStore = useBlockStore()
  const editorStore = useEditorStore()
  const anchor = blockStore.blocks.find(b => b.id === blockId)
  if (!anchor) {
    console.warn(`[executeTemplateCommand] Anchor block not found: ${blockId}`)
    return
  }

  // 1. 清除斜杠命令文本（从 / 字符到当前光标）
  const editor = editorInstance
  const cursorNow = editor.state.selection.from
  editor.chain()
    .deleteRange({ from: range.from, to: cursorNow })
    .focus()
    .run()

  // 2. 构建上下文 + 渲染
  const pageTitle = usePageStore().getPage(anchor.pageId)?.title ?? anchor.pageId
  const context = await TemplateRenderer.buildContext(pageTitle)
  const drafts = TemplateRenderer.render(template, context, anchor)

  // 3. 写入 blocks（按 pos 倒序插入，保证 anchor.pos+1000, +2000... 递增）
  const sortedDrafts = [...drafts].sort((a, b) => b.pos - a.pos)
  const newIds: string[] = []
  for (const draft of sortedDrafts) {
    const created = await blockStore.createBlock({
      pageId: draft.pageId,
      parentId: draft.parentId,
      pos: draft.pos,
      content: draft.content,
      format: draft.format,
      type: draft.type,
      properties: draft.properties,
    })
    newIds.push(created.id)
  }

  // 4. 定位到第一个含 cursorMarker 的 Block（若有），否则聚焦到第一个新 Block
  const firstCursor = drafts.find(d => d.cursorMarker === '__CURSOR__')
  if (firstCursor) {
    const target = blockStore.blocks.find(
      b => b.pageId === firstCursor.pageId && b.pos === firstCursor.pos
    )
    if (target) {
      editorStore.activateBlock(target.id)
    }
  } else {
    const firstNewId = newIds[newIds.length - 1] // 倒序插入后最后 push 的是 pos 最小
    if (firstNewId) {
      editorStore.activateBlock(firstNewId)
    }
  }
}

/**
 * 为所有 NormalizedTemplate 构建对应的 Command[]。
 * 调用方需先 await useTemplateRegistry().loadAll()，否则 user 模板缺失。
 */
export function buildTemplateCommands(): Command[] {
  const registry = useTemplateRegistry()
  return registry.all.value.map((t): Command => ({
    id: `template:${t.id}`,
    name: t.name,
    alias: ['template', 'tpl', ...(t.aliases ?? []), t.id.startsWith('user:') ? t.id.slice(5) : t.id],
    group: '模板',
    icon: t.icon,
    action: ({ editor, range, blockId }) => {
      void executeTemplateCommand(blockId, t.id, editor, range)
    },
  }))
}
