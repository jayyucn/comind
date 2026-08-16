<script setup lang="ts">
import { computed } from 'vue'
import BasePopover from '../common/BasePopover.vue'
import ChipValueEditor from './ChipValueEditor.vue'
import { deriveOps } from '../../core/query'
import type { Condition, ConditionValue, FieldDescriptor, FilterOp, Option } from '../../core/query'
import { opLabel, defaultOpFor } from './filterMeta'

const props = defineProps<{
  /** 当前条件所属字段的描述符（由父级按 condition.field 推导）。 */
  field: FieldDescriptor
  /** 正在编辑的条件。 */
  condition: Condition
  /** 可切换的字段清单。 */
  fields: FieldDescriptor[]
  /** 面板锚点。 */
  position?: { x: number; y: number }
}>()

const emit = defineEmits<{
  /** 任意字段/操作符/值变更后，emit 完整的新 Condition（父级持有真相）。 */
  'update:condition': [cond: Condition]
  /** 删除该条件。 */
  remove: []
  /** overlay 点击 / Escape 请求关闭。 */
  close: []
}>()

const ops = deriveOps(props.field)

/**
 * 选完值是否立即关闭面板。
 * 仅对「一次交互即完成取值」的离散类型关闭：select（单选）、boolean、date 单日期（before/after）。
 * text / number 每次按键都 emit（不可关），multiSelect / date 区间需多次点选（也不可关，
 * 由点击面板外 / Escape 兜底关闭）。
 */
const closeOnValue = computed(() => {
  const t = props.field.type
  if (t === 'select' || t === 'boolean') return true
  if (t === 'date') return props.condition.op === 'before' || props.condition.op === 'after'
  return false
})

const literal = (): unknown =>
  props.condition.value?.kind === 'literal' ? props.condition.value.value : undefined

function emitUpdate(next: Partial<Condition>) {
  emit('update:condition', {
    field: props.condition.field,
    op: props.condition.op,
    ...next,
  })
}

function onFieldChange(e: Event) {
  const key = (e.target as HTMLSelectElement).value
  const f = props.fields.find((x) => x.key === key)
  if (!f) return
  // 切换字段 → 重置为默认操作符并清空值
  emitUpdate({ field: key, op: defaultOpFor(f), value: undefined })
}

function onOpChange(e: Event) {
  const op = (e.target as HTMLSelectElement).value as FilterOp
  // 空值操作符 → 清空值
  const value = op === 'isEmpty' || op === 'isNotEmpty' ? undefined : props.condition.value
  emitUpdate({ op, value })
}

function onValueChange(v: unknown) {
  const value: ConditionValue | undefined =
    v === undefined ? undefined : { kind: 'literal', value: v }
  emitUpdate({ value })
  if (closeOnValue.value) emit('close')
}

function optionList(): Option[] {
  const o = props.field.options
  return typeof o === 'function' ? o() : (o ?? [])
}
</script>

<template>
  <BasePopover :visible="true" :position="position" @close="emit('close')">
    <div class="cond-popover" data-testid="cond-popover">
      <div class="cond-row">
        <select
          class="cond-field"
          data-testid="cond-field"
          :value="props.condition.field"
          @change="onFieldChange"
        >
          <option v-for="f in props.fields" :key="f.key" :value="f.key">{{ f.label }}</option>
        </select>
      </div>
      <div class="cond-row">
        <select
          class="cond-op"
          data-testid="cond-op"
          :value="props.condition.op"
          @change="onOpChange"
        >
          <option v-for="op in ops" :key="op" :value="op">{{ opLabel(op) }}</option>
        </select>
      </div>
      <div class="cond-row">
        <ChipValueEditor
          :field-type="props.field.type"
          :op="props.condition.op"
          :options="optionList()"
          :model-value="literal()"
          @update:model-value="onValueChange"
        />
      </div>
      <div class="cond-actions">
        <button class="cond-remove" type="button" data-testid="cond-remove" @click="emit('remove')">
          删除
        </button>
      </div>
    </div>
  </BasePopover>
</template>

<style scoped>
.cond-popover {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  min-width: 240px;
  box-sizing: border-box;
}
.cond-row {
  display: flex;
}
.cond-field,
.cond-op {
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
.cond-field:focus,
.cond-op:focus {
  border-color: var(--accent);
}
.cond-actions {
  display: flex;
  justify-content: flex-end;
}
.cond-remove {
  border: none;
  background: transparent;
  color: var(--error, #d9534f);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  padding: 2px 4px;
}
.cond-remove:hover {
  text-decoration: underline;
}
</style>
