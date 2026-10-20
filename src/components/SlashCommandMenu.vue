<script setup lang="ts">
import type { EditorView } from '@tiptap/pm/view'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

// S6: parseDateInput migrated to Rust
// 4.2: Use Rust DateRefService instead of TS parseDateRefs
import { Icon } from '../components/Icons'
import { useModalKeyboardRef } from '../composables/useModalKeyboard'
import { buildTemplateCommands, executeTemplateCommand, filterCommands, groupCommands, parseCommandInput, useSlashCommands } from '../composables/useSlashCommands'
import { useTemplateRegistry } from '../composables/useTemplateRegistry'
import { useBlockCardStore } from '../stores/blockCard'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { useFieldValueStore } from '../stores/fieldValue'
import { useUserTemplatesStore } from '../stores/user-templates'
import type { Command } from '../types/command'
import { getCoreClient } from '../wasm/client'
import BasePopover from './common/BasePopover.vue'
import ConfirmDialog from './ConfirmDialog.vue'

const editorStore = useEditorStore()
const fieldValueStore = useFieldValueStore()
const blockStore = useBlockStore()
const blockCardStore = useBlockCardStore()
const { commands } = useSlashCommands()
const templateRegistry = useTemplateRegistry()
const userTemplatesStore = useUserTemplatesStore()
const templateCommands = ref<Command[]>([])

onMounted(async () => {
  await templateRegistry.loadAll()
  templateCommands.value = buildTemplateCommands()
})

// 本地状态
const visible = ref(false)
const query = ref('')
const selectedIndex = ref(0)
const position = ref({ x: 0, y: 0 })
const range = ref<{ from: number; to: number } | null>(null)
const listRef = ref<HTMLElement | null>(null)

// 锚点（ADR-0038）：斜杠面板跟随光标。光标是 ProseMirror 文本位置，没有稳定 DOM
// 引用，故在触发瞬间记录 view+pos，由 anchorElProp getter 实时反查光标所在元素——
// 滚动/布局变动时 BasePopover 会重新测算，面板始终贴着输入框而不会遮住光标。
const anchorView = shallowRef<EditorView | null>(null)
const anchorPos = ref(0)

// 删除模板确认弹窗状态（原生 window.confirm/alert 已替换为 Vue 弹窗）
const pendingDeleteTemplateId = ref<string | null>(null)
const showBuiltinDeleteAlert = ref(false)

// 子视图状态
const isTemplateListView = ref(false)
const templateListData = computed(() => templateRegistry.all.value)

// 注册模态键盘拦截层（基于 visible 状态）
// visible = true 时 push 到 modalStack，visible = false 时 pop
useModalKeyboardRef('slash-command', visible)

// 合并基础命令 + 模板命令
const allCommands = computed(() => [...commands, ...templateCommands.value])

// 过滤后的命令
const filteredCommands = computed(() => {
  return filterCommands(query.value, allCommands.value)
})

// 分组后的命令
const groupedCommands = computed(() => {
  return groupCommands(filteredCommands.value)
})

// 扁平化的命令列表（用于键盘导航，必须与 groupedCommands 渲染顺序一致）
const flatCommands = computed(() => {
  const result: Command[] = []
  for (const [, cmds] of groupedCommands.value) {
    result.push(...cmds)
  }
  return result
})

// 监听 slash-command-trigger 事件
function handleSlashCommandTrigger(event: Event) {
  const customEvent = event as CustomEvent<{
    view: EditorView
    position: number
    range: { from: number; to: number }
  }>

  const { position: pos, range: r } = customEvent.detail

  // 去重守卫：面板已打开且锚点（同一编辑器同一位置）未变时忽略重复触发。
  // 键入 `/` 本身会先后触发 handleTextInput 与 extension view.update 的光标检测，
  // 不去重会把刚同步的 query 重置掉。
  const view = customEvent.detail.view
  if (visible.value && anchorView.value === view && anchorPos.value === pos) {
    return
  }

  // 获取光标位置（屏幕坐标）
  const coords = view.coordsAtPos(pos)

  visible.value = true
  position.value = { x: coords.left, y: coords.bottom + 8 }
  anchorView.value = view
  anchorPos.value = pos
  range.value = r
  query.value = ''
  // 面板打开即选中第一项，回车直接执行
  selectedIndex.value = 0
}

