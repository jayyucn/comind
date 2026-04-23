<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useEditorStore } from '../stores/editor'
import { useSlashCommands, filterCommands, groupCommands } from '../composables/useSlashCommands'
import { useModalKeyboardRef } from '../composables/useModalKeyboard'
import type { Command } from '../types/command'

const editorStore = useEditorStore()
const { commands } = useSlashCommands()

// 本地状态
const visible = ref(false)
const query = ref('')
const selectedIndex = ref(0)
const position = ref({ x: 0, y: 0 })
const range = ref<{ from: number; to: number } | null>(null)

// 注册模态键盘拦截层（基于 visible 状态）
// visible = true 时 push 到 modalStack，visible = false 时 pop
useModalKeyboardRef('slash-command', visible)

// 过滤后的命令
const filteredCommands = computed(() => {
  return filterCommands(query.value, commands)
})

// 分组后的命令
const groupedCommands = computed(() => {
  return groupCommands(filteredCommands.value)
})

// 扁平化的命令列表（用于键盘导航）
const flatCommands = computed(() => {
  return filteredCommands.value
})

// 监听 slash-command-trigger 事件
function handleSlashCommandTrigger(event: Event) {
  const customEvent = event as CustomEvent<{
    view: any
    position: number
    range: { from: number; to: number }
  }>

  const { position: pos, range: r } = customEvent.detail

  // 获取光标位置（屏幕坐标）
  const view = customEvent.detail.view
  const coords = view.coordsAtPos(pos)

  visible.value = true
  position.value = { x: coords.left, y: coords.bottom + 8 }
  range.value = r
  query.value = ''
  selectedIndex.value = 0
}

// 监听键盘事件
function handleKeyDown(event: KeyboardEvent) {
  if (!visible.value) return

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      selectedIndex.value = (selectedIndex.value + 1) % flatCommands.value.length
      break
    case 'ArrowUp':
      event.preventDefault()
      selectedIndex.value = selectedIndex.value === 0
        ? flatCommands.value.length - 1
        : selectedIndex.value - 1
      break
    case 'Enter':
      event.preventDefault()
      if (flatCommands.value[selectedIndex.value]) {
        executeCommand(flatCommands.value[selectedIndex.value])
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

// 监听输入更新查询
function handleInput() {
  if (!visible.value || !range.value) return

  const editor = editorStore.activeEditor
  if (!editor) return

  // 获取当前光标位置后的文本（range.to 是 / 字符之后的位置）
  const { from } = editor.state.selection
  const startPos = range.value.to
  const textAfterSlash = editor.state.doc.textBetween(startPos, from)

  query.value = textAfterSlash

  // 重置选中索引
  selectedIndex.value = 0
}

// 执行命令
function executeCommand(command: Command) {
  const editor = editorStore.activeEditor
  if (!editor || !range.value) return

  const currentRange = {
    from: range.value.from,
    to: editor.state.selection.from
  }

  // 关闭面板
  close()

  // 执行命令
  command.action({
    editor,
    range: currentRange
  })
}

// 关闭面板
function close() {
  visible.value = false
  query.value = ''
  selectedIndex.value = 0
  range.value = null
}

// 点击外部关闭
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.slash-command-menu')) {
    close()
  }
}

onMounted(() => {
  // 监听 slash-command-trigger 事件
  document.addEventListener('slash-command-trigger', handleSlashCommandTrigger as EventListener)

  // 监听键盘事件
  document.addEventListener('keydown', handleKeyDown)

  // 监听点击外部
  document.addEventListener('click', handleClickOutside)

  // 监听编辑器输入
  document.addEventListener('input', handleInput)
})

onBeforeUnmount(() => {
  document.removeEventListener('slash-command-trigger', handleSlashCommandTrigger as EventListener)
  document.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('input', handleInput)
})

// 监听 visible 变化，更新 store
watch(visible, (newVal) => {
  if (newVal && range.value) {
    editorStore.showSlashCommand(position.value, range.value)
  } else {
    editorStore.hideSlashCommand()
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade-slide">
      <div
        v-if="visible"
        class="slash-command-menu"
        :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      >
        <div class="slash-command-list">
          <template v-for="[group, cmds] in groupedCommands" :key="group">
            <div class="slash-command-group">
              <div class="slash-command-group-title">{{ group }}</div>
              <div
                v-for="cmd in cmds"
                :key="cmd.id"
                class="slash-command-item"
                :class="{ selected: flatCommands.indexOf(cmd) === selectedIndex }"
                @click="executeCommand(cmd)"
                @mouseenter="selectedIndex = flatCommands.indexOf(cmd)"
              >
                <span class="slash-command-icon">{{ cmd.icon }}</span>
                <span class="slash-command-name">{{ cmd.name }}</span>
                <span v-if="cmd.alias && cmd.alias.length > 0" class="slash-command-alias">
                  {{ cmd.alias[0] }}
                </span>
              </div>
            </div>
          </template>

          <div v-if="flatCommands.length === 0" class="slash-command-empty">
            无匹配命令
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.slash-command-menu {
  position: fixed;
  z-index: 1000;
  width: 280px;
  max-height: 320px;
  background: var(--bg-base, #FAFAF8);
  border: 1px solid var(--border, #E7E5E4);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(28, 25, 23, 0.08);
  overflow: hidden;
}

.slash-command-list {
  overflow-y: auto;
  max-height: 320px;
}

.slash-command-group {
  padding: 4px 0;
}

.slash-command-group-title {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted, #78716C);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.slash-command-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s ease;
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
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.slash-command-name {
  flex: 1;
  font-size: 14px;
  color: var(--text-base, #1C1917);
}

.slash-command-alias {
  font-size: 12px;
  color: var(--text-muted, #78716C);
}

.slash-command-empty {
  padding: 16px;
  text-align: center;
  color: var(--text-muted, #78716C);
  font-size: 14px;
}

/* 动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
