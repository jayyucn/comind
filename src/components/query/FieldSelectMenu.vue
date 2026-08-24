<script setup lang="ts">
import { ref, computed } from 'vue'
import BasePopover from '../common/BasePopover.vue'
import type { FieldDescriptor } from '../../core/query'

const props = defineProps<{
  /** 可筛选字段清单（来自注册表 list）。 */
  fields: FieldDescriptor[]
  /** 面板锚点。 */
  position?: { x: number; y: number }
}>()

const emit = defineEmits<{
  /** 选中某字段 → 新建一条该字段的条件。 */
  select: [key: string]
  /** 底部「Add advanced filter」→ 打开 FilterBuilder 逃逸舱。 */
  advanced: []
  /** overlay 点击 / Escape 请求关闭。 */
  close: []
}>()

const search = ref('')
const filtered = computed(() =>
  props.fields.filter((f) => f.label.toLowerCase().includes(search.value.toLowerCase())),
)
function pick(key: string) {
  emit('select', key)
}
</script>

<template>
  <BasePopover :visible="true" :position="position" @close="emit('close')">
    <div class="field-menu" data-testid="field-menu">
      <input
        class="field-search"
        type="text"
        v-model="search"
        placeholder="搜索字段…"
        data-testid="field-search"
      />
      <ul class="field-list">
        <li
          v-for="f in filtered"
          :key="f.key"
          class="field-item"
          data-testid="field-option"
          @click="pick(f.key)"
        >
          <span class="field-name">{{ f.label }}</span>
          <span class="field-type">{{ f.type }}</span>
        </li>
        <li v-if="filtered.length === 0" class="field-empty">无匹配字段</li>
      </ul>
      <button class="field-advanced" type="button" data-testid="field-advanced" @click="emit('advanced')">
        + Add advanced filter
      </button>
    </div>
  </BasePopover>
</template>

<style scoped>
.field-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 220px;
  padding: 6px;
  box-sizing: border-box;
}
.field-search {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-base);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  font-size: var(--text-sm);
  font-family: inherit;
  outline: none;
}
.field-search:focus {
  border-color: var(--accent);
}
.field-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.field-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--text-primary);
}
.field-item:hover {
  background: var(--bg-hover);
}
.field-type {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
.field-empty {
  padding: 8px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
.field-advanced {
  margin-top: 2px;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--accent);
  border-radius: var(--radius-sm);
  padding: 6px;
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
}
.field-advanced:hover {
  border-color: var(--accent);
}
</style>
