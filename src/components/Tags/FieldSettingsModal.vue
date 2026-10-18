<script setup lang="ts">
import { AlertTriangle, X } from 'lucide-vue-next'
import { computed, reactive, ref, watch } from 'vue'

import { useModalKeyboardRef } from '../../composables/useModalKeyboard'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import { useTagsStore } from '../../stores/tags'
import { specHeadOf } from '../../types/field-type-registry'
import type { UpdateFieldDefinitionParams } from '../../types/tag-persisted'
import { displayFormOptionsFor } from '../../utils/field-display-form'
import { decodeDefaultJson, encodeDefaultJson, FIELD_HIDE_OPTIONS, normalizeHideWhen } from '../../utils/field-hide'
import { DEFAULT_CURRENCY_SYMBOL, parseCurrencySpec } from '../../utils/field-number-format'
import { FIELD_SPEC_OPTIONS, type SpecFamily } from '../../utils/field-spec-options'
import { fieldSpecIcon, fieldTypeIcon } from '../../utils/field-type-icons'
import { initCoreClient } from '../../wasm/client'
import SegmentedControl from '../common/SegmentedControl.vue'
import ConfirmDialog from '../ConfirmDialog.vue'

/**
 * 完整字段设置弹窗（ADR-0057 D1/D4）：字段定义的全量配置承载。
 *
 * 受控组件（仿 BlockModal）：fieldId 非空时显示，close 事件由父级（App 级 editorStore
 * fieldSettingsFieldId）清空。所有编辑均为**草稿**，「保存」一次性走
 * tagsStore.updateFieldDefinition 单源写库（ADR-0057 D5）；有脏草稿时关闭需确认。
 *
 * 布局 = Tana 式单页两列行（左窄标签 + 右宽控件）：类型（条件区紧随其下）→
 * 默认值 → 展示形态 → 隐藏（hide_when 五档）→ 使用于（默认折叠的有值块列表，
 * 点击块项打开 BlockModal）→ 操作（删除字段，二次确认）。
 */
