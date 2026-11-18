<script setup lang="ts">
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  Eraser,
  IndentDecrease,
  IndentIncrease,
  Scissors,
  Trash2,
} from 'lucide-vue-next'

import type { Block } from '../../../types/block'
import BlockMenuItem from '../../common/BlockMenuItem.vue'
import { useBlockMenuActions } from '../composables/useBlockMenuActions'

/**
 * 块入口菜单的**通用段**：上下插入 | 缩进 / 减少缩进 | 复制 / 剪切 / 粘贴 |
 * 重置为文本块 | 删除。
 *
 * 顺序与分组只在这一次定义。类型专属项（表格的「首行表头」「均分列宽」）写在它**前面**，
 * 所以通用段自带一条前置分隔线；`noDividerTop` 给「前面什么都没有」的类型用
 * （否则菜单顶部会多出一条没头没尾的线）。
 *
 * 分组按「改结构 → 改层级 → 搬内容 → 改/删自身」走，越往下越不可逆：重置与删除各自
 * 独占一组，隔一条线 —— 两者都真的删东西（重置 = 删块 + 原地新建，撤销栈兜底），
 * 挨在一起只差一次误点。
 *
 * 动作与菜单关闭是分开的两件事：本组件只管把点击转发给 `useBlockMenuActions`，
 * 关闭浮层由 `close` 事件交给 handler —— 浮层归 handler 持有（它的锚点是外壳渲染的图标）。
 */
const props = defineProps<{
  blockId?: string
  /**
   * 通用段独占整个菜单（前面没有类型专属项）时置 true，省掉前置分隔线。
   * 刻意用「反向」布尔：Vue 会把**省略**的 boolean prop 转成 false，
   * 若写成 `dividerTop`（缺省应为 true），table 不传就会静默丢线。
   */
  noDividerTop?: boolean
  /** 类型专属的粘贴收尾（query 块克隆命名视图用） */
  afterPaste?: (created: Block[], sourceIds: string[]) => void | Promise<void>
}>()

const emit = defineEmits<{ close: [] }>()

const {
  canIndent,
  canOutdent,
  insertBlockAbove,
  insertBlockBelow,
  indentBlock,
  outdentBlock,
  copyBlock,
  cutBlock,
  pasteBlock,
  resetToTextBlock,
  deleteBlock,
} = useBlockMenuActions(() => props.blockId, { afterPaste: (...args) => props.afterPaste?.(...args) })

/** 先关菜单再执行：删除菜单所属的块时，浮层不该比块多活一帧 */
function run(action: () => void | Promise<void>) {
  emit('close')
  void action()
}
</script>

<template>
  <span
    v-if="!noDividerTop"
    class="menu-sep"
  />
  <BlockMenuItem
    data-block-menu-item="insert-above"
    :icon="ArrowUpToLine"
    label="上方插入"
    @click="run(insertBlockAbove)"
  />
  <BlockMenuItem
    data-block-menu-item="insert-below"
    :icon="ArrowDownToLine"
    label="下方插入"
    @click="run(insertBlockBelow)"
  />

  <span class="menu-sep" />

  <BlockMenuItem
    data-block-menu-item="indent"
    :icon="IndentIncrease"
    label="增加缩进"
    :disabled="!canIndent"
    @click="run(indentBlock)"
  />
  <BlockMenuItem
    data-block-menu-item="outdent"
    :icon="IndentDecrease"
    label="减少缩进"
    :disabled="!canOutdent"
    @click="run(outdentBlock)"
  />

  <span class="menu-sep" />

  <BlockMenuItem
    data-block-menu-item="copy"
    :icon="Copy"
    label="复制"
    @click="run(copyBlock)"
  />
  <BlockMenuItem
    data-block-menu-item="cut"
    :icon="Scissors"
    label="剪切"
    @click="run(cutBlock)"
  />
  <BlockMenuItem
    data-block-menu-item="paste"
    :icon="ClipboardPaste"
    label="粘贴"
    @click="run(pasteBlock)"
  />

  <span class="menu-sep" />

  <!-- 重置 = 删块 + 同位置新建空文本块：与删除同属「真的删东西」，但它是可撤销的改造
       而非销毁，所以不涂危险色，靠分隔线守住与删除的距离 -->
  <BlockMenuItem
    data-block-menu-item="reset-text"
    :icon="Eraser"
    label="重置为文本块"
    @click="run(resetToTextBlock)"
  />

  <span class="menu-sep" />

  <BlockMenuItem
    data-block-menu-item="delete"
    :icon="Trash2"
    label="删除"
    danger
    @click="run(deleteBlock)"
  />
</template>
