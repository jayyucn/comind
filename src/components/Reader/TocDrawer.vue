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
// 目录侧栏（票 03 / ADR-0040 D10 演进）：常驻侧栏——随阅读器正文区内联布局，
// 打开时占位收窄正文、关闭时折叠为 0 宽。无遮罩、无 Teleport、无 z-index
// （ADR-0032 铁律：非浮层不涉及堆叠上下文）。
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
  <aside class="toc-drawer" :class="{ collapsed: !open }" aria-label="目录">
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
</template>

<style lang="scss" scoped>
.toc-drawer {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--reader-bg);
  border-right: 1px solid var(--reader-border);
  overflow: hidden;
  transition: width 160ms ease;

  &.collapsed {
    width: 0;
    border-right: none;
    visibility: hidden;
  }
}

.toc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 8px 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--reader-border);
}

.toc-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--reader-text);
  white-space: nowrap;
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
  color: var(--reader-text-muted);
  transition: all 100ms ease;

  &:hover {
    background: var(--bg-hover);
    color: var(--reader-text);
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
  color: var(--reader-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 100ms ease;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--reader-text);
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
