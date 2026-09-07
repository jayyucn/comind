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
  /** 顶栏 目录 按钮已移入侧栏标题：标题按钮同时承担开/关，统一 toggle */
  toggle: []
}>()
</script>

<template>
  <aside class="toc-drawer" :class="{ collapsed: !open }" aria-label="目录">
    <header class="toc-header">
      <button class="toc-title-btn" title="目录" @click="emit('toggle')">
        <Icon name="icon-menu" :size="16" />
        <span class="toc-title-text">目录</span>
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
    // 折叠后只保留「目录」按钮：容器收缩至仅容纳按钮，去背景/边框/标题/列表。
    // header 布局（padding、左对齐）与展开态完全一致 → 按钮锚点不随开合移动。
    width: auto;
    background: transparent;
    border-right: none;

    .toc-header {
      border-bottom: none;
    }

    .toc-title-text {
      display: none;
    }

    .toc-list {
      display: none;
    }
  }
}

.toc-header {
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 8px 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--reader-border);
}

.toc-title-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-md);
  color: var(--reader-text-muted);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  transition: all 100ms ease;

  &:hover {
    background: var(--bg-hover);
    color: var(--reader-text);
  }
}

.toc-title-text {
  white-space: nowrap;
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
