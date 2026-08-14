<script setup lang="ts">
/**
 * 单行条件 —— 通用 FilterBuilder 的子组件。
 *
 * 渲染：字段选择器（来自注册表）→ 操作符选择器（deriveOps 按类型派生）→ 值编辑器（ValueEditor 按类型分派）。
 * 字段切换时把操作符重置为该类型默认首操作符、清空 value；op 为 isEmpty/isNotEmpty 时隐藏值编辑器。
 * 通过 defineModel 以不可变方式交出新 Condition；删除交由父级（ConditionGroup）处理，故 emit('remove')。
 */
import { computed, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { deriveOps } from '../../core/query'
import type {
  Condition,
  ConditionValue,
  FieldDescriptor,
  FilterOp,
  ReferenceableRecord,
  Registry,
} from '../../core/query'
import ValueEditor from './ValueEditor.vue'

const props = defineProps<{
  registry: Registry
  entityType: string
  /** 跨记录引用候选记录列表（通用，业务无关），由 FilterBuilder 透传注入。 */
  crossRecordSources?: ReferenceableRecord[]
}>()

const emit = defineEmits<{ remove: [] }>()
const model = defineModel<Condition>()

const fields = computed<FieldDescriptor[]>(() => props.registry.list(props.entityType))
const currentDescriptor = computed<FieldDescriptor | undefined>(() =>
  model.value ? props.registry.get(props.entityType, model.value.field) : undefined,
)
const ops = computed<FilterOp[]>(() => (currentDescriptor.value ? deriveOps(currentDescriptor.value) : []))

const needsValue = computed(
  () => !!model.value && model.value.op !== 'isEmpty' && model.value.op !== 'isNotEmpty',
)

// 把 ValueEditor 交出的 ConditionValue 不可变地写回 Condition.value（避免 mutating props）
function onValue(v: ConditionValue | undefined) {
  if (model.value) model.value = { ...model.value, value: v }
}

const opLabels: Record<string, string> = {
  is: '是',
  isNot: '不是',
  contains: '包含',
  notContains: '不包含',
  before: '早于',
  after: '晚于',
  between: '介于',
  eq: '=',
  neq: '≠',
  gt: '>',
  lt: '<',
  hasAny: '含任一',
  hasAll: '含全部',
  isEmpty: '为空',
  isNotEmpty: '不为空',
}

function onFieldChange(e: Event) {
  const key = (e.target as HTMLSelectElement).value
  const desc = props.registry.get(props.entityType, key)
  const defaultOp: FilterOp = desc ? (deriveOps(desc)[0] ?? 'is') : 'is'
  model.value = { field: key, op: defaultOp, value: undefined }
}

function onOpChange(e: Event) {
  const op = (e.target as HTMLSelectElement).value as FilterOp
  const keepValue = op !== 'isEmpty' && op !== 'isNotEmpty'
  let value = keepValue ? model.value!.value : undefined
  // between 仅支持字面量区间：切到 between 时丢弃已有的字段/记录引用值，避免静默退化为 equals
  if (op === 'between' && value && value.kind !== 'literal') value = undefined
  model.value = { ...model.value!, op, value }
}

// 不变式：between 只允许字面量区间。用户切换 op 已在 onOpChange 处掉落引用值，
// 但反序列化或外部直接写入可能得到 `op:'between'` + 引用值（field/recordRef）这种非法组合，
// 故挂载即归一化清空 value，避免 UI 静默退化为 equals 或残留引用芯片。
watch(
  model,
  (c) => {
    if (c && c.op === 'between' && c.value && c.value.kind !== 'literal') {
      model.value = { ...c, value: undefined }
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="qb-row">
    <select class="qb-select" :value="model?.field" @change="onFieldChange">
      <option v-for="f in fields" :key="f.key" :value="f.key">{{ f.label }}</option>
    </select>

    <select
      class="qb-select qb-op"
      :value="model?.op"
      :disabled="!currentDescriptor"
      @change="onOpChange"
    >
      <option v-for="o in ops" :key="o" :value="o">{{ opLabels[o] ?? o }}</option>
    </select>

    <ValueEditor
      v-if="needsValue && currentDescriptor"
      class="qb-value-wrap"
      :descriptor="currentDescriptor"
      :op="model?.op"
      :entity-type="entityType"
      :registry="registry"
      :condition-field="model?.field"
      :cross-record-sources="crossRecordSources"
      :model-value="model?.value"
      @update:model-value="onValue"
    />

    <button class="qb-icon" type="button" title="删除条件" @click="emit('remove')">
      <X :size="14" />
    </button>
  </div>
</template>

<style lang="scss" scoped>
.qb-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.qb-select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-sm, 13px);
  outline: none;

  &:focus {
    border-color: var(--accent, #6366f1);
  }
}

.qb-op {
  min-width: 84px;
}

.qb-value-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
}

.qb-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary, #999);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
    color: var(--error, #dc2626);
  }
}
</style>