const props = defineProps<{
  /** 打开的字段定义 id；null/空串时弹窗关闭。 */
  fieldId: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

const editorStore = useEditorStore()
const tagsStore = useTagsStore()
const blockStore = useBlockStore()

/** 单例 client promise（与 stores 内 getClient 同约定：初始化一次，复用）。 */
let clientPromise: ReturnType<typeof initCoreClient> | null = null
async function getClient() {
  if (!clientPromise) clientPromise = initCoreClient()
  const client = await clientPromise
  if (!client) throw new Error('Core client not initialized')
  return client
}

const visible = computed(() => !!props.fieldId)
// 常驻组件：维护全局模态栈（Enter 拦截等消费 hasModalOpen）
useModalKeyboardRef('field-settings-modal', visible)

// ── 字段定义与草稿 ─────────────────────────────────────────────
const fieldDef = computed(() =>
  props.fieldId ? tagsStore.fieldDefinitions.find((d) => d.id === props.fieldId) ?? null : null,
)

interface FieldDraft {
  title: string
  description: string
  type: string
  closedValues: string[]
  defaultValue: string
  hideWhen: string
  displayFormOverride: string
  min: string
  max: string
  step: string
  spec: string
}

function draftOf(): FieldDraft {
  const d = fieldDef.value
  return {
    title: d?.title ?? '',
    description: d?.description ?? '',
    type: d?.type ?? 'string',
    closedValues: d?.closed_values ? [...d.closed_values] : [],
    // 落库形态是 JSON 文本（decodeDefaultJson 的消费契约）→ 回填先解成人读值，
    // 保存再编码回去；直通会造成「框里带引号 / 非法 JSON 静默失效」双 bug。
    defaultValue: decodeDefaultJson(d?.default_value),
    hideWhen: normalizeHideWhen(d?.hide_when),
    displayFormOverride: d?.display_form_override ?? 'auto',
    min: d?.min != null ? String(d.min) : '',
    max: d?.max != null ? String(d.max) : '',
    step: d?.step != null ? String(d.step) : '',
    spec: d?.spec ?? '',
  }
}

const draft = reactive<FieldDraft>(draftOf())
const usedExpanded = ref(false)
const usedBlocks = ref<{ id: string; content: string }[]>([])
const usedLoading = ref(false)
const showDeleteConfirm = ref(false)
const showDiscardConfirm = ref(false)
const saving = ref(false)

// 打开 / 换字段：重置草稿与「使用于」展开态
watch(
  () => [props.fieldId, fieldDef.value?.updated_at, fieldDef.value?.version] as const,
  () => {
    if (!props.fieldId) return
    Object.assign(draft, draftOf())
    usedExpanded.value = false
    usedBlocks.value = []
  },
  { immediate: true },
)

/** 草稿是否脏（与落库值有差异）——关闭路径的确认判据（ADR-0057 D5）。 */
const dirty = computed(() => {
  const base = draftOf()
  return (Object.keys(base) as (keyof FieldDraft)[]).some((k) => {
    if (k === 'closedValues') return JSON.stringify(base.closedValues) !== JSON.stringify(draft.closedValues)
    return base[k] !== draft[k]
  })
})

const isSystem = computed(() => fieldDef.value?.is_system ?? false)
const isEnumType = computed(() => draft.type === 'select' || draft.type === 'multiSelect')
const isNumberType = computed(() => draft.type === 'number')
/** 特化行仅对三个特化族底层类型开放（string/number/page，issue T6/T7/T10）。 */
const supportsSpec = computed(() => ['string', 'number', 'page'].includes(draft.type))
/** 当前特化首段（分段控制的取值；currency 的参数化后缀不进分段）。 */
const specHead = computed(() => specHeadOf(draft.spec))
/** 本类型的特化选项（含「无」档；键封闭，supportsSpec 已保证命中）。 */
const specOptions = computed(() => FIELD_SPEC_OPTIONS[draft.type as SpecFamily])
/**
 * 类型切换：spec 归类型族所有（换类型重置，防残留复活——ADR 既有原则同款）；
 * 默认值形态随类型走（string 的 "a@b.c" 对 number 非法）→ 一并清空。
 * 挂在 @change 上而非 watch(draft.type)：换字段走 Object.assign 整体回填，
 * watch 会把新字段的合法值误清。
 */
function onChangeType() {
  draft.spec = ''
  draft.defaultValue = ''
}

/**
 * 特化分段落稿：head 写回 draft.spec；currency 保持原符号配置（默认 ¥ 省略），
 * 单位由级联的单位行单独维护。空 = 无特化（保存侧归一为 null）。
 */
function onChangeSpecHead(next: string) {
  if (next === '') {
    draft.spec = ''
    return
  }
  if (next === 'currency') {
    const { symbol } = parseCurrencySpec(draft.spec)
    draft.spec = symbol === DEFAULT_CURRENCY_SYMBOL ? 'currency' : `currency:${symbol}`
    return
  }
  draft.spec = next
}

/** currency 单位落稿：编码进 spec（'currency:<symbol>/<unit>'），符号维持原配置。 */
function onChangeCurrencyUnit(e: Event) {
  const unit = (e.target as HTMLInputElement).value.trim()
  const { symbol } = parseCurrencySpec(draft.spec)
  draft.spec = unit
    ? `currency:${symbol === DEFAULT_CURRENCY_SYMBOL ? '' : symbol}/${unit}`
    : symbol === DEFAULT_CURRENCY_SYMBOL
      ? 'currency'
      : `currency:${symbol}`
}

// ── 默认值编辑器分派（(type, specHead) → 控件，ADR-0057 ③）──────
// 与块字段区「字段值专属控件家族」同构：数字走 number、布尔走三态、
// 枚举走选项点选；string 族 / date / datetime 等保持文本 + 特化感知提示。

const defaultEditor = computed<'number' | 'boolean' | 'enum' | 'text'>(() => {
  if (draft.type === 'number') return 'number'
  if (draft.type === 'boolean') return 'boolean'
  if (isEnumType.value) return 'enum'
  return 'text'
})

/** 文本形态的特化感知 placeholder（提示格式期望，弱约束——默认值不做强校验）。 */
const defaultPlaceholder = computed(() => {
  if (defaultEditor.value !== 'text') return '无默认'
  if (draft.type === 'string') {
    const head = specHeadOf(draft.spec)
    if (head === 'email') return 'name@example.com'
    if (head === 'url') return 'https://example.com'
    if (head === 'phone') return '+86 138 0000 0000'
  }
  return '无默认'
})

// ── 类型下拉 ──────────────────────────────────────────────────
const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'string', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '开关' },
  { value: 'date', label: '日期' },
  { value: 'datetime', label: '日期时间' },
  { value: 'daterange', label: '日期区间' },
  { value: 'select', label: '单选' },
  { value: 'multiSelect', label: '多选' },
  { value: 'array', label: '标签数组' },
  { value: 'page', label: '页面引用' },
  { value: 'file', label: '附件' },
  { value: 'relation', label: '关系引用' },
  { value: 'formula', label: '公式' },
  { value: 'json', label: 'JSON' },
  { value: 'color', label: '颜色' },
  { value: 'autonumber', label: '自增编号' },
  { value: 'geo', label: '地理位置' },
]
/**
 * 展示形态下拉按字段类型配置（评估纪要 + 用户裁定：枚举选项随字段类型走）。
 * 每种类型只给有意义、可达的形态——boolean 给 勾叉/开关/文字，枚举给 胶囊/文字，
 * 有图标来源的系统字段给 图标/图标+文字/胶囊/文字，其余只给 文字。
 * 直接收编自 field-display-form.displayFormOptionsFor 单源，避免下拉与渲染两处漂移。
 */
