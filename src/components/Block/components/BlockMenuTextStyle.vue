<script setup lang="ts">
import { Heading1, Heading2, Heading3, Highlighter, List, ListOrdered, Type } from 'lucide-vue-next'
import type { Component } from 'vue'

import type { ParagraphStyle } from '../../../composables/useContentRenderer'
import type { CalloutTone } from '../../../utils/callout'

/**
 * 块入口菜单顶部的**文本样式行**（普通文本 / H1 / H2 / H3 / 有序 / 无序 / 高亮），水平排一行。
 *
 * 只对文本块出现。前六格在本库里不是"块类型"，而是正文开头的样式前缀
 * （`parseParagraphStyle` 是唯一判据，与 BulletRender 渲染、胶囊字形同源）；
 * 末格「高亮」是唯一的例外 —— 它活在 `format.callout` 里，不占正文前缀，
 * 与其余六格**互斥**（选任何一格都会摘掉高亮，选高亮会把前缀降为正文）。
 *
 * 组件只管表现：当前在哪一格、点了哪一格由外壳算好传进来 —— 与 `BlockMenuItem`
 * 同一条约定（表现层不碰 store）。
 */
defineProps<{
  /** 当前样式；`null` = 这一排都不点亮（`####` 这类尚未纳入的级别） */
  style: ParagraphStyle | null
  /** 当前高亮语义；非空 = 「高亮」那格点亮（语义细节由块内图标呈现，不在这排里选） */
  calloutTone?: CalloutTone | null
}>()

const emit = defineEmits<{ select: [style: ParagraphStyle | 'callout'] }>()

interface TextStyleItem {
  style: ParagraphStyle | 'callout'
  icon: Component
  label: string
}

/**
 * 顺序：文本 → H1 → H2 → H3 → 有序 → 无序 → 高亮。
 * 前两组是"逐级加重的文本"与"换成列表"；高亮排在最后 —— 它与前六格不同源（`format`），
 * 摆在末尾既说明"降级到另一种样式"，也不会把最常用的前几格挤到右边。
 */
const ITEMS: TextStyleItem[] = [
  { style: 'text', icon: Type, label: '普通文本' },
  { style: 'h1', icon: Heading1, label: '一级标题' },
  { style: 'h2', icon: Heading2, label: '二级标题' },
  { style: 'h3', icon: Heading3, label: '三级标题' },
  { style: 'ol', icon: ListOrdered, label: '有序列表' },
  { style: 'ul', icon: List, label: '无序列表' },
  { style: 'callout', icon: Highlighter, label: '高亮' },
]

/** 点亮判据分两路：前缀样式比 `style`，高亮比 `calloutTone`（两者互斥，不会同时亮） */
function isActive(item: TextStyleItem, style: ParagraphStyle | null, tone?: CalloutTone | null) {
  return item.style === 'callout' ? !!tone : item.style === style
}
</script>

<template>
  <div
    class="menu-style-row"
    role="group"
    aria-label="文本样式"
  >
    <button
      v-for="item in ITEMS"
      :key="item.style"
      type="button"
      class="menu-style-btn"
      :class="{ 'is-active': isActive(item, style, calloutTone) }"
      :title="item.label"
      :aria-label="item.label"
      :aria-pressed="isActive(item, style, calloutTone)"
      :data-text-style="item.style"
      @click="emit('select', item.style)"
    >
      <!-- 字形尺寸补偿：lucide 的 Heading/List 字形在 24 网格里占位比 Type 小一圈，
           同尺寸摆一起会显小（与入口胶囊的 14/16 同一套补偿）。 -->
      <component
        :is="item.icon"
        :size="item.style === 'text' ? 15 : 16"
      />
    </button>
  </div>
</template>

<style lang="scss" scoped>
.menu-style-row {
  display: flex;
  gap: 2px;
  padding: 2px;
}

.menu-style-btn {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  // 7 格挤在 148px 的菜单内容宽里：148 − 4（行内 padding）− 12（6 条 2px 间隙）= 132，
  // 132 / 7 ≈ 18.8px —— 18px 是「不再缩、也不溢出」的临界值（6 格时是 22px）。
  min-width: 18px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

/* hover 走中性底、当前样式走 accent 底：两者若同色，"当前在哪一格"就读不出来 */
.menu-style-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.menu-style-btn.is-active,
.menu-style-btn.is-active:hover {
  background: var(--accent-subtle);
  color: var(--accent);
}
</style>
