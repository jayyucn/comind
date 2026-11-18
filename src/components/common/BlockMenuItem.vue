<script setup lang="ts">
import type { Component } from 'vue'

/**
 * 块入口菜单的一行（通用项的**表现层**）。
 *
 * 只管「长什么样」：图标 / 文案 / 不可用 / 危险色。点下去做什么由调用方决定，
 * 能不能点（缩进有无前兄弟、粘贴有无内容）也由调用方算好再传进来 ——
 * 本组件不碰 store，所以放在 common/ 而不是 Block/ 下。
 *
 * 样式从 table / query 两份 handler 搬来（原先是逐字节相同的两份 `.menu-row`）。
 * 类名保留 `.menu-row`：既有 e2e 按它定位（tests/query-block-menu.spec.ts 等）。
 */
defineProps<{
  /** 头部图标；开关类项（首行表头）没有图标，留空即可 */
  icon?: Component
  label: string
  disabled?: boolean
  /** 破坏性操作（删除）：文字走 --error，hover 底色也不跟普通项一样 */
  danger?: boolean
}>()

const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    class="menu-row"
    :class="{ 'is-danger': danger }"
    :disabled="disabled"
    @click="emit('click')"
  >
    <component
      :is="icon"
      v-if="icon"
      :size="13"
    />
    <!-- 标签占满剩余宽度：右侧 trailing 槽（开关轨道等）才能被推到最右 -->
    <span class="menu-label">{{ label }}</span>
    <slot name="trailing" />
  </button>
</template>

<style lang="scss" scoped>
.menu-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-xs);
  line-height: 1.5;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

/* 标签占满剩余宽度：把 trailing 槽（开关轨道）推到最右 */
.menu-label {
  flex: 1;
}

.menu-row:hover:not(:disabled) {
  background: var(--accent-subtle);
  color: var(--accent);
}

.menu-row:disabled {
  opacity: 0.45;
  cursor: default;
}

/* 危险项：默认就是红字（不等到 hover）。hover 底色用中性 --bg-hover 而不是 accent：
   没有 --error-subtle 这类淡红 token，用 accent 底配红字会撞成两种强调色。
   改字色不靠「整行变红底」制造惊吓，删除是不可逆操作但不该在视觉上尖叫。 */
.menu-row.is-danger {
  color: var(--error);
}

.menu-row.is-danger:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--error);
}
</style>
