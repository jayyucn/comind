<script setup lang="ts">
import { Heading1, Heading2, Heading3, Type } from 'lucide-vue-next'
import type { Component } from 'vue'

/**
 * 块入口菜单顶部的**文本样式行**（普通文本 / H1 / H2 / H3），水平排一行。
 *
 * 只对文本块出现：这四格在本库里不是"块类型"，而是正文开头的 `#` 前缀
 * （`parseHeading` 是唯一判据，与 BulletRender 渲染标题、胶囊字形同源）。
 *
 * 组件只管表现：当前在哪一格、点了哪一格由外壳算好传进来 —— 与 `BlockMenuItem`
 * 同一条约定（表现层不碰 store，因此在 common/ 之外也不依赖任何 store）。
 *
 * 有序/无序列表这类"样式"刻意不在列：本库正文没有对应表达法（无 list 块类型、
 * 无列表语法解析），点了没有落点的按钮就是假控件。要加先有语义，再有按钮。
 */
defineProps<{
  /**
   * 当前样式：0 = 普通文本，1/2/3 = 标题级别，-1 = 谁也不点亮的「无声明态」
   * （如 `####` 这类尚未纳入这四格的级别）。
   */
  level: number
}>()

const emit = defineEmits<{ select: [level: 0 | 1 | 2 | 3] }>()

interface TextStyleItem {
  level: 0 | 1 | 2 | 3
  icon: Component
  label: string
}

/**
 * 顺序固定为 文本 → H1 → H2 → H3：标题级别升序，用户的心智模型是"逐级加重"，
 * 不是"按字母排"。
 */
const ITEMS: TextStyleItem[] = [
  { level: 0, icon: Type, label: '普通文本' },
  { level: 1, icon: Heading1, label: '一级标题' },
  { level: 2, icon: Heading2, label: '二级标题' },
  { level: 3, icon: Heading3, label: '三级标题' },
]
</script>

<template>
  <div
    class="menu-style-row"
    role="group"
    aria-label="文本样式"
  >
    <button
      v-for="item in ITEMS"
      :key="item.level"
      type="button"
      class="menu-style-btn"
      :class="{ 'is-active': item.level === level }"
      :title="item.label"
      :aria-label="item.label"
      :aria-pressed="item.level === level"
      :data-text-style="item.level"
      @click="emit('select', item.level)"
    >
      <!-- 字形尺寸补偿：lucide 的 Heading 字形在 24 网格里占位比 Type 小一圈，
           同尺寸摆一起会显小（与入口胶囊的 14/16 同一套补偿）。 -->
      <component
        :is="item.icon"
        :size="item.level === 0 ? 15 : 16"
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
  min-width: 28px;
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
