import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useEditorStore = defineStore('editor', () => {
  const activeBlockId = ref<string | null>(null)
  /** 激活后要恢复的目标光标位置（ProseMirror position），用完即清 */
  const pendingCursorPos = ref<number | null>(null)

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

  return { activeBlockId, pendingCursorPos, activateBlock, deactivateBlock, consumeCursorPos, setCursorPos }
})
