<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useIdeas } from '../../composables/useIdeas'
import { Icon } from '../Icons'

const router = useRouter()
const { today } = useIdeas()
const weekday = new Date(today.value).toLocaleDateString('zh-CN', { weekday: 'short' })

function handleClick() {
  router.push('/ideas')
}
</script>

<template>
  <div class="ideas-hero" @click="handleClick">
    <div class="ideas-glow"></div>
    <div class="ideas-content">
      <div class="ideas-icon-wrap">
        <Icon name="icon-droplet" :size="18" color="var(--accent)" />
      </div>
      <div class="ideas-body">
        <span class="ideas-title">点滴</span>
        <span class="ideas-meta">{{ today }} · {{ weekday }}</span>
      </div>
    </div>
    <div class="ideas-indicator">
      <div class="indicator-dot"></div>
      <div class="indicator-pulse"></div>
    </div>
  </div>
</template>

<style scoped>
.ideas-hero {
  position: relative;
  height: 52px;
  margin: var(--space-3) var(--space-3) var(--space-2);
  padding: 0 var(--space-4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  border-radius: 10px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  overflow: hidden;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.ideas-hero:hover {
  border-color: var(--accent);
  box-shadow: 0 2px 12px var(--accent-10);
}

.ideas-hero:active {
  transform: scale(0.97);
}

.ideas-glow {
  position: absolute;
  top: -20px;
  left: -40px;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--accent-subtle);
  opacity: 0.5;
  pointer-events: none;
}

.ideas-content {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  position: relative;
  z-index: 1;
}

.ideas-icon-wrap {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--accent-subtle);
  flex-shrink: 0;
}

.ideas-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ideas-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.ideas-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.3;
}

.ideas-indicator {
  position: relative;
  width: 8px;
  height: 8px;
  flex-shrink: 0;
}

.indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.6;
  position: absolute;
  top: 0;
  left: 0;
}

.indicator-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.25;
  position: absolute;
  top: 0;
  left: 0;
  animation: ideas-pulse 2s ease-out infinite;
}

@keyframes ideas-pulse {
  0% {
    transform: scale(1);
    opacity: 0.25;
  }
  100% {
    transform: scale(2.5);
    opacity: 0;
  }
}
</style>