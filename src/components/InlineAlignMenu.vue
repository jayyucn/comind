<script setup lang="ts">
import { BLOCK_ALIGN_OPTIONS, type BlockAlign } from '../utils/block-align'
import FloatingSubmenu from './common/FloatingSubmenu.vue'

/**
 * 对齐方式下拉：表格选区浮层与正文文本工具条共用同一个。
 *
 * 两处以前各写一套（表格一份、正文没有），文案/图标/激活态/收起规则全靠人肉对齐。
 * 现在选项来自 `utils/block-align`，定位与 Esc 来自 `FloatingSubmenu`，
 * 这里只剩「画三个按钮」。
 */
const props = defineProps<{
  open: boolean
  /** 触发按钮（工具条上的对齐按钮） */
  anchor: HTMLElement | null
  /** 当前生效的对齐；表格按选区合并、正文按块 */
  current: BlockAlign
  /**
   * 归属句柄：外层浮层要豁免「点二级算不算点外面」时用。
   * 表格把 blockId 传进来，正文工具条不需要（它没有外层 overlay）。
   */
  menuId?: string
}>()

const emit = defineEmits<{
  (e: 'pick', value: BlockAlign): void
  (e: 'close'): void
}>()
</script>

<template>
  <FloatingSubmenu
    :open="props.open"
    :anchor="props.anchor"
    :menu-id="props.menuId"
    @close="emit('close')"
  >
    <div
      class="align-menu"
      @mousedown.prevent
    >
      <button
        v-for="option in BLOCK_ALIGN_OPTIONS"
        :key="option.value"
        type="button"
        class="align-item"
        :class="{ 'is-on': props.current === option.value }"
        :aria-label="option.label"
        @click="emit('pick', option.value)"
      >
        <component
          :is="option.icon"
          :size="13"
          :stroke-width="2"
        />{{ option.label }}
      </button>
    </div>
  </FloatingSubmenu>
</template>

<style scoped>
/* 面板本体：面皮在 FloatingSubmenu（与 BasePopover 同源），这里只管排版 */
.align-menu {
  display: flex;
  flex-direction: column;
  min-width: 118px;
  padding: 4px;
}

.align-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-xs);
  line-height: 1.5;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.align-item:not(:disabled):hover {
  background: var(--accent-subtle);
  color: var(--accent);
}

.align-item.is-on {
  background: var(--accent-subtle);
  color: var(--accent);
}
</style>