// 由 ProseMirror 文本位置反查光标所在 DOM 元素，作为 BasePopover 的避让锚点。
// 文本节点取其父元素；元素节点直接用。失败（如 view 无 domAtPos）则回退到 position 模式。
function anchorFromView(view: EditorView, pos: number): HTMLElement | null {
  try {
    const { node } = view.domAtPos(pos)
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
    return el ?? null
  } catch {
    return null
  }
}

// 锚点 getter（ADR-0038）：未触发时返回 undefined，BasePopover 走 position 兜底；
// 触发后返回一个每次重新反查光标的 getter，使滚动时面板实时跟随而不遮挡输入框。
const anchorElProp = computed<HTMLElement | (() => HTMLElement | null) | undefined>(() => {
  const view = anchorView.value
  return view ? () => anchorFromView(view, anchorPos.value) : undefined
})

// 监听键盘事件
function handleKeyDown(event: KeyboardEvent) {
  if (!visible.value) return
  // IME 组合期一律不接管：组合中的文本尚未进入文档，query 解析为空，
  // 此时回车会落到候选列表首项（/time）而把当前时间插进块里（#122）。
  // 组合键（含确认候选词的回车）交还输入法，组合结束后由 compositionend 同步 query。
  if (event.isComposing || event.keyCode === 229) return

  // 子视图（template list）使用 templateListData 而非 flatCommands
  const listLength = isTemplateListView.value
    ? templateListData.value.length
    : flatCommands.value.length

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      if (listLength === 0) return
      selectedIndex.value = (selectedIndex.value + 1) % listLength
      break
    case 'ArrowUp':
      event.preventDefault()
      if (listLength === 0) return
      selectedIndex.value = selectedIndex.value <= 0
        ? listLength - 1
        : selectedIndex.value - 1
      break
    case 'Enter':
      event.preventDefault()
      if (isTemplateListView.value) {
        const t = templateListData.value[selectedIndex.value]
        if (t) {
          void useTemplateFromList(t.id)
        }
      } else {
        // 强制从当前编辑器同步 query：避免依赖 editor.on('update') 的绑定时机。
        // 同步失败（range 失效 / 编辑器已替换 / 命令文本已不是 '/' 开头）时绝不回车执行——
        // 无法确认命令文本时只关面板（syncQuery 内部已 close，这里再兜底一次）。
        if (!syncQuery()) {
          close()
          break
        }
        const cmd = flatCommands.value[selectedIndex.value]
        if (cmd) {
          void executeCommand(cmd)
        }
      }
      break
    case 'Backspace':
      if (query.value === '') {
        close()
      } else {
        query.value = query.value.slice(0, -1)
      }
      break
    case 'Escape':
      event.preventDefault()
      close()
      break
  }
}

/**
 * 从当前编辑器同步查询文本，返回 false 表示命令文本无法确认。
 *
 * 取 range.from（'/' 所在位置）到光标的整段文本并要求其以 '/' 开头：
 * 这样 range 失效（编辑器被替换 / 位置漂移）时能当场识别，而不是把空字符串
 * 当成「无过滤」静默放大成全部命令。光标移到 '/' 之前或文本不再以 '/' 开头
 * （即光标离开了 '/' 右侧）⇒ 关闭面板，维持「光标在 '/' 右侧 ⇔ 面板打开」不变式。
 */
