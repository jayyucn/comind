<script lang="ts">
/** TOC 扁平条目：ReaderView 把 foliate 的 toc 树（含嵌套 subitems）压平后传入 */
export interface TocEntry {
  label: string
  /** 对应 spine 章节下标；null = 无链接条目（不可跳转） */
  index: number | null
  /** 树深度（0 起，控制缩进） */
  depth: number
}
</script>

<script setup lang="ts">
// 目录抽屉（票 03 / ADR-0040 D10）：Teleport 到 body + var(--z-*)（ADR-0032 铁律），
// 避免困在阅读器滚动容器的局部堆叠上下文里。
import Icon from '../Icons/Icon.vue'

defineProps<{
  open: boolean
  entries: TocEntry[]
  currentIndex: number
}>()

const emit = defineEmits<{
  select: [index: number]
  close: []
}>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="toc-overlay" @click="emit('close')"></div>
    <aside v-if="open" class="toc-drawer" role="dialog" aria-label="目录">
      <header class="toc-header">
        <span class="toc-title">目录</span>
        <button class="toc-close-btn" title="关闭目录" @click="emit('close')">
          <Icon name="icon-close" :size="16" />
        </button>
      </header>
      <nav class="toc-list">
        <button
          v-for="(entry, i) in entries"
          :key="i"
          class="toc-item"
          :class="{ active: entry.index !== null && entry.index === currentIndex }"
          :style="{ paddingLeft: `${12 + entry.depth * 16}px` }"
          :disabled="entry.index === null"
          :title="entry.label"
          @click="entry.index !== null && emit('select', entry.index)"
        >{{ entry.label }}</button>
      </nav>
    </aside>
  </Teleport>
</template>

<style lang="scss" scoped>
.toc-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background: var(--overlay);
}

.toc-drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: 300px;
  z-index: var(--z-drawer);
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  box-shadow: var(--shadow-modal);
}

.toc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 8px 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}

.toc-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.toc-close-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  transition: all 100ms ease;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
}

.toc-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.toc-item {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  padding-right: 12px;
  padding-top: 6px;
  padding-bottom: 6px;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 100ms ease;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    color: var(--accent);
    font-weight: var(--font-medium);
  }

  &:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
}
</style>