const availableFormOptions = computed(() =>
  displayFormOptionsFor({ type: draft.type, key: fieldDef.value?.key ?? null }),
)

/**
 * 头部图标：选中特化后跟随特化语义（货币/评分/负责人…），无特化回落类型图标。
 * 与 FieldLabel 入口的类型图标（fieldTypeIcon）同源；特化是规格细分，图标细分为特化。
 */
const headerIcon = computed(() => fieldSpecIcon(specHeadOf(draft.spec)) ?? fieldTypeIcon(draft.type))

// ── 选项编辑（closed_values chips）────────────────────────────
const newOption = ref('')
function addOption() {
  const v = newOption.value.trim()
  if (!v || draft.closedValues.includes(v)) return
  draft.closedValues.push(v)
  newOption.value = ''
}
function removeOption(i: number) {
  draft.closedValues.splice(i, 1)
}

// ── 使用于（有值块反查，ADR-0057 D4）──────────────────────────
async function toggleUsed() {
  usedExpanded.value = !usedExpanded.value
  if (!usedExpanded.value || !props.fieldId) return
  usedLoading.value = true
  try {
    const client = await getClient()
    const values = await client.getFieldValuesByField(props.fieldId)
    const ids = [...new Set(values.map((v: { block_id: string }) => v.block_id))] as string[]
    // 已缓存块直接用；未缓存的**主动 loadBlock**（否则未加载的块会被误判为
    // 「无内容或块已删除」）。loadBlock 内部对已存在块直接返回缓存，未命中才 IPC
    // 加载；加载仍失败（真不存在 / 已删除 / 底层异常）回落占位文案。
    const loaded = await Promise.all(
      ids.map(async (id) => {
        const cached = blockStore.getBlock(id)
        if (cached) return cached
        return (await blockStore.loadBlock(id)) ?? { id, content: '' }
      }),
    )
    usedBlocks.value = loaded.map((b) => ({
      id: b.id,
      content: b.content?.trim() || '（无内容或块已删除）',
    }))
  } catch {
    usedBlocks.value = []
  } finally {
    usedLoading.value = false
  }
}

