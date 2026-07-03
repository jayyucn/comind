<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { Network } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()

const isActive = () => route.name === 'graph'

function handleClick() {
  router.push('/graph')
}
</script>

<template>
  <div
    class="graph-entry"
    :class="{ active: isActive() }"
    @click="handleClick"
  >
    <div class="graph-content">
      <div class="graph-icon-wrap">
        <Network :size="18" :stroke-width="1.75" />
      </div>
      <div class="graph-body">
        <span class="graph-title">概念网络</span>
        <span class="graph-meta">浏览概念网络</span>
      </div>
    </div>
    <div class="graph-arrow">
      <span class="arrow-icon">›</span>
    </div>
  </div>
</template>

<style scoped>
.graph-entry {
  position: relative;
  height: 48px;
  margin: 0 var(--space-3) var(--space-2);
  padding: 0 var(--space-4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  border-radius: 10px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  overflow: hidden;
  transition: border-color 120ms ease, background 120ms ease;
}

.graph-entry:hover {
  border-color: var(--text-tertiary);
  background: var(--bg-hover);
}

.graph-entry:active {
  transform: scale(0.98);
}

.graph-entry.active {
  border-color: var(--accent);
  background: var(--accent-10);
}

.graph-content {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  position: relative;
  z-index: 1;
}

.graph-icon-wrap {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.graph-entry.active .graph-icon-wrap {
  background: var(--accent-subtle);
  color: var(--accent);
}

.graph-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.graph-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.graph-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.3;
}

.graph-arrow {
  color: var(--text-tertiary);
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

.arrow-icon {
  display: inline-block;
  transform: translateY(-1px);
}
</style>
