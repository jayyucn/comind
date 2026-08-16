<script setup lang="ts">
import BasePopover from '../common/BasePopover.vue'
import type { FieldDescriptor } from '../../core/query'

const emit = defineEmits<{
  /** 选中字段 → 设置 groupBy；选「不分组」→ null。 */
  'update:groupBy': [key: string | null]
  /** overlay 点击 / Escape 请求关闭。 */
  close: []
}>()

defineProps<{
  /** 当前分组字段 key；null 表示不分组。 */
  groupBy: string | null
  /** 可分组字段清单。 */
  fields: FieldDescriptor[]
  /** 面板锚点。 */
  position?: { x: number; y: number }
}>()

function select(key: string | null) {
  emit('update:groupBy', key)
  emit('close')
}
</script>

<template>
  <BasePopover :visible="true" :position="position" @close="emit('close')">
    <div class="group-menu" data-testid="group-menu">
      <div class="group-head">分组</div>

      <button
        type="button"
        class="group-none"
        data-testid="group-none"
        :class="{ active: groupBy === null }"
        @click="select(null)"
      >
        不分组
      </button>

      <ul class="group-list">
        <li
          v-for="f in fields"
          :key="f.key"
          class="group-item"
          :class="{ active: groupBy === f.key }"
          data-testid="group-item"
          @click="select(f.key)"
        >
          {{ f.label }}
        </li>
      </ul>
    </div>
  </BasePopover>
</template>

<style scoped>
.group-menu {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  min-width: 200px;
  box-sizing: border-box;
}
.group-head {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
}
.group-none {
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  font-size: var(--text-sm);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.group-none.active {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
  background: var(--accent-bg, rgba(99, 102, 241, 0.08));
}
.group-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
}
.group-item {
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
}
.group-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.group-item.active {
  color: var(--accent, #6366f1);
  background: var(--accent-bg, rgba(99, 102, 241, 0.08));
}
</style>