function openBlock(blockId: string) {
  editorStore.openBlockModal(blockId)
}

// ── 保存（草稿一次性写库，ADR-0057 D5）────────────────────────
function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function save() {
  if (!props.fieldId || saving.value) return
  saving.value = true
  try {
    // 归一：仅允许该类型「可达」的形态值；其余（如类型从开关切到单选后残留的
    // icon/switch 覆盖）一律回落 auto，防不可达形态落库（与 UI 下拉收敛口径一致）。
    const allowed = displayFormOptionsFor({ type: draft.type, key: fieldDef.value?.key ?? null })
    const displayFormOverride =
      isSystem.value || !allowed.some((o) => o.value === draft.displayFormOverride)
        ? 'auto'
        : draft.displayFormOverride
    const params: UpdateFieldDefinitionParams = {
      id: props.fieldId,
      title: draft.title.trim(),
      type: draft.type,
      // relation 字段复用 closed_values[0] 存约定的关系类型 id（见 RelationRefEditor 配置位），
      // 仅枚举类型可编辑选项；非枚举但属 relation 时须保留已配置的 closed_values，否则保存即清空。
      closed_values: (isEnumType.value || draft.type === 'relation')
        ? (draft.closedValues.length ? [...draft.closedValues] : null)
        : null,
      default_value: encodeDefaultJson(draft.type, draft.defaultValue),
      hide_when: normalizeHideWhen(draft.hideWhen),
      // D21 决策 6 双保险：UI 已禁用，保存侧仍归一 auto（防程序化写入绕过门禁）
      display_form_override: displayFormOverride,
      min: isNumberType.value ? numOrNull(draft.min) : null,
      max: isNumberType.value ? numOrNull(draft.max) : null,
      step: isNumberType.value ? numOrNull(draft.step) : null,
      spec: supportsSpec.value && draft.spec.trim() !== '' ? draft.spec.trim() : null,
      description: draft.description.trim() === '' ? null : draft.description.trim(),
    }
    await tagsStore.updateFieldDefinition(params)
    emit('close')
  } finally {
    saving.value = false
  }
}

// ── 删除（二次确认，ADR-0057 D4）──────────────────────────────
async function doDelete() {
  if (!props.fieldId) return
  const client = await getClient()
  await client.deleteFieldDefinition(props.fieldId)
  await tagsStore.ensureLoaded(true)
  showDeleteConfirm.value = false
  emit('close')
}

// ── 关闭路径：脏草稿 → 确认放弃（ADR-0057 D5）─────────────────
function requestClose() {
  if (dirty.value) {
    showDiscardConfirm.value = true
    return
  }
  emit('close')
}

