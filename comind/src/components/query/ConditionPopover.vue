<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Condition, ConditionValue, FieldDescriptor, FilterOp, Option } from '../../core/query'
import { deriveOps } from '../../core/query'
import BasePopover from '../common/BasePopover.vue'
import ChipValueEditor from './ChipValueEditor.vue'
import { defaultOpFor, opLabel } from './filterMeta'

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
  /** 提升为高级（嵌套）筛选。 */
  advanced: []
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

/** ⋯ 二级面板展开状态。 */
const moreOpen = ref(false)
function toggleMore(e: Event) {
  e.stopPropagation()
  moreOpen.value = !moreOpen.value
}
/** 操作后关闭二级面板再 emit。 */
function onRemove() {
  moreOpen.value = false
  emit('remove')
}
function onAdvanced() {
  moreOpen.value = false
  emit('advanced')
}

// 面板弹出后自动聚焦值输入区，提升录入效率：
// 输入框（text/number/select 搜索框）优先，其次首个可交互控件（boolean/date 按钮），
// 再其次短下拉列表的首个可聚焦选项（li[tabindex]）。
// 在 onMounted 同步聚焦：此时值输入区已渲染入 DOM，无需 nextTick（避免焦点延迟一拍）。
const popoverEl = ref<HTMLElement | null>(null)
onMounted(() => {
  const valueRow = popoverEl.value?.querySelector<HTMLElement>('.cond-value-row')
  if (!valueRow) return
  const input = valueRow.querySelector<HTMLElement>('input')
  if (input) {
    input.focus()
    return
  }
  const btn = valueRow.querySelector<HTMLElement>('button')
  if (btn) {
    btn.focus()
    return
  }
  valueRow.querySelector<HTMLElement>('li[tabindex]')?.focus()
})
</script>

<template>
  <BasePopover :visible="true" :position="position" @close="emit('close')">
    <div class="cond-popover" data-testid="cond-popover" ref="popoverEl">
      <!-- Row 1: 字段下拉 + 操作符下拉 + ⋯ 更多 -->
      <div class="cond-top-row">
        <div class="cond-field-op">
          <!-- 字段：带类型图标前缀的下拉 -->
          <select
            class="cond-field"
            data-testid="cond-field"
            :value="props.condition.field"
            @change="onFieldChange"
          >
            <option v-for="f in props.fields" :key="f.key" :value="f.key">
              {{ f.label }}
            </option>
          </select>
          <!-- 操作符：与字段同行内联 -->
          <select
            class="cond-op"
            data-testid="cond-op"
            :value="props.condition.op"
            @change="onOpChange"
          >
            <option v-for="op in ops" :key="op" :value="op">{{ opLabel(op) }}</option>
          </select>
        </div>
        <button class="cond-more" type="button" data-testid="cond-more" title="更多操作" @click="toggleMore">⋯</button>
      </div>

      <!-- Row 2: 值输入 -->
      <div class="cond-value-row">
        <ChipValueEditor
          :field-type="props.field.type"
          :op="props.condition.op"
          :options="optionList()"
          :model-value="literal()"
          @update:model-value="onValueChange"
        />
      </div>

      <!-- Row 3: ⋯ 二级面板（默认折叠，点击 ⋯ 展开） -->
      <div v-if="moreOpen" class="cond-more-panel" data-testid="cond-more-panel">
        <button class="cond-action-link" type="button" data-testid="cond-remove" @click="onRemove">
          🗑 Delete filter
        </button>
        <button class="cond-action-link" type="button" data-testid="cond-advanced" @click="onAdvanced">
          ➕ Add to advanced filter
        </button>
      </div>
    </div>
  </BasePopover>
</template>

<style scoped>
.cond-popover {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  min-width: 260px;
  box-sizing: border-box;
}

/* ── Row 1: field + op 同行 + ⋯ ── */
.cond-top-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cond-field-op {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.cond-field,
.cond-op {
  background: transparent;
  color: var(--text-primary);
  border: none;
  border-radius: var(--radius-sm);
  padding: 5px 6px;
  font-size: var(--text-sm);
  font-family: inherit;
  outline: none;
  cursor: pointer;
  width: auto;
  color-scheme: light dark;
}
/* 字段 select：加粗 + 类型图标前缀（通过 CSS ::before 模拟） */
.cond-field {
  font-weight: 500;
  color: var(--text-primary);
  padding-right: 4px;
  min-width: 0;
}
.cond-field option {
  font-weight: normal;
}
/* 操作符 select */
.cond-op {
  color: var(--text-secondary);
  border-bottom: 1px solid transparent;
}
.cond-field:hover,
.cond-op:hover {
  background: var(--bg-hover);
}
.cond-field:focus,
.cond-op:focus {
  background: var(--bg-hover);
  box-shadow: none;
}

/* ⋯ 更多按钮 */
.cond-more {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 2px;
  border-radius: var(--radius-sm);
}
.cond-more:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

/* ── Row 2: 值输入 ── */
.cond-value-row {
  width: 100%;
}

/* ── Row 3: ⋯ 二级面板 ── */
.cond-more-panel {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
  border-top: 1px solid var(--border);
  margin-top: 2px;
}
.cond-action-link {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  text-align: left;
}
.cond-action-link:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
</style>
