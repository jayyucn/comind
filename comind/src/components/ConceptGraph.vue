<script setup lang="ts">
import { ref } from 'vue'

const graphDepth = ref(2) // 默认 2 度
const graphLayout = ref<'force' | 'dagre' | 'circular'>('force') // 默认力导向

</script>

<template>
  <div class="concept-graph-panel">
    <div class="concept-graph-header">
      <span class="concept-graph-title">
        🕸️ 概念图谱
      </span>
      <div class="concept-graph-controls">
        <select v-model="graphDepth" class="depth-select">
          <option :value="1">1 度</option>
          <option :value="2">2 度</option>
          <option :value="3">3 度</option>
        </select>
        <select v-model="graphLayout" class="layout-select">
          <option value="force">力导向</option>
          <option value="dagre">层级</option>
          <option value="circular">环形</option>
        </select>
      </div>
    </div>
    <div ref="graphContainer" class="concept-graph-body">
      <div class="placeholder">
        <p>概念图谱可视化功能开发中...</p>
        <p>已支持关系类型存储和解析</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.concept-graph-panel {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 2px dashed var(--border);
  background: var(--bg);
}

.concept-graph-header {
  padding: 0 0 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.concept-graph-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.concept-graph-controls {
  display: flex;
  gap: 8px;
}

.depth-select,
.layout-select {
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
}

.concept-graph-body {
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.placeholder {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  p {
    margin: 4px 0;
  }
}
</style>
