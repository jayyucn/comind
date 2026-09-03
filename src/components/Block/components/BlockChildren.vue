<script setup lang="ts">
/**
 * BlockChildren - 子节点容器（VueDraggable + 折叠动画）
 *
 * 职责：
 * - 渲染 VueDraggable 包裹递归的 <Block>
 * - 应用折叠/展开动画（CSS 类驱动的 max-height 过渡）
 * - 通过 v-model="node.children" 同步子节点（VueDraggable 直接 mutate 数组）
 *
 * 注意：
 * - moveHandler 作为函数 prop 传入（而非 emit）以保留返回值，
 *   VueDraggable 的 @move 需要返回 false 来阻止循环嵌套等非法移动。
 * - draggableRef 通过 defineExpose 暴露给父组件，用于测量 childrenHeight。
 */
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import Block from '../index.vue'
import type { TreeNode } from '../../../types/block'

const props = defineProps<{
  node: TreeNode
  pageId: string
  depth: number
  collapsed: boolean
  isAnimating: boolean
  childrenHeight: number
  moveHandler?: (evt: any) => boolean | void
}>()

const emit = defineEmits<{
  (e: 'drag-start'): void
  (e: 'drag-end'): void
}>()

const draggableRef = ref<any>(null)

const childrenContainerClass = computed(() => ({
  'block-children': true,
  'has-children': !props.collapsed && props.node.children.length > 0,
  'is-collapsed': props.collapsed,
  'is-animating': props.isAnimating
}))

function onMove(evt: any) {
  if (props.moveHandler) {
    return props.moveHandler(evt)
  }
  return true
}

defineExpose({ draggableRef })
</script>

<template>
  <VueDraggable
    v-if="node.block.type !== 'embed'"
    ref="draggableRef"
    v-model="node.children"
    tag="div"
    :group="{ name: 'blocks-' + pageId, pull: true, put: true }"
    :sort="true"
    handle=".bullet-dot"
    filter=".bullet-chevron"
    :prevent-on-filter="false"
    :fallback-tolerance="5"
    :animation="150"
    ghost-class="block-ghost"
    drag-class="block-drag"
    chosen-class="block-chosen"
    :force-fallback="true"
    :empty-insert-threshold="0"
    :class="childrenContainerClass"
    :data-parent-id="node.id"
    :style="{ '--indent-depth': depth }"
    @start="emit('drag-start')"
    @move="onMove"
    @end="emit('drag-end')"
  >
    <Block
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :page-id="pageId"
      :depth="depth + 1"
    />
  </VueDraggable>
</template>
