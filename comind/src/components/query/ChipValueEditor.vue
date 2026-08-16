<script setup lang="ts">
/**
 * 分类型条件值编辑器（ADR-0009 D11）。
 *
 * 仅处理 literal 值（ConditionPopover 负责把本组件产出的原始字面量包裹成
 * `{ kind: 'literal', value }`）。按 FieldType 分派编辑器：
 * - text        → 单行输入
 * - number      → 数字输入
 * - date        → before/after 单日期 / between 双日期，内嵌 CalendarPopover(inline)
 * - select      → 可搜索的勾选列表（单选，is / isNot 共用）
 * - multiSelect → 可搜索的勾选列表（多选 → string[]）
 * - boolean     → 是 / 否 分段开关
 * isEmpty / isNotEmpty 无值，渲染占位符。
 *
 * 业务无关：字段类型、操作符、选项全部由 prop 注入，不查询任何业务注册表。
 */
import { computed, ref } from 'vue'
import DatePicker from '../common/DatePicker.vue'
import type { FieldType, FilterOp, Option } from '../../core/query'

const props = withDefaults(
  defineProps<{
    /** 字段数据类型，决定编辑器形态。 */
    fieldType: FieldType
    /** 当前操作符；isEmpty / isNotEmpty 时无值区。 */
    op: FilterOp
    /** select / multiSelect 选项（id + label）。 */
    options?: Option[]
    /** 当前字面量值（由 v-model 双向绑定）。 */
    modelValue?: unknown
  }>(),
  { options: () => [], modelValue: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

const NO_VALUE_OPS: FilterOp[] = ['isEmpty', 'isNotEmpty']
const needsValue = computed(() => !NO_VALUE_OPS.includes(props.op))
/** 区间类日期操作符（between / within 均用 [from, to] 区间值）。 */
const isRangeOp = computed(() => props.op === 'between' || props.op === 'within')

function setVal(v: unknown) {
  emit('update:modelValue', v)
}

/* ---------- text ---------- */
const textVal = computed<string>({
  get: () => (typeof props.modelValue === 'string' ? props.modelValue : ''),
  set: (v) => setVal(v || undefined),
})

/* ---------- number ---------- */
const numVal = computed<string>({
  get: () => (props.modelValue === undefined || props.modelValue === null ? '' : String(props.modelValue)),
  set: (v) => setVal(v === '' ? undefined : Number(v)),
})

/* ---------- select（单选） ---------- */
const search = ref('')
const filteredOptions = computed(() =>
  (props.options ?? []).filter((o) => o.label.toLowerCase().includes(search.value.toLowerCase())),
)
const selectedId = computed<string>(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))

/* ---------- multiSelect（多选） ---------- */
const selectedIds = computed<string[]>(() =>
  Array.isArray(props.modelValue) ? props.modelValue.map(String) : [],
)
function toggleMulti(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  const arr = [...next]
  setVal(arr.length ? arr : undefined)
}

/* ---------- boolean ---------- */
const boolVal = computed<boolean>(() => props.modelValue === true)
function setBool(v: boolean) {
  setVal(v)
}
</script>

<template>
  <!-- isEmpty / isNotEmpty：无值 -->
  <span v-if="!needsValue" class="cve-dash">—</span>

  <!-- text -->
  <input
    v-else-if="fieldType === 'text'"
    class="cve-input"
    type="text"
    :value="textVal"
    :placeholder="op === 'contains' || op === 'notContains' ? '包含文本…' : '输入文本…'"
    data-testid="cve-text"
    @input="textVal = ($event.target as HTMLInputElement).value"
  />

  <!-- number -->
  <input
    v-else-if="fieldType === 'number'"
    class="cve-input"
    type="number"
    :value="numVal"
    placeholder="输入数字…"
    data-testid="cve-number"
    @input="numVal = ($event.target as HTMLInputElement).value"
  />

  <!-- boolean -->
  <div v-else-if="fieldType === 'boolean'" class="cve-bool" data-testid="cve-bool">
    <button :class="{ active: boolVal }" type="button" @click="setBool(true)">是</button>
    <button :class="{ active: !boolVal }" type="button" @click="setBool(false)">否</button>
  </div>

  <!-- select（单选） -->
  <div v-else-if="fieldType === 'select'" class="cve-list" data-testid="cve-select">
    <input
      v-if="(options ?? []).length > 4"
      class="cve-search"
      type="text"
      v-model="search"
      placeholder="搜索…"
    />
    <ul class="cve-options">
      <li
        v-for="o in filteredOptions"
        :key="o.id"
        :class="{ selected: selectedId === o.id }"
        data-testid="cve-option"
        tabindex="-1"
        @click.stop="setVal(o.id)"
      >
        <span class="cve-check">{{ selectedId === o.id ? '✓' : '' }}</span>
        <span class="cve-label">{{ o.label }}</span>
      </li>
      <li v-if="filteredOptions.length === 0" class="cve-empty-item">无匹配选项</li>
    </ul>
  </div>

  <!-- multiSelect（多选） -->
  <div v-else-if="fieldType === 'multiSelect'" class="cve-list" data-testid="cve-multiselect">
    <input
      v-if="(options ?? []).length > 4"
      class="cve-search"
      type="text"
      v-model="search"
      placeholder="搜索…"
    />
    <ul class="cve-options">
      <li
        v-for="o in filteredOptions"
        :key="o.id"
        :class="{ selected: selectedIds.includes(o.id) }"
        data-testid="cve-option"
        tabindex="-1"
        @click.stop="toggleMulti(o.id)"
      >
        <span class="cve-check">{{ selectedIds.includes(o.id) ? '✓' : '' }}</span>
        <span class="cve-label">{{ o.label }}</span>
      </li>
      <li v-if="filteredOptions.length === 0" class="cve-empty-item">无匹配选项</li>
    </ul>
  </div>

  <!-- date（单日期 / 区间，统一走通用 DatePicker） -->
  <DatePicker
    v-else-if="fieldType === 'date'"
    :mode="isRangeOp ? 'range' : 'single'"
    :model-value="(modelValue as string | [string, string] | undefined)"
    data-testid="cve-date"
    @update:model-value="setVal"
  />

  <!-- 未知类型兜底：文本输入 -->
  <input
    v-else
    class="cve-input"
    type="text"
    :value="textVal"
    placeholder="输入值…"
    data-testid="cve-text"
    @input="textVal = ($event.target as HTMLInputElement).value"
  />
</template>

<style scoped>
.cve-input,
.cve-search {
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
.cve-input:focus,
.cve-search:focus {
  border-color: var(--accent);
}

.cve-dash {
  color: var(--text-tertiary);
  padding: 0 2px;
}

.cve-bool {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.cve-bool button {
  border: none;
  background: var(--bg-base);
  color: var(--text-secondary);
  padding: 5px 12px;
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
}
.cve-bool button.active {
  background: var(--accent);
  color: #fff;
}

.cve-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
}
.cve-options {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 200px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cve-options li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--text-primary);
}
.cve-options li:hover {
  background: var(--bg-hover);
}
.cve-options li.selected {
  color: var(--accent);
}
.cve-check {
  width: 14px;
  text-align: center;
  color: var(--accent);
}
.cve-empty-item {
  padding: 6px 8px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  cursor: default;
}
</style>
