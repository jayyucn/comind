<script setup lang="ts">
import { Columns3 } from 'lucide-vue-next'

import BlockMenuItem from '../../../common/BlockMenuItem.vue'

/**
 * 表格块的**类型专属菜单项**：表头开关 | 均分列宽。
 *
 * 从 `TableBlock.vue` 的内联模板抽出来，因为菜单宿主已经从「每个 handler 各自一个 popover」
 * 收敛到 Block 外壳一层（ADR-0039 D9）：外壳通过 `useBlockEntryMenuExtra` 拿到本组件，
 * standalone 入口（Ideas 快照，没有外壳）也渲染它 —— 两处同一份定义，项序不会漂移。
 *
 * 关菜单不在这里做：点下去只上报意图，关闭由持有浮层的那一方（外壳或 standalone）决定。
 */
defineProps<{
  /** 当前是否启用首行表头 */
  header: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-header'): void
}>()
</script>

<template>
  <BlockMenuItem
    data-block-menu-item="header"
    label="首行表头"
    role="switch"
    :aria-checked="header"
    title="首行设为表头"
    @click="emit('toggle-header')"
  >
    <template #trailing>
      <span
        class="switch"
        :class="{ 'is-on': header }"
        aria-hidden="true"
      >
        <span class="switch-knob" />
      </span>
    </template>
  </BlockMenuItem>

  <span class="menu-sep" />

  <BlockMenuItem
    data-block-menu-item="equal-columns"
    :icon="Columns3"
    label="均分列宽"
    disabled
    title="列宽固定等宽，暂不支持调整"
  />
</template>

<style lang="scss" scoped>
/* 内联开关（仓库没有通用 switch 组件，单处使用不抽公共件）。
   轨道用 --bg-hover，开启态用 --accent；只走 token，不写死色值。 */
.switch {
  position: relative;
  flex: 0 0 auto;
  width: 26px;
  height: 14px;
  border-radius: 999px;
  background: var(--bg-hover);
  transition: background var(--dur-fast) var(--ease-out);
}

.switch.is-on {
  background: var(--accent);
}

.switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-white);
  transition: transform var(--dur-fast) var(--ease-out);
}

.switch.is-on .switch-knob {
  transform: translateX(12px);
}
</style>