function confirmDiscard() {
  showDiscardConfirm.value = false
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="field-settings-fade">
      <div
        v-if="visible && fieldDef"
        class="field-settings-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="`字段设置：${fieldDef.title}`"
        @click.self="requestClose"
        @keydown.esc="requestClose"
      >
        <div class="field-settings-modal">
          <header class="modal-header">
            <span
              class="modal-title-icon"
              aria-hidden="true"
            >
              <component
                :is="headerIcon"
                :size="16"
              />
            </span>
            <div class="head-fields">
              <input
                v-model="draft.title"
                class="head-name"
                placeholder="字段名"
                :disabled="isSystem"
                :aria-label="`字段名：${fieldDef.title}`"
              >
              <input
                v-model="draft.description"
                class="head-desc"
                placeholder="添加描述（说明这个字段的用途）"
                :disabled="isSystem"
                :aria-label="`字段描述：${fieldDef.title}`"
              >
            </div>
            <div class="head-actions">
              <span
                class="modal-esc-hint"
                aria-hidden="true"
              >Esc</span>
              <button
                class="modal-action modal-action-close"
                type="button"
                title="关闭 (Esc)"
                data-testid="field-settings-close"
                @click="requestClose"
              >
                <X :size="18" />
              </button>
            </div>
          </header>

          <div
            class="global-hint"
            :class="{ 'global-hint--readonly': isSystem }"
          >
            <AlertTriangle :size="13" />
            <span>{{ isSystem
              ? '系统字段为内置定义，只读——所有配置由类型决定，不可修改。'
              : '字段定义全局共享：修改将作用于所有引用该字段的标签、block 字段区与查询视图。' }}</span>
          </div>

          <div class="modal-body">
            <!-- 字段类型（条件区紧随其下，Tana 范式） -->
            <div class="row-line">
              <label class="row-label">字段类型</label>
              <div class="row-ctrl">
                <select
                  v-model="draft.type"
                  class="mini-select"
                  :disabled="isSystem"
                  aria-label="字段类型"
                  @change="onChangeType"
                >
                  <option
                    v-for="t in TYPE_OPTIONS"
                    :key="t.value"
                    :value="t.value"
                  >
                    {{ t.label }}
                  </option>
                </select>
                <div class="field-hint">
                  切换类型后块上已有值保留，保存时生效
                </div>
              </div>
            </div>

            <!-- 类型条件区：选项（select/multiSelect） -->
            <div
              v-if="isEnumType"
              class="row-line sub"
            >
              <label class="row-label">选项</label>
              <div class="row-ctrl">
                <div class="opt-list">
                  <span
                    v-for="(opt, i) in draft.closedValues"
                    :key="opt"
                    class="opt-chip"
                  >
                    {{ opt }}
                    <button
                      v-if="!isSystem"
                      class="opt-del"
                      type="button"
                      :aria-label="`删除选项 ${opt}`"
                      @click="removeOption(i)"
                    >
                      ×
                    </button>
                  </span>
                  <input
                    v-if="!isSystem"
                    v-model="newOption"
                    class="mini-input opt-add-input"
                    placeholder="+ 添加选项，回车确认"
                    @keydown.enter.prevent="addOption"
                  >
                </div>
                <div class="field-hint">
                  每个选项将作为一个可选值；清空全部选项 = 降级为非选项型
                </div>
              </div>
            </div>

            <!-- 类型条件区：数值约束（number，ADR-0055 D5） -->
            <div
              v-if="isNumberType"
              class="row-line sub"
            >
              <label class="row-label">数值约束</label>
              <div class="row-ctrl">
                <div class="num-trio">
                  <input
                    v-model="draft.min"
                    class="mini-input"
                    type="number"
                    placeholder="min"
                    :disabled="isSystem"
                    aria-label="最小值"
                  ><span>最小</span>
                  <input
                    v-model="draft.max"
                    class="mini-input"
                    type="number"
                    placeholder="max"
                    :disabled="isSystem"
                    aria-label="最大值"
                  ><span>最大</span>
                  <input
                    v-model="draft.step"
                    class="mini-input"
                    type="number"
                    placeholder="step"
                    :disabled="isSystem"
                    aria-label="步长"
                  ><span>步长</span>
                </div>
              </div>
            </div>

            <!-- 类型条件区：特化标记（string/number/page，T6/T7/T10）——
                 分段控制含「无」档（ADR-0057 ②）；currency 的单位是级联子行 -->
            <div
              v-if="supportsSpec"
              class="row-line sub"
            >
              <label class="row-label">特化</label>
              <div class="row-ctrl">
                <SegmentedControl
                  :options="specOptions"
                  :model-value="specHead"
                  :disabled="isSystem"
                  :aria-label="`字段特化：${draft.title}`"
                  @update:model-value="onChangeSpecHead"
                />
                <div
                  v-if="specHead === 'currency'"
                  class="row-line sub currency-unit-line"
                >
                  <label class="row-label">单位</label>
                  <input
                    class="mini-input"
                    :value="parseCurrencySpec(draft.spec).unit"
                    type="text"
                    placeholder="无"
                    :disabled="isSystem"
                    aria-label="货币单位"
                    @change="onChangeCurrencyUnit"
                  >
                </div>
                <div class="field-hint">
                  切换字段的编辑器与展示形态（如 currency 带单位、person 限定候选）{{ specHead === 'currency' ? '；符号默认 ¥，可配单位' : '' }}
                </div>
              </div>
            </div>

            <!-- 默认值：编辑器按 (type, specHead) 分派（ADR-0057 ③），
                 落库统一 encodeDefaultJson（JSON 文本，decodeDefaultJson 的消费契约） -->
            <div class="row-line">
              <label class="row-label">默认值</label>
              <div class="row-ctrl">
                <select
                  v-if="defaultEditor === 'enum'"
                  v-model="draft.defaultValue"
                  class="mini-select"
                  :disabled="isSystem || !draft.closedValues.length"
                  aria-label="字段默认值"
                >
                  <option value="">
                    无默认
                  </option>
                  <option
                    v-for="opt in draft.closedValues"
                    :key="opt"
                    :value="opt"
                  >
                    {{ opt }}
                  </option>
                </select>
                <select
                  v-else-if="defaultEditor === 'boolean'"
                  v-model="draft.defaultValue"
                  class="mini-select"
                  :disabled="isSystem"
                  aria-label="字段默认值"
                >
                  <option value="">
                    无默认
                  </option>
                  <option value="true">
                    是
                  </option>
                  <option value="false">
                    否
                  </option>
                </select>
                <input
                  v-else
                  v-model="draft.defaultValue"
                  class="mini-input default-input"
                  :type="defaultEditor === 'number' ? 'number' : 'text'"
                  :placeholder="defaultPlaceholder"
                  :disabled="isSystem"
                  aria-label="字段默认值"
                >
                <div class="field-hint">
                  {{ defaultEditor === 'enum' && !draft.closedValues.length
                    ? '先在选项中添加候选项，才能设默认值'
                    : '打标时为新成员块自动填充' }}
                </div>
              </div>
            </div>

            <!-- 展示形态（D21 决策 6：系统字段无 override 通路 → 禁用，形态编译期定死） -->
            <div class="row-line">
              <label class="row-label">展示形态</label>
              <div class="row-ctrl">
                <select
                  v-model="draft.displayFormOverride"
                  class="mini-select"
                  :disabled="isSystem"
                  aria-label="展示形态"
                >
                  <option
                    v-for="f in availableFormOptions"
                    :key="f.value"
                    :value="f.value"
                  >
                    {{ f.label }}
                  </option>
                </select>
                <div class="field-hint">
                  {{ isSystem
                    ? '系统字段的展示形态由类型定死，不可覆盖'
                    : '字段值在 block 字段区中的呈现样式；选项随字段类型不同（开关支持勾叉/开关/文字，枚举支持胶囊/文字）' }}
                </div>
              </div>
            </div>

            <!-- 隐藏（hide_when 五档，ADR-0050 D18） -->
            <div class="row-line">
              <label class="row-label">隐藏</label>
              <div class="row-ctrl">
                <select
                  v-model="draft.hideWhen"
                  class="mini-select"
                  :disabled="isSystem"
                  aria-label="隐藏规则"
                >
                  <option
                    v-for="o in FIELD_HIDE_OPTIONS"
                    :key="o.value"
                    :value="o.value"
                  >
                    {{ o.label }}
                  </option>
                </select>
                <div class="field-hint">
                  按条件隐藏：符合条件的字段行在 block 字段区不渲染；值保留在库，查询视图仍可见
                </div>
              </div>
            </div>

            <!-- 使用于（默认折叠的有值块列表） -->
            <div class="row-line">
              <label class="row-label">使用于</label>
              <div class="row-ctrl">
                <button
                  class="used-toggle"
                  :class="{ open: usedExpanded }"
                  type="button"
                  data-testid="field-settings-used-toggle"
                  @click="toggleUsed"
                >
                  <span class="chev">▸</span>
                  <span>{{ usedBlocks.length || '…' }} 个块有值</span>
                </button>
                <div
                  v-if="usedExpanded"
                  class="used-blocks"
                  data-testid="field-settings-used-list"
                >
                  <div
                    v-if="usedLoading"
                    class="field-hint used-loading"
                  >
                    加载中…
                  </div>
                  <template v-else>
                    <button
                      v-for="b in usedBlocks"
                      :key="b.id"
                      class="used-item"
                      type="button"
                      :title="b.content"
                      @click="openBlock(b.id)"
                    >
                      {{ b.content }}
                    </button>
                    <div
                      v-if="!usedBlocks.length"
                      class="field-hint used-loading"
                    >
                      暂无有值的块
                    </div>
                  </template>
                </div>
                <div class="field-hint">
                  点击块项打开块详情；新增/移除引用在标签管理页的字段模板区操作
                </div>
              </div>
            </div>

            <!-- 操作（危险区） -->
            <div
              v-if="!isSystem"
              class="row-line"
            >
              <label class="row-label">操作</label>
              <div class="row-ctrl">
                <button
                  class="btn-danger"
                  type="button"
                  data-testid="field-settings-delete"
                  @click="showDeleteConfirm = true"
                >
                  删除字段
                </button>
                <div class="field-hint">
                  删除后移除所有块上的该字段值与标签模板引用，不可撤销
                </div>
              </div>
            </div>
          </div>

          <footer class="modal-foot">
            <button
              class="btn"
              type="button"
              @click="requestClose"
            >
              {{ isSystem ? '关闭' : '取消' }}
            </button>
            <button
              v-if="!isSystem"
              class="btn btn-confirm"
              type="button"
              :disabled="saving"
              data-testid="field-settings-save"
              @click="save"
            >
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>

    <!-- 删除确认（影响告知，spec 用户故事 16/17 同款） -->
    <ConfirmDialog
      :visible="showDeleteConfirm"
      :title="`删除字段「${fieldDef?.title ?? ''}」`"
      message="将移除所有块上的该字段值与各标签模板的引用，不可撤销。"
      confirm-text="删除"
      danger
      @confirm="doDelete"
      @cancel="showDeleteConfirm = false"
    />

    <!-- 放弃未保存草稿确认（ADR-0057 D5） -->
    <ConfirmDialog
      :visible="showDiscardConfirm"
      title="放弃未保存的修改？"
      message="字段设置有未保存的改动，关闭后将丢失。"
      confirm-text="放弃修改"
      cancel-text="继续编辑"
      danger
      @confirm="confirmDiscard"
      @cancel="showDiscardConfirm = false"
    />
  </Teleport>
</template>

<style scoped lang="scss">
.field-settings-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: var(--overlay);
  backdrop-filter: blur(6px);
}

