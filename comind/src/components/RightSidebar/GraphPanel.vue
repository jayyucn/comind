<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { usePageStore } from '../../stores/pages'
const pageStore = usePageStore()
const GraphView = defineAsyncComponent(() => import('../GraphView/index.vue'))

// 等待右侧边栏宽度展开动画（200ms）结束后再挂载图谱，
// 避免 G6 在容器宽度为 0 / 极小值下初始化导致节点缩放异常。
const ready = ref(false)
let timer: number | undefined
onMounted(() => {
  timer = window.setTimeout(() => { ready.value = true }, 220)
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="graph-panel">
    <GraphView v-if="ready" :pageId="pageStore.currentPageId" />
  </div>
</template>

<style scoped>
.graph-panel {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-base);
}

/* GraphView 默认 height:100vh（全屏页），需适配右侧边栏容器高度 */
.graph-panel :deep(.graph-view) {
  height: 100%;
}

/* 隐藏全屏版标题（窄屏空间有限），保留布局与操作控件 */
.graph-panel :deep(.graph-view-title) {
  display: none;
}

.graph-panel :deep(.graph-view-header) {
  padding: 8px 12px;
  align-items: center;
}

.graph-panel :deep(.graph-view-controls) {
  gap: 8px;
}
</style>