function syncQuery(): boolean {
  if (!visible.value || !range.value) return false

  const editor = editorStore.activeEditor
  if (!editor) return false

  const { from } = editor.state.selection
  const startPos = range.value.from
  if (from < startPos) {
    close()
    return false
  }

  const textWithSlash = editor.state.doc.textBetween(startPos, from)
  if (!textWithSlash.startsWith('/')) {
    close()
    return false
  }

  const newQuery = textWithSlash.slice(1)

  // 只在 query 实际变化时重置选中索引（避免 ArrowDown 等非文本操作触发重置）；
  // query 变化后重新回到第一项
  if (newQuery !== query.value) {
    query.value = newQuery
    selectedIndex.value = 0
  }

  // 检测 /template list 切换到模板子视图
  isTemplateListView.value = query.value.trim() === 'template list'
  return true
}

/** 编辑器 update / selectionUpdate / compositionend 回调：光标离开 '/' 右侧时由 syncQuery 关闭面板。 */
function updateQuery() {
  syncQuery()
}

// 执行命令
async function executeCommand(command: Command) {
  const editor = editorStore.activeEditor
  if (!editor || !range.value) return

  const blockId = editorStore.activeBlockId

  // 模板命令特殊处理
  if (command.id.startsWith('template:')) {
    const templateId = command.id.slice('template:'.length)
    await executeTemplateCommand(blockId ?? undefined, templateId, editor, range.value ?? { from: 0, to: 0 })
    close()
    return
  }

  // 解析命令和参数
  const { argument } = parseCommandInput(query.value)

  // 计算完整的要删除的范围（从 / 字符开始到当前光标位置）
  const fullDeleteRange = {
    from: range.value.from,
    to: editor.state.selection.from
  }

  // 记录光标应该恢复到的位置（/ 符号之前）
  const cursorPosition = range.value.from

  // 关闭面板
  close()

  // 先清除斜杠命令文本，并将光标恢复到 / 符号之前的位置
  editor.chain()
    .deleteRange(fullDeleteRange)
    .setTextSelection(cursorPosition)
    .focus()
    .run()

  // 处理字段值命令
  if (command.fieldKey && blockId) {
    // 清除字段值（如 /clear-priority 删除 priority）
    if (command.clearFieldValue) {
      const target = fieldValueStore
        .getBlockFieldValues(blockId)
        .find(fv => fv.key === command.fieldKey)
      if (target) {
        await fieldValueStore.deleteFieldValue(target.id, blockId)
      }
      // 字段值已变更：刷新块卡片投影，让任务中心（四象限/看板等）即时反映（#midium 类回归）
      await blockCardStore.getCards()
      return
    }

    // 立即执行设置字段值（如 /todo, /done、/high、/medium、/low 等）
    if (command.immediate && command.fieldValue) {
      await fieldValueStore.setFieldValue(
        blockId,
        command.fieldKey,
        command.fieldValue as string
      )
      // status ↔ priority 成对（/low 补默认 Todo、/todo 补默认 Low）由
      // fieldValueStore.setFieldValue 写入收口统一处理；此处只管设值 + 刷投影，
      // 不自动挂 #任务 tag（打标仅属于 ensureTodo 的显式任务路径）。
      // 字段值已变更：刷新块卡片投影
      await blockCardStore.getCards()
      return
    }

    // 接受参数的命令（如 /deadline 2024-05-20, /project 项目A）
    if (command.acceptArgument && argument) {
      let value: string = argument

      // 对于日期类型进行特殊处理
      if (command.fieldKey === 'deadline' || command.fieldKey === 'scheduled') {
        const parsedDate = await getCoreClient()!.parseDateInput(argument)
        if (parsedDate) {
          value = parsedDate
        }
      }

      await fieldValueStore.setFieldValue(
        blockId,
        command.fieldKey,
        value
      )
      // 字段值已变更：刷新块卡片投影
      await blockCardStore.getCards()
      return
    }

    // 打开编辑器（如 /status, /priority, /deadline 不带参数）
    if (command.openEditor) {
      editorStore.showQuickFieldValueEditor(blockId, command.fieldKey, position.value)
      return
    }
  }

  // 特殊处理「新增字段值」命令
  if (command.id === 'field_value') {
    if (blockId) {
      editorStore.showFieldValueEditor(blockId, undefined, position.value)
    }
    return
  }

  // 处理 /embed — 打开全局 BlockSelector，选完源 block 后再一次性转类型 + 写属性
  if (command.id === 'embed' && blockId) {
    editorStore.openBlockSelector(blockId)
    return
  }

  // 处理 convertBlockType（如 /image 转为 image 类型）
  if (command.convertBlockType && blockId) {
    command.action({
      editor,
      range: { from: cursorPosition, to: cursorPosition },
      blockId
    })
    return
  }

  // 处理 /schedule 和 /deadline — 打开 DateTimePickerPanel
  if (command.id === 'schedule' || command.id === 'deadline') {
    const kind = command.id as 'schedule' | 'deadline'
    
    if (blockId) {
      const block = blockStore.blocks.find(b => b.id === blockId)
      if (block) {
        // 4.2: Use Rust DateRefService instead of TS parseDateRefs
        const client = getCoreClient()
        if (!client) return
        const existingRefs = await client.getDateRefsByBlock(block.id)
        const hasSameKind = existingRefs.some(r => r.kind === kind)
        if (hasSameKind) {
          const kindLabel = kind === 'schedule' ? '计划时间' : '截止时间'
          const toastStr = `该任务已有${kindLabel}${kind === 'schedule' ? '，如需重复请使用重复规则' : ''}`
          editorStore.showToast(toastStr, 'warning')
          close()
          return
        }
      }
    }
    
    const rect = new DOMRect(position.value.x, position.value.y, 0, 0)
    editorStore.openDateRefEditor({
      blockId: blockId ?? null,
      from: cursorPosition,
      to: cursorPosition,
      source: 'editor',
      kind,
      iso: new Date().toISOString().slice(0, 10),
      recurrence: 'none',
      position: { x: rect.left, y: rect.bottom + 6 },
    })
    return
  }

  // 执行普通命令（如 /time, /date 等）
  // 此时文本已经被清除，光标在 / 符号之前的位置
  // 让命令自己决定如何插入内容
  command.action({
    editor,
    range: { from: cursorPosition, to: cursorPosition },
    blockId: blockId ?? undefined
  })
}

