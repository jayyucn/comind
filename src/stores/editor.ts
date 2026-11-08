import type { Editor } from '@tiptap/vue-3'
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import type { DateRefKind, RecurrenceRule } from '../utils/date-ref'
import { usePanesStore } from './panes'

export interface ToastMessage {
  id: string
  message: string
  type?: 'info' | 'warning' | 'error'
}

export const useEditorStore = defineStore('editor', () => {
  const activeBlockId = ref<string | null>(null)
  /**
   * 当前活动块归属的 pane id。双 pane 同页时，两个 pane 渲染同一页、块 id 完全相同，
   * 仅靠 `activeBlockId` 无法区分「哪个 pane 的该块是活动块」，会导致两边 Block 同时
   * `isActive` 并互相抢焦点（表现为「点哪个 pane，焦点都落到最后打开的那个 pane」）。
   * 见 issue：两 pane 同页点击激活错位。无 pane 上下文（测试 / 弹窗）时为 null。
   */
  const activeBlockPaneId = ref<string | null>(null)
  /** 激活后要恢复的目标光标位置（ProseMirror position），用完即清 */
  const pendingCursorPos = ref<number | null>(null)
  /** 激活后用 posAtCoords 定位的鼠标坐标，用完即清 */
  const pendingClickCoords = ref<{ x: number; y: number } | null>(null)
  /**
   * 跨块方向键导航时，激活目标块后要恢复的光标位置。
   * x = 源块光标的客户端水平坐标（保持同列）；x = null 表示不保持列——
   * 'last' 直接落行尾、'first' 落行首。line = 目标块落位行（'first'|'last'）。
   * 用完即清。优先于 pendingCursorPos/pendingClickCoords 在 focusActiveEditor 中消费。
   */
  const pendingArrowFocus = ref<{ x: number | null; line: 'first' | 'last' } | null>(null)

  /**
   * 撤销/重做恢复的选区范围。撤销要恢复的不只是「光标在哪」，还有「选中了哪段」——
   * 用户选中 D 删掉再撤销，必须回到「D 被选中」。单独一个 ref 而非复用 pendingCursorPos：
   * 后者是单点语义（点击/方向键/分块都在用），改它会污染所有既有落点。
   * 用完即清；由 focusActiveEditor 在 cursorPos 之前消费。
   */
  const pendingSelectionRange = ref<{ from: number; to: number } | null>(null)

  /**
   * 表格块「渲染态单击某格 → 激活后把光标落回该格」的交接位。
   *
   * 渲染态与编辑态在 `Block/index.vue` 里是两个 `<component>` 分支，激活会把 TableBlock
   * **重新挂载**（实测栈：`focusActiveEditor` → flushPostFlushCbs → onMounted），
   * 组件内的 ref 活不过去。而挂载时默认 `focusFirstCell()`，全靠随后的
   * `focusAtCoords` 二次兜底才回到正确格 —— 坐标一旦落空（点在格线上/表格留白里/
   * mousedown 被 preventDefault 而没记坐标），就表现为「点最后一行，光标跳到第一行」。
   * 所以坐标必须经由 store 交给新挂载的那一份。用完即清。
   */
  const pendingTableCellFocus = ref<{ blockId: string; row: number; col: number } | null>(null)
  
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
    // 记录归属 pane：双 pane 同页时块 id 相同，须靠 pane 区分「哪个 pane 的该块是活动块」，
    // 否则两个 pane 的同源块都会 isActive 并抢焦点。无 pane 上下文（测试 / 弹窗）记 null。
    const panesStore = usePanesStore()
    activeBlockPaneId.value = panesStore.activePaneId ?? null
    if (cursorPos !== undefined) {
      pendingCursorPos.value = cursorPos
    }
  }

  function deactivateBlock() {
    const prev = activeBlockId.value
    activeBlockId.value = null
    activeBlockPaneId.value = null
    // 真正失活时（点击空白等），由这里兜底清掉全局 activeEditor 与正文同步出口；
    // 跨 pane 同页的「被动取消激活」由 Block 的 watch(isActive) 守卫处理，不会清错 pane。
    activeEditor.value = null
    if (prev) registerContentFlusher(prev, null)
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

  /** 设置跨块方向键导航的光标目标（由 handleMoveUp/Down/Left/Right 触发） */
  function setArrowFocus(x: number | null, line: 'first' | 'last') {
    pendingArrowFocus.value = { x, line }
  }

  /** 消费并清除待定位的鼠标坐标 */
  function consumeClickCoords(): { x: number; y: number } | null {
    const coords = pendingClickCoords.value
    pendingClickCoords.value = null
    return coords
  }

  /** 消费并清除跨块方向键导航的光标目标 */
  function consumeArrowFocus(): { x: number | null; line: 'first' | 'last' } | null {
    const v = pendingArrowFocus.value
    pendingArrowFocus.value = null
    return v
  }

  /** 设置撤销/重做要恢复的选区范围（null = 清除） */
  function setSelectionRange(range: { from: number; to: number } | null) {
    pendingSelectionRange.value = range
  }

  /** 消费并清除待恢复的选区范围 */
  function consumeSelectionRange(): { from: number; to: number } | null {
    const range = pendingSelectionRange.value
    pendingSelectionRange.value = null
    return range
  }

  /** 设置表格块激活后要聚焦的格（由 TableBlock 渲染态单击写入） */
  function setTableCellFocus(target: { blockId: string; row: number; col: number } | null) {
    pendingTableCellFocus.value = target
  }

  /** 消费并清除待聚焦格；blockId 不符时丢弃（不让坐标落到别的表格块上） */
  function consumeTableCellFocus(blockId: string | undefined) {
    const target = pendingTableCellFocus.value
    if (!target) return null
    pendingTableCellFocus.value = null
    return blockId && target.blockId === blockId ? target : null
  }

  /**
   * 表格块激活瞬间的滚动位置交接。
   *
   * 激活会把 TableBlock 重挂载成编辑态，而编辑态首帧每一格都是 `rows="1"` 的一行高（高度全靠
   * JS 量，见 `fitRowHeights`）。块高因此在首帧从「内容实际高度」塌到「行数 × 一行高」，
   * 滚动祖先的内容高度跟着缩水，浏览器把 `scrollTop` 钳到塌陷后的上限 —— 长表格底部点一下，
   * 页面直接跳上去（实测 16 行表格：1218 → 45）。高度随后虽被重量回来，`scrollTop` 不会自己回来。
   * 所以在渲染态卸载前记下 `scrollTop`，编辑态量完高度后原样写回。用完即清。
   */
  const pendingTableScroll = ref<{ blockId: string; scrollTop: number; at: number } | null>(null)

  /** 设置表格块激活前要还原的滚动位置（由 TableBlock 渲染态卸载前写入） */
  function setTableScroll(blockId: string, scrollTop: number) {
    if (!blockId) return
    pendingTableScroll.value = { blockId, scrollTop, at: Date.now() }
  }

  /** 消费并清除待还原的滚动位置；blockId 不符或早已不是同一次激活（>1s）即丢弃 */
  function consumeTableScroll(blockId: string | undefined): number | null {
    const pending = pendingTableScroll.value
    pendingTableScroll.value = null
    if (!pending || !blockId || pending.blockId !== blockId) return null
    if (Date.now() - pending.at > 1000) return null
    return pending.scrollTop
  }

  /** 设置当前编辑器实例 */
  function setActiveEditor(editor: Editor | null) {
    activeEditor.value = editor
  }

  /**
   * 活动块「把编辑器里还没落库的正文同步进 store」的出口，由 Block 激活时注册。
   *
   * 为什么需要这道口子：打字进 store 走 300ms 防抖（`Editor.debouncedEmitSave`），而
   * `runUndoOrRedo` 是先 `commitNow` 再判 `canUndo`。不先同步，刚打完字就按 Ctrl+Z 时
   * 栈顶快照仍是旧正文 —— 新内容被判成回声丢步（按了没反应），或越过这一步多撤一次
   * （光标落到更早位置）。带 blockId 双向核对，块切换时不会误调上一个块的出口。
   */
  const contentFlusher = shallowRef<{ blockId: string; run: () => Promise<void> } | null>(null)

  /** 注册/注销正文同步出口（run 为 null 即注销，且只注销自己的） */
  function registerContentFlusher(blockId: string, run: (() => Promise<void>) | null) {
    if (run) {
      contentFlusher.value = { blockId, run }
      return
    }
    if (contentFlusher.value?.blockId === blockId) contentFlusher.value = null
  }

  /** 把指定块编辑器里的正文同步进 store（未注册或 blockId 不匹配 = no-op） */
  async function flushActiveContent(blockId: string): Promise<void> {
    const flusher = contentFlusher.value
    if (!flusher || flusher.blockId !== blockId) return
    await flusher.run()
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

  /** 字段值编辑器状态（弹出位置与 quickFieldValueEditor 同约定：来自触发元素矩形） */
  const fieldValueEditor = ref<{
    visible: boolean
    blockId: string | null
    initialKey: string | null
    position: { x: number; y: number } | null
  } | null>(null)

  function showFieldValueEditor(
    blockId: string,
    initialKey?: string,
    position?: { x: number; y: number }
  ) {
    fieldValueEditor.value = {
      visible: true,
      blockId,
      initialKey: initialKey ?? null,
      position: position ?? null
    }
  }

  function hideFieldValueEditor() {
    if (fieldValueEditor.value) {
      fieldValueEditor.value.visible = false
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

  /** 全局 BlockSelector 状态（供 /embed 命令与 EmbedRender placeholder 共用） */
  const blockSelector = ref<{
    visible: boolean
    blockId: string | null
  } | null>(null)

  function openBlockSelector(blockId: string) {
    blockSelector.value = { visible: true, blockId }
  }

  function closeBlockSelector() {
    if (blockSelector.value) {
      blockSelector.value.visible = false
    }
  }

  /**
   * 单块子树编辑弹窗（BlockModal）的全局可控入口。
   * 供主编辑器 bullet 点、列表/看板/日历卡片等多入口统一打开，
   * 取代 TaskHub 的局部 drawerBlockId ref（ADR-0039）。
   *
   * 双态（ADR-0042 T6）：活上下文弹窗完全可编辑；快照上下文（历史 ideas 页
   * 快照只读渲染，snapshotOf 非空）弹窗只读展示快照子树。
   */
  const blockModalBlockId = ref<string | null>(null)
  /** 快照上下文来源页 id：非空 = BlockModal 打开于该页的快照视图（只读模式） */
  const blockModalSnapshotOf = ref<string | null>(null)

  function openBlockModal(blockId: string, opts?: { snapshotOf?: string }) {
    blockModalBlockId.value = blockId
    blockModalSnapshotOf.value = opts?.snapshotOf ?? null
  }

  function closeBlockModal() {
    blockModalBlockId.value = null
    blockModalSnapshotOf.value = null
  }

  /**
   * 完整字段设置弹窗（ADR-0057 D1）：fieldId 非空即显示，仿 BlockModal 受控模式。
   * 入口两处（标签模板卡片 / block 字段行）经 FieldLabel emit 后由调用方调 open；
   * 弹窗关闭由 App 级监听 close 事件回写。
   */
  const fieldSettingsFieldId = ref<string | null>(null)

  function openFieldSettings(fieldId: string) {
    fieldSettingsFieldId.value = fieldId
  }

  function closeFieldSettings() {
    fieldSettingsFieldId.value = null
  }

  /** 快捷字段值编辑器状态 */
  const quickFieldValueEditor = ref<{
    visible: boolean
    blockId: string
    key: string
    position: { x: number; y: number } | null
  } | null>(null)

  function showQuickFieldValueEditor(
    blockId: string,
    key: string,
    position?: { x: number; y: number }
  ) {
    quickFieldValueEditor.value = {
      visible: true,
      blockId,
      key,
      position: position ?? null
    }
  }

  function hideQuickFieldValueEditor() {
    if (quickFieldValueEditor.value) {
      quickFieldValueEditor.value.visible = false
    }
  }

  return {
    activeBlockId,
    activeBlockPaneId,
    pendingCursorPos,
    pendingClickCoords,
    pendingArrowFocus,
    pendingSelectionRange,
    pendingTableCellFocus,
    activeEditor,
    slashCommand,
    activateBlock,
    deactivateBlock,
    consumeCursorPos,
    setCursorPos,
    setClickCoords,
    consumeClickCoords,
    setArrowFocus,
    consumeArrowFocus,
    setSelectionRange,
    consumeSelectionRange,
    setTableCellFocus,
    consumeTableCellFocus,
    setTableScroll,
    consumeTableScroll,
    setActiveEditor,
    registerContentFlusher,
    flushActiveContent,
    showSlashCommand,
    hideSlashCommand,
    updateSlashQuery,
    updateSlashSelectedIndex,
    fieldValueEditor,
    showFieldValueEditor,
    hideFieldValueEditor,
    quickFieldValueEditor,
    showQuickFieldValueEditor,
    hideQuickFieldValueEditor,
    dateRefEditor,
    openDateRefEditor,
    closeDateRefEditor,
    toasts,
    showToast,
    removeToast,
    blockSelector,
    openBlockSelector,
    closeBlockSelector,
    blockModalBlockId,
    blockModalSnapshotOf,
    openBlockModal,
    closeBlockModal,
    fieldSettingsFieldId,
    openFieldSettings,
    closeFieldSettings,
  }
})