.field-settings-modal {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  width: min(94vw, 680px);
  max-height: min(90vh, 760px);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
}

.modal-header {
  display: flex;
  flex-shrink: 0;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 10px 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-base2);
}

.modal-title-icon {
  display: inline-flex;
  flex-shrink: 0;
  margin-top: 5px;
  color: var(--text-tertiary);
}

.head-fields {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.head-name {
  padding: 2px 4px;
  border: none;
  border-radius: var(--radius-sm);
  outline: none;
  background: transparent;
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--text-primary);

  &:focus {
    background: var(--surface-subtle);
  }
}

.head-desc {
  padding: 2px 4px;
  border: none;
  border-radius: var(--radius-sm);
  outline: none;
  background: transparent;
  font-size: var(--text-xs);
  color: var(--text-secondary);

  &::placeholder {
    color: var(--text-tertiary);
  }

  &:focus {
    background: var(--surface-subtle);
  }
}

.head-actions {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
}

/* 30×30 ghost 图标按钮（.modal-action 配方） */
.modal-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
}

.modal-action-close:hover {
  color: var(--accent);
  background: var(--accent-08);
}

.modal-esc-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-xs);
  background: var(--bg-hover);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1;
  user-select: none;
}

.global-hint {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
  padding: 7px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  color: var(--warning);
  font-size: var(--text-xs);
  line-height: 1.5;

  /* 系统字段只读说明：信息性提示，不用警示色 */
  &--readonly {
    color: var(--text-tertiary);
  }
}