// 关闭面板
function close() {
  visible.value = false
  query.value = ''
  selectedIndex.value = 0
  range.value = null
  isTemplateListView.value = false
}

// 点击外部关闭：BasePopover 已提供 overlay 点击 + Escape 关闭，无需自行处理

function isSvgIcon(icon: string): boolean {
  return icon.startsWith('status-') || icon.startsWith('priority-') || icon.startsWith('icon-')
}

// 从子视图应用模板
async function useTemplateFromList(templateId: string) {
  const blockId = editorStore.activeBlockId
  const editor = editorStore.activeEditor
  if (!editor) return
  const r = range.value ?? { from: 0, to: 0 }
  await executeTemplateCommand(blockId ?? undefined, templateId, editor, r)
  close()
}

// 从子视图删除用户模板（改为 Vue 弹窗，原生 window.confirm/alert 已移除）
function deleteTemplateFromList(templateId: string) {
  if (!templateId.startsWith('user:')) {
    // 内置模板：信息提示。先关闭菜单，让提示弹窗能正常置顶显示。
    showBuiltinDeleteAlert.value = true
    close()
    return
  }
  // 用户模板：弹出 danger 确认框。先关闭菜单，让确认弹窗能正常置顶显示。
  pendingDeleteTemplateId.value = templateId
  close()
}

async function confirmDeleteTemplate() {
  const templateId = pendingDeleteTemplateId.value
  if (!templateId) return
  const id = templateId.slice('user:'.length)
  await userTemplatesStore.remove(id)
  await templateRegistry.loadAll()
  templateCommands.value = buildTemplateCommands()
  pendingDeleteTemplateId.value = null
}

function cancelDeleteTemplate() {
  pendingDeleteTemplateId.value = null
}

