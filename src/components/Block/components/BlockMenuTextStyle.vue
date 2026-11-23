<script setup lang="ts">
import { Heading1, Heading2, Heading3, Highlighter, List, ListOrdered, Type } from 'lucide-vue-next'
import type { Component } from 'vue'

import type { ParagraphStyle } from '../../../composables/useContentRenderer'
import type { CalloutTone } from '../../../utils/callout'

/**
 * 块入口菜单顶部的**文本样式区**，七个格子排两行（4 + 3）：
 *
 * 第一行：普通文本 / H1 / H2 / H3 —— 在本库里不是"块类型"，而是正文开头的
 * 样式前缀（`parseParagraphStyle` 是唯一判据，与 BulletRender 渲染、胶囊字形同源）。
 * 第二行：有序 / 无序 / 高亮 —— 「高亮」活在 `format.callout` 里，不占正文前缀，
 * 与前六格**互斥**（选六格任一个都会摘掉高亮，选高亮会把前缀降为正文）。
 * 它就是普通的一格，与其它格子同尺寸同形态，语义切换由块内图标承担。
 *
 * 组件只管表现：当前在哪一格、点了哪一格由外壳算好传进来 —— 与 `BlockMenuItem`
 * 同一条约定（表现层不碰 store）。
 */
defineProps<{
  /** 当前样式；`null` = 样式格都不点亮（`####` 这类尚未纳入的级别） */
  style: ParagraphStyle | null
  /** 当前高亮语义；非空 = 「高亮」格点亮（语义细节由块内图标呈现，不在这排里选） */
  calloutTone?: CalloutTone | null
}>()

const emit = defineEmits<{ select: [style: ParagraphStyle | 'callout'] }>()

interface TextStyleItem {
  style: ParagraphStyle | 'callout'
  icon: Component
  label: string
}

/**
 * 网格顺序（4 列，自动换行成 4+3 两行）：
 * 文本 → H1 → H2 → H3 ‖ 有序 → 无序 → 高亮。
 * 前半是"逐级加重的文本"，后半是"列表与强调" —— 两类语义不同，靠顺序自然分组。
 */
const STYLE_ITEMS: TextStyleItem[] = [
  { style: 'text', icon: Type, label: '普通文本' },
  { style: 'h1', icon: Heading1, label: '一级标题' },
  { style: 'h2', icon: Heading2, label: '二级标题' },
  { style: 'h3', icon: Heading3, label: '三级标题' },
  { style: 'ol', icon: ListOrdered, label: '有序列表' },
  { style: 'ul', icon: List, label: '无序列表' },
  { style: 'callout', icon: Highlighter, label: '高亮' },
]
</script>

<template>
  <div
    class="menu-style-grid"
    role="group"
    aria-label="文本样式"
  >
    <button
      v-for="item in STYLE_ITEMS"
      :key="item.style"
      type="button"
      class="menu-style-btn"
      :class="{ 'is-active': item.style === style || (item.style === 'callout' && !!calloutTone) }"
      :title="item.label"
      :aria-label="item.label"
      :aria-pressed="item.style === style || (item.style === 'callout' && !!calloutTone)"
      :data-text-style="item.style"
      @click="emit('select', item.style)"
    >
      <!-- 字形尺寸补偿：lucide 的 Heading/List 字形在 24 网格里占位比 Type 小一圈，
           同尺寸摆一起会显小（与入口胶囊的 14/16 同一套补偿）。 -->
      <component
        :is="item.icon"
        :size="item.style === 'text' || item.style === 'callout' ? 15 : 16"
      />
    </button>
  </div>
</template>

<style lang="scss" scoped>
.menu-style-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
  padding: 2px;
}

.menu-style-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  // 4 列均分 148px 的菜单内容宽：148 − 4（容器 padding）− 6（3 条 2px 间隙）= 138，
  // 138 / 4 ≈ 34.5px —— 比原先 6 格挤一行的 22px 宽裕得多，字形不再局促。
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