.modal-body {
  flex: 1;
  min-height: 0;
  padding: 4px 20px 16px;
  overflow-y: auto;
}

/* 单页两列行（Tana 范式） */
.row-line {
  display: grid;
  grid-template-columns: 108px 1fr;
  gap: 0 14px;
  align-items: start;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);

  &:last-child {
    border-bottom: none;
  }
}

.row-line.sub {
  padding-top: 8px;
  border-bottom: none;
}

.row-label {
  padding-top: 5px;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.field-hint {
  margin-top: 5px;
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 1.5;
}

/* currency 特化的级联单位行：嵌在特化行 row-ctrl 内，缩进对齐分段 */
.currency-unit-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-1);

  .row-label {
    width: auto;
    flex-shrink: 0;
  }

  .mini-input {
    width: 88px;
  }
}

/* mini 控件（项目配方：12px + bg-base2 + radius-xs + 1px 垂直内边距） */
.mini-input,
.mini-select {
  padding: 1px 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  outline: none;
  background: var(--bg-base2);
  color: var(--text-primary);
  font-size: var(--text-xs);
  transition: border-color var(--dur-fast) var(--ease-out);

  &:hover {
    border-color: var(--border-strong);
  }

  &:focus {
    border-color: var(--accent-40);
  }
}

.mini-select {
  padding: 1px 1px;
  cursor: pointer;
}

