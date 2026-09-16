import type { Component } from 'vue'
import type { Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { Block } from './block'

export interface BlockTypeHandler {
  type: string
  label: string
  editorComponent: Component
  renderComponent: Component
  /** 类型特化钩子，可选。返回该类型实例需要的事件处理器 */
  setupBlock?: (ctx: BlockSetupContext) => BlockTypeHooks | void
}

/** handler 内实际用到的 store 最小接口（避免 types ↔ stores 循环类型依赖） */
export interface BlockStoreLike {
  updateBlockContent: (blockId: string, content: string) => Promise<void>
}

export interface PageStoreLike {
  /** handler 仅按 id 查页并读取标题（embed 跳转源页） */
  pages: Array<{ id: string; title: string }>
}

export interface BlockSetupContext {
  blockId: Ref<string>
  block: Ref<Block>
  pageId: string
  getProperty: (key: string) => string | undefined
  getPropertiesMap: () => Record<string, unknown>
  setProperty: (key: string, value: unknown) => Promise<void>
  // Store 采用最小接口 / unknown 收窄，避免 types 文件与 stores 之间潜在的循环类型依赖。
  // handler 内部仅调用已知方法（blockStore.updateBlockContent / pageStore.pages 等）。
  blockStore: BlockStoreLike
  editorStore: unknown
  propertyStore: unknown
  pageStore: PageStoreLike
  navigateToPage: (title: string) => Promise<void>
}

export interface BlockTypeHooks {
  onMounted?: () => void
  onBeforeUnmount?: () => void
  onTypeChanged?: (newType: string, oldType: string) => void
  /** return true 阻止 index.vue 默认 mousedown 行为 */
  onContentMousedown?: (e: MouseEvent) => boolean | void
  /** return true 阻止 index.vue 默认 click 行为 */
  onContentClick?: (e: MouseEvent) => boolean | void
  onLanguageChange?: (lang: string) => Promise<void>
  /** return true 阻止默认 dragover 行为 */
  onDragOver?: (e: DragEvent) => boolean | void
  /** return true 阻止默认 drop 行为 */
  onDrop?: (e: DragEvent) => boolean | void | Promise<boolean | void>
  onPaste?: (e: ClipboardEvent) => boolean | void | Promise<boolean | void>
}

export interface BlockTypeEditorExposed {
  syncContent: (content: string, cursorPos?: number) => void
  focus: (pos?: number | 'start' | 'end') => void
  getText: () => string
  markSaved: () => void
  getEditor: () => Editor
  cancelDebouncedSave?: () => void
  focusAtCoords?: (x: number, y: number) => void
}

export interface BlockTypeRenderExposed {
  content: string
  showPlaceholder?: boolean
}
