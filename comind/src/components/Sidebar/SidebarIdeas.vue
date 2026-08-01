<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { Droplets } from 'lucide-vue-next'
import { useIdeas } from '../../composables/useIdeas'

const router = useRouter()
const route = useRoute()
const { today } = useIdeas()
const weekday = new Date(today.value).toLocaleDateString('zh-CN', { weekday: 'short' })

const isActive = () => route.name === 'ideas-list'

function handleClick() {
  router.push('/ideas')
}
</script>

<template>
  <div
    class="nav-item drip-nav"
    :class="{ active: isActive() }"
    @click="handleClick"
  >
    <span class="nav-icon">
      <Droplets :size="16" :stroke-width="1.75" />
    </span>
    <span class="nav-label">点滴</span>
    <span class="nav-time">{{ today }} · {{ weekday }}</span>
  </div>
</template>

<style scoped>
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
  transition: background 80ms ease, color 80ms ease;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-item.active {
  color: var(--text-primary);
  font-weight: var(--font-semibold);
  background: var(--accent-bg, rgba(99, 102, 241, 0.08));
}

.nav-item.active .nav-icon {
  color: var(--accent);
}

.nav-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.nav-label {
  flex: 1;
  min-width: 0;
}

.nav-time {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  flex-shrink: 0;
}
</style>
