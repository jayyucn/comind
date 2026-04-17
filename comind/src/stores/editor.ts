import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useEditorStore = defineStore('editor', () => {
  const activeBlockId = ref<string | null>(null)

  async function activateBlock(blockId: string) {
    // 已有活跃 Block 时先失活
    if (activeBlockId.value && activeBlockId.value !== blockId) {
      activeBlockId.value = null
    }
    activeBlockId.value = blockId
  }

  function deactivateBlock() {
    activeBlockId.value = null
  }

  return { activeBlockId, activateBlock, deactivateBlock }
})