// 监听编辑器更新（用于实时更新查询）
let editorUpdateListener: (() => void) | null = null
// 记录实际绑定的编辑器与其 DOM：解绑必须回到同一实例（activeEditor 可能已被换掉）
let boundEditor: typeof editorStore.activeEditor = null
let boundEditorDom: HTMLElement | null = null

function bindEditorUpdate() {
  // 先解绑旧监听，避免 activeEditor 变更后重复绑定导致泄漏
  if (editorUpdateListener) {
    unbindEditorUpdate()
  }

  const editor = editorStore.activeEditor
  if (!editor) return

  editorUpdateListener = () => {
    updateQuery()
  }

  // update：doc 变化（输入/删除命令文本）；selectionUpdate：纯光标移动（点击/方向键
  // 离开 '/' 右侧时同步关闭面板）。二者共用同一回调，syncQuery 幂等。
  editor.on('update', editorUpdateListener)
  editor.on('selectionUpdate', editorUpdateListener)

  // IME 组合结束：组合文本此刻才进入文档（组合期 update 不含它），需立即同步 query，
  // 否则中文输入法下输入命令字母时列表一直是全量、回车即命中首项 /time（#122）。
  const dom = editor.view?.dom as HTMLElement | undefined
  if (dom) {
    dom.addEventListener('compositionend', editorUpdateListener)
    boundEditorDom = dom
  }
  boundEditor = editor
}

function unbindEditorUpdate() {
  if (!editorUpdateListener) return
  if (boundEditor) {
    boundEditor.off?.('update', editorUpdateListener)
    boundEditor.off?.('selectionUpdate', editorUpdateListener)
  }
  if (boundEditorDom) {
    boundEditorDom.removeEventListener('compositionend', editorUpdateListener)
  }
  boundEditor = null
  boundEditorDom = null
  editorUpdateListener = null
}

onMounted(() => {
  // 监听 slash-command-trigger 事件
  document.addEventListener('slash-command-trigger', handleSlashCommandTrigger as EventListener)

  // 监听键盘事件
  document.addEventListener('keydown', handleKeyDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('slash-command-trigger', handleSlashCommandTrigger as EventListener)
  document.removeEventListener('keydown', handleKeyDown)

  unbindEditorUpdate()
})

// 自动滚动到选中项
function scrollToSelected() {
  nextTick(() => {
    if (!listRef.value || !flatCommands.value.length) return
    
    const items = listRef.value.querySelectorAll('.slash-command-item')
    const selectedItem = items[selectedIndex.value] as HTMLElement | undefined
    
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' })
    }
  })
}

// 监听 selectedIndex 变化，自动滚动
watch(selectedIndex, () => {
  if (visible.value) {
    scrollToSelected()
  }
})

// 监听 visible 变化，统一处理编辑器更新和 store 状态
watch(visible, (isVisible) => {
  if (isVisible) {
    bindEditorUpdate()
    if (range.value) {
      editorStore.showSlashCommand(position.value, range.value)
    }
    // 初始滚动
    nextTick(scrollToSelected)
  } else {
    unbindEditorUpdate()
    editorStore.hideSlashCommand()
  }
})

// 触发瞬间 activeEditor 可能尚未就绪（如新建空块后立即输入 '/'，
// setActiveEditor 晚一拍才执行），导致 bindEditorUpdate 拿不到 editor、
// 未能绑定 update 监听，query 永远为空 → 回车选中第一个命令 time 并插入当前时间。
// activeEditor 就绪后重新绑定监听器，使菜单在输入时正常过滤。
watch(
  () => editorStore.activeEditor,
  () => {
    if (visible.value) bindEditorUpdate()
  }
)
</script>

