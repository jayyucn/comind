<script setup lang="ts">
/**
 * 值编辑器 —— 通用 FilterBuilder 的子组件，按字段类型分派输入控件。
 *
 * 不依赖任何业务模型；完全由传入的 {@link FieldDescriptor} 与当前操作符 `op` 决定渲染形态。
 * 通过 defineModel 以不可变方式向上交出新 value（符合 vue/no-mutating-props）。
 *
 * value 形态约定（与求值器保持一致）：
 * - text / number：原值字符串 / 数字
 * - date：单值字符串（yyyy-MM-dd）；op 为 between 时为 [from, to] 字符串数组
 * - select：选项 id 字符串
 * - multiSelect：选项 id 字符串数组
 * - boolean：true / false
 * - isEmpty / isNotEmpty：无 value（本组件不渲染任何输入）
 */
import { computed } from 'vue'
import type { FieldDescriptor, FilterOp, Option } from '../../core/query'

const props = defineProps<{
  descriptor: FieldDescriptor
  /** 当前操作符；date 的 between 需要双日期输入。 */
  op?: FilterOp
}>()

const model = defineModel<unknown>()

const options = computed<Option[]>(() => {
  const opts = props.descriptor.options
  if (!opts) return []
  return typeof opts === 'function' ? opts() : opts
})

const isEmptyOp = computed(() => props.op === 'isEmpty' || props.op === 'isNotEmpty')
const isRange = computed(() => props.op === 'between')

// number：输入为文本，转 number（空串视为 null）
const numberText = computed<string>({
  get: () => (model.value === undefined || model.value === null ? '' : String(model.value)),
  set: (v) => {
    model.value = v === '' ? null : Number(v)
  },
})

// date：单值或 [from, to] 区间
function rangeValue(i: 0 | 1): string {
  return Array.isArray(model.value) ? (model.value[i] ?? '') : ''
}
function setRange(i: 0 | 1, v: string) {
  const arr: [string, string] = Array.isArray(model.value) ? [model.value[0] ?? '', model.value[1] ?? ''] : ['', '']
  arr[i] = v
  model.value = arr
}

// multiSelect：id 数组勾选
function isChecked(id: string): boolean {
  return Array.isArray(model.value) && model.value.map(String).includes(id)
}
function toggleMulti(id: string) {
  const arr = Array.isArray(model.value) ? [...model.value.map(String)] : []
  const idx = arr.indexOf(id)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(id)
  model.value = arr
}

// boolean：select 值映射 true/false
const boolText = computed<string>({
  get: () => (model.value === true ? 'true' : model.value === false ? 'false' : ''),
  set: (v) => {
    model.value = v === 'true' ? true : v === 'false' ? false : null
  },
})
</script>

<template>
  <!-- 空值操作符：无值编辑器 -->
  <span v-if="isEmptyOp" class="qb-value qb-value-empty">无需值</span>

  <!-- text：文本输入 -->
  <input v-else-if="descriptor.type === 'text'" class="qb-value" type="text" v-model="model" placeholder="值…" />

  <!-- number：数字输入 -->
  <input v-else-if="descriptor.type === 'number'" class="qb-value" type="number" v-model="numberText" placeholder="数值…" />

  <!-- date：单日期 / 区间（between） -->
  <template v-else-if="descriptor.type === 'date'">
    <input
      class="qb-value"
      type="date"
      :value="rangeValue(0)"
      @input="setRange(0, ($event.target as HTMLInputElement).value)"
    />
    <input
      v-if="isRange"
      class="qb-value"
      type="date"
      :value="rangeValue(1)"
      @input="setRange(1, ($event.target as HTMLInputElement).value)"
    />
  </template>

  <!-- select：单选项下拉（值存 id） -->
  <select v-else-if="descriptor.type === 'select'" class="qb-value" v-model="model">
    <option v-for="o in options" :key="o.id" :value="o.id">{{ o.label }}</option>
  </select>

  <!-- multiSelect：复选项（值存 id 数组） -->
  <div v-else-if="descriptor.type === 'multiSelect'" class="qb-multi">
    <label v-for="o in options" :key="o.id" class="qb-multi-item">
      <input type="checkbox" :checked="isChecked(o.id)" @change="toggleMulti(o.id)" />
      <span>{{ o.label }}</span>
    </label>
  </div>

  <!-- boolean：是/否 -->
  <select v-else-if="descriptor.type === 'boolean'" class="qb-value" v-model="boolText">
    <option value="true">是</option>
    <option value="false">否</option>
  </select>

  <!-- 自定义/未知类型：退化为文本输入 -->
  <input v-else class="qb-value" type="text" v-model="model" placeholder="值…" />
</template>

<style lang="scss" scoped>
.qb-value {
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

.qb-value-empty {
  color: var(--text-tertiary, #999);
  font-size: var(--text-xs, 12px);
  border-style: dashed;
}

.qb-multi {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.qb-multi-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm, 13px);
  color: var(--text-secondary, #444);
  cursor: pointer;
}
</style>
