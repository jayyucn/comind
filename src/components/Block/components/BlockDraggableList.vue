<script setup lang="ts">
/**
 * BlockDraggableList — block 拖拽列表的唯一实现
 *
 * 承载根级列表（BlockList）与子级列表（Block 的 node.children）的全部拖拽接线：
 * group / handle / filter / force-fallback / 三个拖拽态 class / 指示器写入 /
 * 循环嵌套守卫 / 拖拽结束回调。调用方只声明「数据 + 归属 + 渲染 depth」。
 *
 * 之所以收敛为一份：此前两处各手写一遍几乎相同的配置，复制粘贴漂移出
 * 「@move 只绑在子级 ⇒ 根级起手的拖拽全程无指示线」等问题（2026-09-11 定性）。
 *
 * 落库（单一写路径）：本组件只发 drag-end 事件，落库由调用方经
 * inject('onDragEnd') → syncTreeToStore（完整树 diff）完成。
 */
import { ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useBlockStore } from '../../../stores/blocks'
import { useEditorStore } from '../../../stores/editor'
import type { TreeNode } from '../../../types/block'
import { useBlockDragDrop } from '../composables/useBlockDragDrop'
import type { DragEndIntent } from '../composables/useBlockDragDrop'
import Block from '../index.vue'

defineProps<{
  /** 本列表所属页面 ID（决定 drag group，仅同页可互拖） */
  pageId: string
  /**
   * 本列表的拥有者 block id；根级列表为 null。
   *
   * 渲染为 data-parent-id（null → 空串），两处依赖「空串 = 根级」这一约定，不可改为省略属性：
   * - handleDragMove 读该属性做循环嵌套判定，空串特判为根级（无所有者）；
   * - src/styles/base/_reset.scss 靠该属性是否存在区分拖拽容器与 Sortable 占位元素。
   */
  parentId: string | null
  /** 列表项的 depth（根级 0，子级 = 父 depth + 1） */
  depth: number
}>()

/** VueDraggable 直接重排该数组（经 update:modelValue 交还调用方） */
const list = defineModel<TreeNode[]>({ required: true })

const emit = defineEmits<{
  /** 拖拽结束：调用方按落位意图校正树后把完整树落库 */
  (e: 'drag-end', intent: DragEndIntent | null): void
}>()

const blockStore = useBlockStore()
const editorStore = useEditorStore()

const { handleDragStart, handleDragMove, handleBlockDragEnd } = useBlockDragDrop({
  blockStore,
  onDragEnd: intent => emit('drag-end', intent),
})

/**
 * Sortable @start：先结束 block 编辑态，再把拖拽期指针跟踪交给 hook。
 * 落位意图由指针位置实时重算（见 useBlockDragDrop 顶部说明），因此这里必须接管 @start。
 */
function onDragStart(evt: unknown) {
  editorStore.deactivateBlock()
  handleDragStart(evt)
}

const draggableRef = ref<any>(null)

defineExpose({
  /** 容器 DOM（调用方用于测量子节点高度） */
  getContainerEl: (): HTMLElement | null => (draggableRef.value?.$el as HTMLElement) ?? null
})
</script>

<template>
  <VueDraggable
    ref="draggableRef"
    v-model="list"
    tag="div"
    :group="{ name: 'blocks-' + pageId, pull: true, put: true }"
    :sort="true"
    handle=".bullet-dot"
    filter=".bullet-chevron"
    :prevent-on-filter="false"
    :fallback-tolerance="5"
    :animation="200"
    ghost-class="block-ghost"
    drag-class="block-drag"
    chosen-class="block-chosen"
    :force-fallback="true"
    :empty-insert-threshold="0"
    :data-parent-id="parentId ?? ''"
    @start="onDragStart"
    @move="handleDragMove"
    @end="handleBlockDragEnd"
  >
    <Block v-for="node in list" :key="node.id" :node="node" :page-id="pageId" :depth="depth" />
  </VueDraggable>
</template>
