<script setup lang="ts">
/**
 * 值编辑器 —— 通用 FilterBuilder 的子组件，按字段类型分派输入控件。
 *
 * 设计契约：**不依赖任何业务模型**。完全由传入的 {@link FieldDescriptor} 与当前操作符 `op` 决定渲染形态，
 * 以及由调用方注入的通用数据（同类型字段来自 registry、跨记录候选来自 `crossRecordSources`）。
 * 跨记录引用所需的「目标记录字段清单」由 `crossRecordSources` 随记录一并带来，编辑器本身不查询任何业务注册表。
 *
 * 值形态（字段引用值特性，与求值器保持一致）：ConditionValue 判别联合
 * - 字面量 `{ kind:'literal', value }`：原值（text/number 字符串、date yyyy-MM-dd 或 [from,to]、select id、multiSelect id[]、boolean）
 * - 同记录字段引用 `{ kind:'field', field }`：顶部「字段」开关切换，下拉选同类型字段
 * - 跨记录字段引用 `{ kind:'recordRef', entityType, recordId, field }`：「固定值」模式下点输入框内 `+` → 引用值 → 其他记录
 *
 * isEmpty / isNotEmpty：无值编辑器（由 ConditionRow 隐藏本组件）。
 * between：仅支持字面量区间，不开放字段/记录引用（v1 范围）。切到 between 时丢弃已有的引用值，避免静默退化为 equals。
 * 通过 defineModel 以不可变方式向上交出新 ConditionValue（符合 vue/no-mutating-props）。
 */
import { EllipsisVertical, File, Tag, X } from 'lucide-vue-next'
import { computed, nextTick, ref } from 'vue'
import type {
  ConditionValue,
  FieldDescriptor,
  FilterOp,
  Option,
  ReferenceableRecord,
  Registry,
} from '../../core/query'
import DatePicker from '../common/DatePicker.vue'
import CrossRecordRefPicker from './CrossRecordRefPicker.vue'

const props = withDefaults(
  defineProps<{
    descriptor: FieldDescriptor
    /** 当前操作符；date 的 between 需要双日期输入且不开放引用。 */
    op?: FilterOp
    /** 实体命名空间，用于列举同类型字段。 */
    entityType: string
    registry: Registry
    /** 当前条件字段 key，用于从同类型候选中排除自身。 */
    conditionField?: string
    /**
     * 跨记录引用候选记录列表（通用，业务无关）：每条自带 id / title / entityType / fields。
     * 不传则隐藏「其他记录…」入口。业务方（如 PagesLibrary）负责把自身模型翻译为这个通用结构。
     */
    crossRecordSources?: ReferenceableRecord[]
    /**
     * 是否开放引用控件（字段引用下拉 / 「+」引用菜单）。chip 快捷编辑路径（ConditionPopover）
     * 传 false 保持仅字面量输入（ADR-0022 Q5）；默认 true。
     */
    allowRefs?: boolean
  }>(),
  // 注意：type-only defineProps 会把「未传的可选布尔 prop」在运行时默认成 false（而非 undefined），
  // 必须用 withDefaults 显式给定 true，否则默认关闭会误伤 FilterBuilder 等需要引用控件的调用方。
  { allowRefs: true },
)

const model = defineModel<ConditionValue | undefined>()

const options = computed<Option[]>(() => {
  const opts = props.descriptor.options
  if (!opts) return []
  return typeof opts === 'function' ? opts() : opts
})

const isEmptyOp = computed(() => props.op === 'isEmpty' || props.op === 'isNotEmpty')
const isRange = computed(() => props.op === 'between' || props.op === 'within')
/** 是否展示引用控件（字段开关 / + 菜单）：仅比较类 op、非 between，且未用 allowRefs 关闭。 */
const showRefControls = computed(() => props.allowRefs !== false && !isEmptyOp.value && !isRange.value)

