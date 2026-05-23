import type { Editor } from '@tiptap/vue-3'
import type { Block } from './block'

/**
 * 斜杠命令执行上下文
 */
export interface CommandProps {
  editor: Editor
  range: { from: number; to: number }
  blockId?: string
}

/**
 * 斜杠命令定义
 */
export interface Command {
  id: string
  name: string
  alias?: string[]
  group: string
  icon: string
  action: (props: CommandProps) => void

  // 属性命令相关
  propertyKey?: string
  propertyValue?: string | string[]
  immediate?: boolean
  openEditor?: boolean
  acceptArgument?: boolean
  convertBlockType?: Block['type']
}

/**
 * 斜杠命令分组
 */
export interface CommandGroup {
  name: string
  icon: string
  commands: Command[]
}
