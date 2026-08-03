import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { DateRefKind, RecurrenceRule } from '../utils/date-ref'

export interface ToastMessage {
  id: string
  message: string
  type?: 'info' | 'warning' | 'error'
}

export const useEditorStore = defineStore('editor', () => {
  const activeBlockId = ref<string | null>(null)
  /** 激活后要恢复的目标光标位置（ProseMirror position），用完即清 */
  const pendingCursorPos = ref<number | null>(null)
  /** 激活后用 posAtCoords 定位的鼠标坐标，用完即清 */
  const pendingClickCoords = ref<{ x: number; y: number } | null>(null)
  
  /** 当前活跃的编辑器实例 */
  const activeEditor = shallowRef<Editor | null>(null)
  
  /** 斜杠命令状态 */
  const slashCommand = ref<{
    visible: boolean
    query: string
    selectedIndex: number
    position: { x: number; y: number }
    range: { from: number; to: number }
  } | null>(null)

  async function activateBlock(blockId: string, cursorPos?: number) {
    // 已有活跃 Block 时先失活
    if (activeBlockId.value && activeBlockId.value !== blockId) {
      activeBlockId.value = null
    }
    activeBlockId.value = blockId
    if (cursorPos !== undefined) {
      pendingCursorPos.value = cursorPos
    }
  }

  function deactivateBlock() {
    activeBlockId.value = null
  }

  /** 消费并清除待恢复的光标位置 */
  function consumeCursorPos(): number | null {
    const pos = pendingCursorPos.value
    pendingCursorPos.value = null
    return pos
  }

  /** 设置待恢复的光标位置（由 Block.vue mousedown 触发） */
  function setCursorPos(pos: number | null) {
    pendingCursorPos.value = pos
  }

  /** 设置待定位的鼠标坐标（由 Block.vue mousedown 触发） */
  function setClickCoords(x: number, y: number) {
    pendingClickCoords.value = { x, y }
  }

  /** 消费并清除待定位的鼠标坐标 */
  function consumeClickCoords(): { x: number; y: number } | null {
    const coords = pendingClickCoords.value
    pendingClickCoords.value = null
    return coords
  }

  /** 设置当前编辑器实例 */
  function setActiveEditor(editor: Editor | null) {
    activeEditor.value = editor
  }

  /** 显示斜杠命令面板 */
  function showSlashCommand(position: { x: number; y: number }, range: { from: number; to: number }) {
    slashCommand.value = {
      visible: true,
      query: '',
      selectedIndex: 0,
      position,
      range
    }
  }

  /** 隐藏斜杠命令面板 */
  function hideSlashCommand() {
    if (slashCommand.value) {
      slashCommand.value.visible = false
    }
  }

  /** 更新斜杠命令查询 */
  function updateSlashQuery(query: string) {
    if (slashCommand.value) {
      slashCommand.value.query = query
      slashCommand.value.selectedIndex = 0
    }
  }

  /** 更新斜杠命令选中索引 */
  function updateSlashSelectedIndex(index: number) {
    if (slashCommand.value) {
      slashCommand.value.selectedIndex = index
    }
  }

  /** 属性编辑器状态 */
  const propertyEditor = ref<{
    visible: boolean
    blockId: string | null
    initialKey: string | null
  } | null>(null)

  function showPropertyEditor(blockId: string, initialKey?: string) {
    propertyEditor.value = {
      visible: true,
      blockId,
      initialKey: initialKey ?? null
    }
  }

  function hidePropertyEditor() {
    if (propertyEditor.value) {
      propertyEditor.value.visible = false
    }
  }

  /** dateRef 编辑面板状态 */
  /** dateRef 编辑面板状态
   * @property source — 'editor' = PM 文档坐标（from/to 是 PM pos）
   *                  | 'content' = 字符串索引（from/to 是 content 字符串偏移）
   * @property initialKind — 初始 kind，仅用于新插入场景（editor 模式，从 @ 触发）
   */
  const dateRefEditor = ref<{
    visible: boolean
    blockId: string | null
    from: number
    to: number
    source: 'editor' | 'content'
    kind: DateRefKind
    iso: string
    recurrence: RecurrenceRule
    leadMinutes: number
    position: { x: number; y: number }
    /** 仅 editor 模式新插入时有效，告知面板用 initialKind 而非 localKind 做校验 */
    initialKind?: DateRefKind
  } | null>(null)

  function openDateRefEditor(payload: {
    blockId: string | null
    from: number
    to: number
    source?: 'editor' | 'content'
    kind: DateRefKind
    iso: string
    recurrence: RecurrenceRule
    leadMinutes?: number
    position: { x: number; y: number }
    initialKind?: DateRefKind
  }) {
    dateRefEditor.value = { ...payload, source: payload.source ?? 'editor', visible: true, leadMinutes: payload.leadMinutes ?? 0 }
  }

  function closeDateRefEditor() {
    if (dateRefEditor.value) {
      dateRefEditor.value.visible = false
    }
  }

  /** Toast 提示状态 */
  const toasts = ref<ToastMessage[]>([])

  function showToast(message: string, type: 'info' | 'warning' | 'error' = 'info') {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    toasts.value.push({ id, message, type })
    
    setTimeout(() => {
      const idx = toasts.value.findIndex(t => t.id === id)
      if (idx !== -1) {
        toasts.value.splice(idx, 1)
      }
    }, 3000)
  }

  function removeToast(id: string) {
    const idx = toasts.value.findIndex(t => t.id === id)
    if (idx !== -1) {
      toasts.value.splice(idx, 1)
    }
  }

  /** 快捷属性编辑器状态 */
  const quickPropertyEditor = ref<{
    visible: boolean
    blockId: string
    key: string
    position: { x: number; y: number } | null
  } | null>(null)

  function showQuickPropertyEditor(
    blockId: string,
    key: string,
    position?: { x: number; y: number }
  ) {
    quickPropertyEditor.value = {
      visible: true,
      blockId,
      key,
      position: position ?? null
    }
  }

  function hideQuickPropertyEditor() {
    if (quickPropertyEditor.value) {
      quickPropertyEditor.value.visible = false
    }
  }

  return {
    activeBlockId,
    pendingCursorPos,
    pendingClickCoords,
    activeEditor,
    slashCommand,
    activateBlock,
    deactivateBlock,
    consumeCursorPos,
    setCursorPos,
    setClickCoords,
    consumeClickCoords,
    setActiveEditor,
    showSlashCommand,
    hideSlashCommand,
    updateSlashQuery,
    updateSlashSelectedIndex,
    propertyEditor,
    showPropertyEditor,
    hidePropertyEditor,
    quickPropertyEditor,
    showQuickPropertyEditor,
    hideQuickPropertyEditor,
    dateRefEditor,
    openDateRefEditor,
    closeDateRefEditor,
    toasts,
    showToast,
    removeToast,
  }
})