const kind = computed(() => model.value?.kind)
const isFieldRef = computed(() => kind.value === 'field')
const isRecordRef = computed(() => kind.value === 'recordRef')
/** 顶部开关形态：字段引用 → 字段；其余（字面量 / 记录引用）→ 固定值。 */
const mode = computed<'literal' | 'field'>(() => (isFieldRef.value ? 'field' : 'literal'))

// 同类型候选字段（排除当前字段），供「字段」开关与「引用当前记录字段」使用
const sameTypeFields = computed<FieldDescriptor[]>(() =>
  props.registry
    .list(props.entityType)
    .filter((f) => f.type === props.descriptor.type && f.key !== props.conditionField),
)

// —— 字面量读写（始终包裹为 { kind:'literal', value }）——
function getLiteral(): unknown {
  return model.value?.kind === 'literal' ? model.value.value : undefined
}
function setLiteral(v: unknown) {
  model.value = { kind: 'literal', value: v }
}

const numberText = computed<string>({
  get: () => (getLiteral() === undefined || getLiteral() === null ? '' : String(getLiteral())),
  set: (v) => setLiteral(v === '' ? null : Number(v)),
})

function isChecked(id: string): boolean {
  const v = getLiteral()
  return Array.isArray(v) && v.map(String).includes(id)
}
function toggleMulti(id: string) {
  const cur = getLiteral()
  const arr = Array.isArray(cur) ? [...cur.map(String)] : []
  const idx = arr.indexOf(id)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(id)
  setLiteral(arr)
}

const boolText = computed<string>({
  get: () => (getLiteral() === true ? 'true' : getLiteral() === false ? 'false' : ''),
  set: (v) => setLiteral(v === 'true' ? true : v === 'false' ? false : null),
})

// —— 字段引用（同记录）——
const fieldSelectValue = computed<string>(() =>
  model.value?.kind === 'field' ? model.value.field : (sameTypeFields.value[0]?.key ?? ''),
)
function onFieldRefChange(e: Event) {
  const key = (e.target as HTMLSelectElement).value
  if (key) model.value = { kind: 'field', field: key }
}
function setMode(m: 'literal' | 'field') {
  if (m === 'field') {
    const first = sameTypeFields.value[0]
    model.value = first ? { kind: 'field', field: first.key } : undefined
  } else {
    model.value = undefined
  }
}

// —— 字段标签解析（统一入口）——
// 同记录字段（field）与跨记录字段（recordRef）的「字段标签」统一到一处解析：
// 优先从注入的跨记录候选（业务无关）取同实体字段，回退到引擎 Registry。
// 编辑器不再区分两条解析路径，且不查询任何业务注册表。
function resolveFieldLabel(entityType: string, fieldKey: string, preferSourceId?: string): string {
  const byId = preferSourceId ? props.crossRecordSources?.find((s) => s.id === preferSourceId) : undefined
  const byEntity = props.crossRecordSources?.find((s) => s.entityType === entityType)
  const src = byId ?? byEntity
  return (
    src?.fields.find((f) => f.key === fieldKey)?.label ??
    props.registry.get(entityType, fieldKey)?.label ??
    fieldKey
  )
}

// —— 跨记录引用预览 ——
// 标签完全来自 crossRecordSources（与编辑器注入的候选同源），不再查任何业务注册表。
const refPreview = computed<{ target: 'record' | 'field'; text: string } | null>(() => {
  const v = model.value
  if (!v) return null
  if (v.kind === 'field') {
    return { target: 'field', text: resolveFieldLabel(props.entityType, v.field) }
  }
  if (v.kind === 'recordRef') {
    const src = props.crossRecordSources?.find((s) => s.id === v.recordId)
    const title = src?.title ?? v.recordId
    const fieldLabel = resolveFieldLabel(v.entityType, v.field, v.recordId)
    return { target: 'record', text: `${title} · ${fieldLabel}` }
  }
  return null
})
function clearRef() {
  model.value = undefined
}

// —— + 菜单（引用值）——
type MenuView = 'root' | 'recordField' | 'recordRef'
const menuOpen = ref(false)
const menuView = ref<MenuView>('root')
/** 触发按钮与弹层 DOM，用于把弹层 teleport 到 body 并以 fixed 定位（避免被 FilterBuilder 面板的 overflow 裁切）。 */
const refBtn = ref<HTMLButtonElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const anchor = ref<{ x: number; y: number }>({ x: 0, y: 0 })

