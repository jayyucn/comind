<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useTagFilter } from '../composables/useTagFilter'

const { activeTag, isOpen, byPage, closeFilter, navigateToBlock } = useTagFilter()

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeFilter()
}

onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <!-- 点击遮罩关闭 -->
  <Teleport to="body">
    <Transition name="backdrop">
      <div v-if="isOpen" class="tag-filter-backdrop" @click="closeFilter" />
    </Transition>

    <Transition name="panel">
      <div v-if="isOpen" class="tag-filter-panel" role="dialog" aria-modal="true">
        <!-- Header -->
        <div class="panel-header">
          <span class="panel-tag"># {{ activeTag }}</span>
          <button class="panel-close" @click="closeFilter" title="关闭 (Esc)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <!-- 结果列表 -->
        <div class="panel-body">
          <template v-if="byPage.size > 0">
            <div v-for="[pageTitle, items] in byPage" :key="pageTitle" class="page-group">
              <div class="page-group-title">{{ pageTitle }}</div>
              <div
                v-for="item in items"
                :key="item.block.id"
                class="result-item"
                @click="navigateToBlock(item.block.id)"
              >
                <span class="result-content">{{ item.block.content || '(空块)' }}</span>
              </div>
            </div>
          </template>

          <div v-else class="panel-empty">
            没有找到含有 #{{ activeTag }} 的块
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── 遮罩 ─────────────────────────────────────────────── */
.tag-filter-backdrop {
  position: fixed;
  inset: 0;
  z-index: 499;
  background: rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(2px);
}

.backdrop-enter-active, .backdrop-leave-active { transition: opacity 180ms ease; }
.backdrop-enter-from, .backdrop-leave-to { opacity: 0; }

/* ── 面板 ─────────────────────────────────────────────── */
.tag-filter-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  height: 100vh;
  z-index: 500;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}

.panel-enter-active { transition: transform 220ms cubic-bezier(0.2, 0, 0, 1); }
.panel-leave-active { transition: transform 180ms cubic-bezier(0.4, 0, 1, 1); }
.panel-enter-from, .panel-leave-to { transform: translateX(100%); }

/* ── Header ───────────────────────────────────────────── */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-tag {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-accent);
}

.panel-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
  flex-shrink: 0;
}

.panel-close:hover {
  background: var(--accent-03);
  color: var(--text-primary);
}

/* ── Body ─────────────────────────────────────────────── */
.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2) 0;
}

.page-group {
  margin-bottom: var(--space-3);
}

.page-group-title {
  padding: 4px 16px 2px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.result-item {
  padding: 6px 16px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
  line-height: 1.5;
  transition: background 100ms ease, color 100ms ease;
  word-break: break-word;
}

.result-item:hover {
  background: var(--accent-03);
  color: var(--text-primary);
}

.result-content {
  /* 内容过长省略 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── 空状态 ───────────────────────────────────────────── */
.panel-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}
</style>
