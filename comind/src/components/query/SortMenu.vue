<script setup lang="ts">
import { ref, watch } from 'vue'
import BasePopover from '../common/BasePopover.vue'
import type { FieldDescriptor, SortRule } from '../../core/query'

const props = defineProps<{
  /** 正在编辑的排序规则。 */
  rule: SortRule
  /** 可排序的字段清单。 */
  fields: FieldDescriptor[]
  /** 面板锚点。 */
  position?: { x: number; y: number }
}>()

const emit = defineEmits<{
  /** 规则变更（字段/方向），emit 完整的新 SortRule。 */
  'update:rule': [rule: SortRule]
  /** 在该规则之后追加一条新排序。 */
  add: []
  /** 删除该规则。 */
  remove: []
  /** overlay 点击 / Escape 请求关闭。 */
  close: []
}>()

const local = ref<SortRule>({ ...props.rule })
watch(
  () => props.rule,
  (r) => {
    local.value = { ...r }
  },
  { deep: true },
)

function onFieldChange(e: Event) {
  local.value.field = (e.target as HTMLSelectElement).value
  emit('update:rule', { ...local.value })
}

function setDir(dir: 'asc' | 'desc') {
  local.value.dir = dir
  emit('update:rule', { ...local.value })
}

function fieldLabel(key: string): string {
  return props.fields.find((f) => f.key === key)?.label ?? key
}
</script>

<template>
  <BasePopover :visible="true" :position="position" @close="emit('close')">
    <div class="sort-menu" data-testid="sort-menu">
      <div class="sort-head">排序</div>

      <select
        class="sort-field"
        data-testid="sort-field"
        :value="local.field"
        @change="onFieldChange"
      >
        <option v-for="f in props.fields" :key="f.key" :value="f.key">{{ f.label }}</option>
      </select>

      <div class="sort-dir">
        <button
          type="button"
          data-testid="sort-asc"
          :class="{ active: local.dir === 'asc' }"
          @click="setDir('asc')"
        >
          A → Z
        </button>
        <button
          type="button"
          data-testid="sort-desc"
          :class="{ active: local.dir === 'desc' }"
          @click="setDir('desc')"
        >
          Z → A
        </button>
      </div>

      <div class="sort-foot">
        <button type="button" class="sort-add" data-testid="sort-add" @click="emit('add')">
          添加排序
        </button>
        <button type="button" class="sort-del" data-testid="sort-del" @click="emit('remove')">
          删除
        </button>
      </div>

      <div class="sort-current" data-testid="sort-current">
        {{ fieldLabel(local.field) }} · {{ local.dir === 'asc' ? '升序' : '降序' }}
      </div>
    </div>
  </BasePopover>
</template>

<style scoped>
.sort-menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  min-width: 220px;
  box-sizing: border-box;
}
.sort-head {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
}
.sort-field {
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
.sort-field:focus {
  border-color: var(--accent);
}
.sort-dir {
  display: flex;
  gap: 6px;
}
.sort-dir button {
  flex: 1;
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
}
.sort-dir button.active {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
  background: var(--accent-bg, rgba(99, 102, 241, 0.08));
}
.sort-foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.sort-add,
.sort-del {
  border: none;
  background: transparent;
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  padding: 2px 4px;
}
.sort-add {
  color: var(--accent, #6366f1);
}
.sort-del {
  color: var(--error, #d9534f);
}
.sort-add:hover,
.sort-del:hover {
  text-decoration: underline;
}
.sort-current {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