function placeMenu() {
  const btn = refBtn.value
  if (!btn) return
  const r = btn.getBoundingClientRect()
  let x = r.left
  let y = r.bottom + 4
  const el = menuEl.value
  if (el && typeof window !== 'undefined') {
    const vw = window.innerWidth
    const vh = window.innerHeight
    // 右/下溢出视口时收边；下方空间不足则向上翻
    if (x + el.offsetWidth > vw - 8) x = Math.max(8, vw - el.offsetWidth - 8)
    if (y + el.offsetHeight > vh - 8) y = Math.max(8, r.top - el.offsetHeight - 4)
  }
  anchor.value = { x, y }
}

function openMenu() {
  menuView.value = 'root'
  menuOpen.value = true
  nextTick(placeMenu)
}
function closeMenu() {
  menuOpen.value = false
}
function chooseRecordField(key: string) {
  model.value = { kind: 'field', field: key }
  closeMenu()
}
function chooseRecordRef(sourceId: string, entityType: string, field: string) {
  model.value = { kind: 'recordRef', entityType, recordId: sourceId, field }
  closeMenu()
}
</script>

<template>
  <div class="qb-value-wrap">
    <!-- 跨记录引用：芯片预览（不可编辑，× 清除） -->
    <div v-if="isRecordRef && refPreview && !isRange" class="qb-ref-chip">
      <component :is="refPreview.target === 'record' ? File : Tag" :size="13" class="qb-ref-ico" />
      <span class="qb-ref-text">{{ refPreview.text }}</span>
      <button type="button" class="qb-icon" title="清除引用" @click="clearRef">
        <X :size="13" />
      </button>
    </div>

    <!-- 同记录字段引用：字段下拉 + 清除按钮回到字面量（mode==='field' 始终渲染，不因无同类型字段而跌落到字面量分支） -->
    <div v-else-if="mode === 'field' && showRefControls" class="qb-field-row">
      <select
        class="qb-value"
        :value="fieldSelectValue"
        @change="onFieldRefChange"
      >
        <option v-for="f in sameTypeFields" :key="f.key" :value="f.key">{{ f.label }}</option>
      </select>
      <button type="button" class="qb-icon" title="清除引用" @click="setMode('literal')">
        <X :size="14" />
      </button>
    </div>

    <!-- 字面量输入：仅当非「字段引用」且非「记录引用」时渲染（v-else 承接上方两条分支）。
         + 引用入口按钮置于输入框前面（左侧）。 -->
    <div v-else class="qb-input-row">
      <!-- + 菜单入口：引用值（当前记录字段 / 其他记录），放在输入框前面 -->
      <button
        v-if="showRefControls"
        ref="refBtn"
        type="button"
        class="qb-ref-btn"
        title="引用值"
        @click="openMenu"
      >
        <EllipsisVertical :size="14" />
      </button>

      <span v-if="isEmptyOp" class="qb-value qb-value-empty">无需值</span>

      <input
        v-else-if="descriptor.type === 'text'"
        class="qb-value"
        type="text"
        :value="getLiteral() as string"
        @input="setLiteral(($event.target as HTMLInputElement).value)"
        placeholder="值…"
      />

      <input
        v-else-if="descriptor.type === 'number'"
        class="qb-value"
        type="number"
        v-model="numberText"
        placeholder="数值…"
      />

      <template v-else-if="descriptor.type === 'date'">
        <DatePicker
          :mode="isRange ? 'range' : 'single'"
          :model-value="(getLiteral() as string | [string, string] | undefined)"
          data-testid="qb-date"
          @update:model-value="setLiteral($event)"
        />
      </template>

      <select
        v-else-if="descriptor.type === 'select'"
        class="qb-value"
        :value="getLiteral() as string"
        @change="setLiteral(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="o in options" :key="o.id" :value="o.id">{{ o.label }}</option>
      </select>

      <div v-else-if="descriptor.type === 'multiSelect'" class="qb-multi">
        <label v-for="o in options" :key="o.id" class="qb-multi-item">
          <input type="checkbox" :checked="isChecked(o.id)" @change="toggleMulti(o.id)" />
          <span>{{ o.label }}</span>
        </label>
      </div>

      <select
        v-else-if="descriptor.type === 'boolean'"
        class="qb-value"
        v-model="boolText"
      >
        <option value="true">是</option>
        <option value="false">否</option>
      </select>

      <input
        v-else
        class="qb-value"
        type="text"
        :value="getLiteral() as string"
        @input="setLiteral(($event.target as HTMLInputElement).value)"
        placeholder="值…"
      />
    </div>

    <!-- 引用值弹出层：teleport 到 body，fixed 定位，避免被 FilterBuilder 面板 overflow 裁切 -->
    <Teleport to="body">
      <div
        v-if="menuOpen"
        ref="menuEl"
        class="qb-popover-root"
        :style="{ left: anchor.x + 'px', top: anchor.y + 'px' }"
      >
        <div class="qb-popover-backdrop" @click="closeMenu"></div>
        <div class="qb-popover">
        <template v-if="menuView === 'root'">
          <p class="qb-pop-title">引用值</p>
          <button
            v-if="sameTypeFields.length > 0"
            type="button"
            class="qb-pop-item"
            @click="menuView = 'recordField'"
          >
            <Tag :size="13" /> 当前记录字段
          </button>
          <button
            v-if="crossRecordSources && crossRecordSources.length > 0"
            type="button"
            class="qb-pop-item"
            @click="menuView = 'recordRef'"
          >
            <File :size="13" /> 其他记录…
          </button>
          <p v-if="sameTypeFields.length === 0 && (!crossRecordSources || crossRecordSources.length === 0)" class="qb-pop-empty">
            无可引用来源
          </p>
        </template>

        <template v-else-if="menuView === 'recordField'">
          <p class="qb-pop-title">当前记录字段</p>
          <button
            v-for="f in sameTypeFields"
            :key="f.key"
            type="button"
            class="qb-pop-item"
            @click="chooseRecordField(f.key)"
          >
            {{ f.label }}
          </button>
        </template>

        <template v-else-if="menuView === 'recordRef'">
          <CrossRecordRefPicker
            :sources="crossRecordSources ?? []"
            :descriptor-type="descriptor.type"
            @select="chooseRecordRef"
            @cancel="closeMenu"
          />
        </template>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<style lang="scss" scoped>