.default-input {
  width: 240px;
}

.num-trio {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;

  .mini-input {
    width: 64px;
    text-align: center;
  }

  span {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
  }
}

/* 选项管理 chips */
.opt-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.opt-chip {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 2px 6px 2px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-base2);
  color: var(--text-primary);
  font-size: var(--text-xs);
}

.opt-del {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1;

  &:hover {
    color: var(--error);
    background: var(--bg-hover);
  }
}

.opt-add-input {
  width: 180px;
}

/* 使用于折叠列表 */
.used-toggle {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 0 2px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out);

  &:hover {
    color: var(--accent);
  }

  .chev {
    display: inline-block;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  &.open .chev {
    transform: rotate(90deg);
  }
}

.used-blocks {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 176px;
  margin-top: 6px;
  padding: 4px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-faint);
}

.used-item {
  display: block;
  width: 100%;
  padding: 4px 8px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);

  &:hover {
    color: var(--text-primary);
    background: var(--surface-subtle);
  }
}

.used-loading {
  padding: 2px 8px;
}

/* 底部按钮（.btn / .btn-confirm 配方） */
.modal-foot {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-base2);
}

.btn {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  justify-content: center;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }
}

.btn-confirm {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;

  &:hover {
    border-color: var(--accent-hover);
    background: var(--accent-hover);
    color: #fff;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-danger {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 4px 12px;
  border: 1px solid var(--error);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--error);
  font-size: var(--text-sm);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);

  &:hover {
    border-color: var(--error);
    background: var(--error);
    color: #fff;
  }
}

/* 入场动效（BlockModal 同款） */
.field-settings-fade-enter-active {
  transition: opacity 260ms var(--ease-out);
}

.field-settings-fade-leave-active {
  transition: opacity 200ms ease-in;
}

.field-settings-fade-enter-from,
.field-settings-fade-leave-to {
  opacity: 0;
}

.field-settings-fade-enter-from .field-settings-modal {
  transform: translateY(4px) scale(0.97);
}
</style>