<template>
  <BasePopover
    :visible="visible"
    :position="position"
    :anchor-el="anchorElProp || null"
    placement="bottom"
    @close="close"
  >
    <div class="slash-command-menu">
      <div
        ref="listRef"
        class="slash-command-list"
      >
        <template v-if="isTemplateListView">
          <div class="slash-command-group">
            <div class="slash-command-group-title">
              我的模板（点击使用）
            </div>
            <div
              v-for="(t, idx) in templateListData"
              :key="t.id"
              class="slash-command-item template-item"
              :class="{ selected: idx === selectedIndex }"
              @click="useTemplateFromList(t.id)"
              @mouseenter="selectedIndex = idx"
            >
              <span class="template-icon">{{ t.icon }}</span>
              <span class="template-name">{{ t.name }}</span>
              <span class="template-source">[{{ t.source === 'builtin' ? '内置' : '我的' }}]</span>
              <button
                v-if="t.source === 'user'"
                class="template-delete"
                @click.stop="deleteTemplateFromList(t.id)"
              >
                ×
              </button>
            </div>
          </div>
        </template>
        <template v-else>
          <template
            v-for="[group, cmds] in groupedCommands"
            :key="group"
          >
            <div class="slash-command-group">
              <div class="slash-command-group-title">
                {{ group }}
              </div>
              <div
                v-for="cmd in cmds"
                :key="cmd.id"
                class="slash-command-item"
                :class="{ selected: flatCommands.indexOf(cmd) === selectedIndex }"
                @click="executeCommand(cmd)"
                @mouseenter="selectedIndex = flatCommands.indexOf(cmd)"
              >
                <span class="slash-command-icon">
                  <Icon
                    v-if="isSvgIcon(cmd.icon)"
                    :name="cmd.icon"
                    :size="16"
                  />
                  <span v-else>{{ cmd.icon }}</span>
                </span>
                <span class="slash-command-name">{{ cmd.name }}</span>
                <span
                  v-if="cmd.alias && cmd.alias.length > 0"
                  class="slash-command-alias"
                >
                  {{ cmd.alias[0] }}
                </span>
              </div>
            </div>
          </template>
        </template>

        <div
          v-if="flatCommands.length === 0 && !isTemplateListView"
          class="slash-command-empty"
        >
          无匹配命令
        </div>
      </div>
    </div>
  </BasePopover>

  <!-- 内置模板不可删除：信息提示型弹窗（hideCancel 单按钮） -->
  <ConfirmDialog
    :visible="showBuiltinDeleteAlert"
    title="提示"
    message="内置模板不可删除"
    confirm-text="我知道了"
    :hide-cancel="true"
    @confirm="showBuiltinDeleteAlert = false"
    @cancel="showBuiltinDeleteAlert = false"
  />

  <!-- 删除用户模板确认 -->
  <ConfirmDialog
    :visible="!!pendingDeleteTemplateId"
    title="删除模板"
    message="确定要删除该模板吗？此操作不可撤销。"
    confirm-text="删除"
    danger
    @confirm="confirmDeleteTemplate"
    @cancel="cancelDeleteTemplate"
  />
</template>

<style scoped>
.slash-command-menu {
  width: var(--panel-width-sm);
  max-height: 640px;
  overflow: hidden;
}

.slash-command-list {
  overflow-y: auto;
  max-height: 640px;
}

.slash-command-group {
  padding: 4px 0;
}

.slash-command-group-title {
  padding: 6px 12px;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: var(--letter-wide-2);
}

.slash-command-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.slash-command-item.selected {
  background: var(--accent-subtle, rgba(180, 83, 9, 0.08));
  border-left: 2px solid var(--accent, #B45309);
  padding-left: 10px;
}

.slash-command-item:hover {
  background: var(--bg-hover, #F5F5F4);
}

.slash-command-item.selected:hover {
  background: var(--accent-subtle, rgba(180, 83, 9, 0.08));
}

.slash-command-icon {
  font-size: var(--heading-5);
  width: 20px;
  text-align: center;
}

.slash-command-name {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.slash-command-alias {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.slash-command-empty {
  padding: 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.template-icon {
  font-size: var(--heading-5);
  width: 20px;
  text-align: center;
}

.template-name {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.template-source {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.template-delete {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--text-sm);
  line-height: var(--leading-none);
  padding: 0;
}

.template-delete:hover {
  color: #dc2626;
}
</style>