.qb-value-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

// 字面量输入行：+ 引用按钮置于输入框前面（左侧），输入框占满剩余空间
.qb-input-row {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
}

// 同记录字段引用行：下拉 + 清除按钮
.qb-field-row {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
}

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

// 引用值 + 按钮：置于输入框前面（左侧），普通按钮
.qb-ref-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  // width: 26px;
  height: 26px;
  flex: 0 0 auto;
  // border: 1px dashed var(--border);
  // border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary, #999);
  cursor: pointer;

  &:hover {
    border-color: var(--accent, #6366f1);
    color: var(--accent, #6366f1);
  }
}

.qb-ref-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 6px 3px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-base2, var(--bg-base));
  color: var(--text-primary);
  font-size: var(--text-sm, 13px);
  flex: 1;
  min-width: 0;
}

.qb-ref-ico {
  color: var(--accent, #6366f1);
  flex: 0 0 auto;
}

.qb-ref-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qb-popover-root {
  position: fixed;
  z-index: var(--z-popover-nested);
}

.qb-popover-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
}

.qb-popover {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-base);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}

.qb-pop-title {
  margin: 0 0 2px;
  font-size: var(--text-xs, 12px);
  color: var(--text-tertiary, #999);
}

.qb-pop-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm, 13px);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
  }
}

.qb-pop-empty {
  margin: 0;
  font-size: var(--text-xs, 12px);
  color: var(--text-tertiary, #999);
}

.qb-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
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
