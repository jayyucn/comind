<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { useFieldValueStore } from '../../stores/fieldValue'
import type { FieldType, FieldValueData, FileRefValue, RelationRefValue } from '../../types/field-definition'
import { decodeFieldValueData } from '../../utils/field-value-codec'
import BasePopover from '../common/BasePopover.vue'
import DatePicker from '../common/DatePicker.vue'
import DateTimePicker from '../common/DateTimePicker.vue'
import DateRangePicker, { type DateRangePickerValue } from '../common/DateRangePicker.vue'
import FileRefEditor from '../common/FileRefEditor.vue'
import RelationRefEditor from '../common/RelationRefEditor.vue'
import MultiEnumSelect from '../common/MultiEnumSelect.vue'
import PageRefPicker from '../common/PageRefPicker.vue'
import type { EnumOption } from '../common/EnumSelect.vue'
import { useTagsStore } from '../../stores/tags'
import { getFieldDefinition } from '../../types/field-definition'
import { numberSpecialization, pageSpecialization, specHeadOf, stringSpecialization } from '../../types/field-type-registry'
import SpecializedText from '../common/SpecializedText.vue'
import RatingInput from '../common/RatingInput.vue'
import { TAG_COLORS } from '../../utils/tag-color'
import { evaluateFormula, validateFormula, detectCycle } from '../../utils/formula'

const editorStore = useEditorStore()
const fieldValueStore = useFieldValueStore()
const tagsStore = useTagsStore()

const visible = computed(() => editorStore.fieldValueEditor?.visible ?? false)
const blockId = computed(() => editorStore.fieldValueEditor?.blockId ?? '')
const initialKey = computed(() => editorStore.fieldValueEditor?.initialKey ?? null)

// 自定义字段的状态
const customKey = ref<string>('')
const selectedType = ref<FieldType>('string')
const currentValue = ref<FieldValueData>('')
const arrayInput = ref('')

// ── T11/T12 远期类型编辑态 ───────────────────────────────
// formula：表达式文本（plain 落库，结果在渲染层派生）
const formulaText = ref('')
// json：textarea 文本（保存时 JSON.parse）
const jsonText = ref('')
// color：选中的 --tag-color-* token 名
const currentColor = ref('')
// geo：纬度 / 经度 / 地名（文本输入，保存时转 number）
const geoLat = ref('')
const geoLng = ref('')
const geoName = ref('')

/** 颜色类型色板（复用 --tag-color-* token 体系） */
const tagColors = TAG_COLORS

const fieldTypes: { type: FieldType; label: string }[] = [
  { type: 'string', label: '文本' },
  { type: 'number', label: '数字' },
  { type: 'boolean', label: '布尔值' },
  { type: 'date', label: '日期' },
  { type: 'datetime', label: '日期时间' },
  { type: 'daterange', label: '日期区间' },
  { type: 'array', label: '数组/标签' },
  { type: 'multiSelect', label: '多选' },
  { type: 'page', label: '页面引用' },
  { type: 'file', label: '附件' },
  { type: 'relation', label: '关联' },
  { type: 'formula', label: '公式' },
  { type: 'json', label: 'JSON' },
  { type: 'color', label: '颜色' },
  { type: 'autonumber', label: '自增编号' },
  { type: 'geo', label: '地理坐标' },
]

const currentArrayValue = computed<string[]>({
  get: () => Array.isArray(currentValue.value) ? currentValue.value : [],
  set: (val) => { currentValue.value = val }
})

// ── multiSelect（多选枚举，T4）：选项来自字段定义 closedValues ──

/** 多选枚举的封闭选项：编译期定义 closedValues 优先，持久化 closed_values 兜底。 */
const multiSelectOptions = computed<EnumOption[]>(() => {
  const key = customKey.value.trim()
  if (!key) return []
  const compiled = getFieldDefinition(key)
  if (compiled?.closedValues?.length) {
    return compiled.closedValues.map((cv) => ({ value: String(cv.value), label: cv.label }))
  }
  const persisted = tagsStore.fieldDefinitions.find((d) => d.key === key)
  return (persisted?.closed_values ?? []).map((v) => ({ value: v, label: v }))
})

/** multiSelect 当前值（string[]），供 MultiEnumSelect 绑定。 */
const currentMultiValue = computed<string[]>(() =>
  Array.isArray(currentValue.value) ? currentValue.value : [],
)

/** MultiEnumSelect 回传收窄：清空归一为空数组（空 = 未填，不可保存）。 */
function setMultiValue(v: string[] | undefined) {
  currentValue.value = v ?? []
}

// ── relation（关系引用，issue T5）──

/** 字段定义上约定的关系类型 id（PersistedFieldDefinition.closed_values[0] 配置位，见 tag-persisted.ts） */
const relationConfigTypeId = computed<string>(() => {
  const key = customKey.value.trim()
  if (!key) return ''
  const persisted = tagsStore.fieldDefinitions.find((d) => d.key === key)
  return persisted?.type === 'relation' ? (persisted.closed_values?.[0] ?? '') : ''
})

/** RelationRefEditor 回传收窄：undefined（未填）归一为空串（与空串 = 不可保存契约一致）。 */
function setRelationValue(v: RelationRefValue | undefined) {
  currentValue.value = (v ?? '') as FieldValueData
}

// ── string 特化（issue T6）：按字段定义 spec 分派编辑器与校验 ──

/** 当前 key 对应字段定义的特化标记（仅 string 类型消费；无定义 / 无 spec = 无特化）。 */
const stringSpec = computed<string | undefined>(() => {
  if (selectedType.value !== 'string') return undefined
  const key = customKey.value.trim()
  if (!key) return undefined
  return tagsStore.fieldDefinitions.find((d) => d.key === key)?.spec
})

const stringSpecEntry = computed(() => stringSpecialization(stringSpec.value))

/** 特化格式校验：失败文案（红字提示 + 阻止保存）；null = 合法。空值不校验（未填语义）。 */
const specValidationError = computed<string | null>(() => {
  if (selectedType.value !== 'string') return null
  const v = currentValue.value
  if (typeof v !== 'string' || v.trim() === '') return null
  return stringSpecEntry.value?.validate?.(v) ?? null
})

/** string 特化感知占位符（issue T6 收尾）：email/phone/url/richtext 各给语义占位，
 *  无特化/未知 → 通用「输入值」。spec 可能带参数化后缀（email:x@y.z），用 specHeadOf 归一。 */
const stringPlaceholder = computed<string>(() => {
  switch (specHeadOf(stringSpec.value)) {
    case 'email': return '输入邮箱地址'
    case 'phone': return '输入电话号码'
    case 'url': return '输入链接 URL'
    case 'richtext': return '输入 markdown（**粗** *斜* `码` [链](接)）'
    default: return '输入值'
  }
})

/** SpecializedText / textarea 回传收窄：undefined（未填）归一为空串（与空串 = 不可保存契约一致）。 */
function setStringValue(v: string | undefined) {
  currentValue.value = v ?? ''
}

/** richtext 多行编辑（T6）：textarea 无 v-model（currentValue 是字段值联合，
 *  v-model 的类型窄化过不去），走显式 value/input 收窄到 string。 */
function onRichtextInput(e: Event) {
  currentValue.value = (e.target as HTMLTextAreaElement).value
}

// ── number 特化（issue T7）：spec='rating' 分派星级编辑器 ──

/** 当前 key 对应字段定义的特化标记（仅 number 类型消费；无定义 / 无 spec = 无特化）。 */
const numberSpec = computed<string | undefined>(() => {
  if (selectedType.value !== 'number') return undefined
  const key = customKey.value.trim()
  if (!key) return undefined
  return tagsStore.fieldDefinitions.find((d) => d.key === key)?.spec
})

/** rating 特化判定（currency / percent 编辑仍是 number 原路径，仅展示特化）。 */
const isRatingSpec = computed(() => numberSpecialization(numberSpec.value)?.editor === 'rating')

/** number 特化感知占位符（issue T7 收尾）：currency/percent 给语义占位，
 *  rating（星级编辑器无文本输入）/ 无特化 → 通用「输入数值」。spec 可能带参数化后缀，用 specHeadOf 归一。 */
const numberPlaceholder = computed<string>(() => {
  switch (specHeadOf(numberSpec.value)) {
    case 'currency': return '输入金额'
    case 'percent': return '输入百分比'
    default: return '输入数值'
  }
})

/** RatingInput 回传收窄：清除（undefined）归一为空串（与空串 = 不可保存契约一致）。 */
function setRatingValue(v: number | undefined) {
  currentValue.value = (v ?? '') as FieldValueData
}

// ── page 特化（issue T10）：spec='person' 分派 personRef（候选限定人员页）──

/**
 * 当前 key 对应字段定义的 page 特化种类（'person' | null = 无特化）。
 * 合法性经中央注册表 `pageSpecialization` 查表（与 numberSpec 同构先例）；
 * 未知 / 缺省 → null，走原 page 路径（零回归）。
 */
const pageSpecKind = computed<string | null>(() => {
  if (selectedType.value !== 'page') return null
  const key = customKey.value.trim()
  if (!key) return null
  const spec = tagsStore.fieldDefinitions.find((d) => d.key === key)?.spec
  const head = specHeadOf(spec ?? undefined)
  return pageSpecialization(head) ? head : null
})

// ── T11 公式：兄弟字段环境 + 实时预览 + 循环依赖检测 ─────────

/** 同块兄弟字段的数值环境（排除自身），供公式预览求值。 */
const siblingEnv = computed<Record<string, number>>(() => {
  const env: Record<string, number> = {}
  for (const fv of fieldValueStore.getBlockFieldValues(blockId.value)) {
    if (fv.key === initialKey.value) continue
    const v = decodeFieldValueData(fv.value_json, fv.value_type)
    if (typeof v === 'number' && !Number.isNaN(v)) env[fv.key] = v
  }
  return env
})

/** 公式实时预览：求值成功显示结果，失败显示错误文案。 */
const formulaPreview = computed<{ ok: boolean; text: string }>(() => {
  const expr = formulaText.value.trim()
  if (!expr) return { ok: true, text: '—' }
  const r = evaluateFormula(expr, siblingEnv.value)
  return r.ok ? { ok: true, text: String(r.value) } : { ok: false, text: r.error }
})

/** 块内其它 formula 字段节点（排除正在编辑的），供循环检测。 */
function formulaNodesForBlock(): { key: string; formula: string }[] {
  return fieldValueStore
    .getBlockFieldValues(blockId.value)
    .filter((fv) => fv.value_type === 'formula' && fv.key !== (initialKey.value ?? ''))
    .map((fv) => ({
      key: fv.key,
      formula: String(decodeFieldValueData(fv.value_json, 'formula')),
    }))
}

/** 公式校验：表达式非空 + 语法合法 + 无循环依赖。 */
const formulaError = computed<string | null>(() => {
  if (selectedType.value !== 'formula') return null
  const expr = formulaText.value.trim()
  if (!expr) return '表达式不能为空'
  const v = validateFormula(expr)
  if (!v.ok) return v.error
  const selfKey = initialKey.value ?? '__new_formula__'
  const cyc = detectCycle(formulaNodesForBlock().concat({ key: selfKey, formula: expr }))
  if (cyc && (initialKey.value ? cyc.includes(initialKey.value) : true)) {
    return `检测到循环依赖：${cyc.join(' → ')}`
  }
  return null
})

// ── T12 json：解析校验 ────────────────────────────────

const jsonError = computed<string | null>(() => {
  if (selectedType.value !== 'json') return null
  const t = jsonText.value.trim()
  if (!t) return 'JSON 不能为空'
  try {
    JSON.parse(t)
    return null
  } catch (e) {
    return `JSON 解析失败：${(e as Error).message}`
  }
})

// ── T12 autonumber：预览将分配的编号 ─────────────────────

const autonumberPreview = computed<number>(() => {
  if (selectedType.value !== 'autonumber') return 1
  const key = customKey.value.trim()
  if (!key || !blockId.value) return 1
  const existing = fieldValueStore.getBlockFieldValue(blockId.value, key)
  if (existing) {
    const v = decodeFieldValueData(existing.value_json, 'autonumber')
    return typeof v === 'number' ? v : fieldValueStore.nextAutonumber(key)
  }
  return fieldValueStore.nextAutonumber(key)
})

/** 类型的展示文案（编辑模式下类型是纯文本，不再走 select 的 option 文案） */
const typeLabel = computed(
  () => fieldTypes.find((t) => t.type === selectedType.value)?.label ?? selectedType.value,
)

// 默认焦点的候选元素（各 v-if 分支同时只挂一个，同一 ref 名可跨分支复用）
const panelRoot = ref<HTMLElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const valueInput = ref<HTMLInputElement | null>(null)
const tagInput = ref<HTMLInputElement | null>(null)
const booleanOptions = ref<HTMLElement | null>(null)

/** 打开时的默认焦点：新建模式落「属性名称」，编辑模式落「值」——值的元素随类型而变
 *  （文本/数字共用一个 input，布尔取已选中的单选框，数组取标签输入框；
 *  日期改用 DatePicker，其取值靠点击触发按钮展开，无默认焦点）。 */
function resolveFocusTarget(): HTMLElement | null {
  if (!initialKey.value) return nameInput.value
  if (selectedType.value === 'boolean') {
    const radios = booleanOptions.value?.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    if (!radios?.length) return null
    return Array.from(radios).find(r => r.checked) ?? radios[0]
  }
  if (selectedType.value === 'array') return tagInput.value
  return valueInput.value
}

/**
 * 等渲染落地再 focus —— 面板随 v-if 挂载，调用时 DOM 还不存在。
 * `isConnected` 守卫是必需的：Page 与 Ideas 各自常驻一个本组件（KeepAlive 下可能同时存活），
 * 未激活实例的 Teleport 内容不在文档里，抢 focus 会把焦点从真正打开的那份抢走。
 */
function focusInitialField() {
  nextTick(() => {
    const root = panelRoot.value
    if (!root?.isConnected) return
    resolveFocusTarget()?.focus()
  })
}

const canSave = computed(() => {
  if (!customKey.value.trim()) return false
  if (selectedType.value === 'array' && currentArrayValue.value.length === 0) return false
  // multiSelect：空选区 = 未填，不可保存（与 array 同判据）
  if (selectedType.value === 'multiSelect' && currentMultiValue.value.length === 0) return false
  if (selectedType.value === 'daterange') {
    const v = currentValue.value
    // 两端齐才可保存（undefined = 未填 = 删行契约）
    return !!v && typeof v === 'object' && !!(v as DateRangePickerValue).start && !!(v as DateRangePickerValue).end
  }
  if (selectedType.value === 'file') {
    // 上传完成（值形 { path, name, mime? }）才可保存
    return !!currentValue.value && typeof currentValue.value === 'object' && !Array.isArray(currentValue.value)
  }
  // relation（issue T5）：两段齐备（目标 + 关系类型）才可保存
  if (selectedType.value === 'relation') {
    const v = currentValue.value as Partial<RelationRefValue> | null
    return !!v && typeof v === 'object' && !!v.targetId && !!v.relationshipTypeId
  }
  // formula（issue T11）：表达式非空 + 语法合法 + 无循环依赖
  if (selectedType.value === 'formula') {
    return !!formulaText.value.trim() && !formulaError.value
  }
  // json（issue T12）：非空 + 合法 JSON
  if (selectedType.value === 'json') {
    return !!jsonText.value.trim() && !jsonError.value
  }
  // color（issue T12）：必须选中有合法 token
  if (selectedType.value === 'color') {
    return currentColor.value !== ''
  }
  // geo（issue T12）：经纬度齐备且为数字
  if (selectedType.value === 'geo') {
    return (
      geoLat.value.trim() !== '' &&
      geoLng.value.trim() !== '' &&
      !Number.isNaN(Number(geoLat.value)) &&
      !Number.isNaN(Number(geoLng.value))
    )
  }
  // autonumber（issue T12）：永远可保存（值自动分配）
  if (selectedType.value === 'autonumber') {
    return true
  }
  if (selectedType.value !== 'array' && currentValue.value === '') return false
  // string 特化（issue T6）：格式校验失败阻止保存（红字提示在编辑器下方）
  if (selectedType.value === 'string' && specValidationError.value) return false
  return true
})

function open() {
  if (initialKey.value) {
    // 编辑模式
    customKey.value = initialKey.value
    const existing = fieldValueStore.getBlockFieldValue(blockId.value, initialKey.value)
    if (existing) {
      selectedType.value = existing.value_type as FieldType
      currentValue.value = decodeFieldValueData(existing.value_json, existing.value_type) as FieldValueData
      if (selectedType.value === 'formula') formulaText.value = typeof currentValue.value === 'string' ? currentValue.value : ''
      if (selectedType.value === 'json') jsonText.value = JSON.stringify(currentValue.value ?? '', null, 2)
      if (selectedType.value === 'color') currentColor.value = typeof currentValue.value === 'string' ? currentValue.value : ''
      if (selectedType.value === 'geo' && currentValue.value && typeof currentValue.value === 'object') {
        const g = currentValue.value as { lat: number; lng: number; name?: string }
        geoLat.value = String(g.lat)
        geoLng.value = String(g.lng)
        geoName.value = g.name ?? ''
      }
    } else {
      currentValue.value = selectedType.value === 'array' || selectedType.value === 'multiSelect' ? [] : ''
    }
  } else {
    // 新建模式
    customKey.value = ''
    selectedType.value = 'string'
    currentValue.value = ''
    arrayInput.value = ''
  }
  // 远期类型编辑态重置（与上面按 existing 分支互补，保证切换/重开干净）
  if (selectedType.value !== 'formula') formulaText.value = ''
  if (selectedType.value !== 'json') jsonText.value = ''
  if (selectedType.value !== 'color') currentColor.value = ''
  if (selectedType.value !== 'geo') {
    geoLat.value = ''
    geoLng.value = ''
    geoName.value = ''
  }
}

function close() {
  editorStore.hideFieldValueEditor()
  customKey.value = ''
  selectedType.value = 'string'
  currentValue.value = ''
  arrayInput.value = ''
  formulaText.value = ''
  jsonText.value = ''
  currentColor.value = ''
  geoLat.value = ''
  geoLng.value = ''
  geoName.value = ''
}

/** 浮层锚点（触发元素矩形）；生产调用方均会传，缺省时退化为视口居中 */
const position = computed(() => editorStore.fieldValueEditor?.position ?? null)
const popoverPosition = computed(
  () => position.value ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 },
)

function addArrayItem() {
  const val = arrayInput.value.trim()
  if (val && !currentArrayValue.value.includes(val)) {
    currentArrayValue.value = [...currentArrayValue.value, val]
  }
  arrayInput.value = ''
}

function removeArrayItem(idx: number) {
  currentArrayValue.value = currentArrayValue.value.filter((_, i) => i !== idx)
}

/** DatePicker（single）回传收窄：清除时为 undefined，落库空串与原生 date input 一致。 */
function setDateValue(v: string | [string, string] | undefined) {
  currentValue.value = typeof v === 'string' ? v : ''
}

/** DateTimePicker 回传收窄：清除时为 undefined，落库空串与 date 分支一致。 */
function setDateTimeValue(v: string | undefined) {
  currentValue.value = v ?? ''
}

/** daterange 当前值（{ start, end } | undefined），供 DateRangePicker 绑定。 */
const daterangeValue = computed<DateRangePickerValue | undefined>(() => {
  const v = currentValue.value
  return v && typeof v === 'object' && 'start' in v && 'end' in v
    ? (v as DateRangePickerValue)
    : undefined
})

/** DateRangePicker 回传收窄：清除时为 undefined（= 未填），回落空串（不可保存）。 */
function setDaterangeValue(v: DateRangePickerValue | undefined) {
  currentValue.value = v ?? ''
}

/** FileRefEditor（file 类型）回传收窄：清除时为 undefined，落库前保持空串占位。 */
function setFileValue(v: FileRefValue | undefined) {
  currentValue.value = (v ?? '') as FieldValueData
}

/** PageRefPicker（page 类型，issue T3）回传收窄：选中页面 → 值存 page id；清除回空串。 */
function setPageValue(v: string | undefined) {
  currentValue.value = (v ?? '') as FieldValueData
}

async function save() {
  if (!canSave.value || !blockId.value) return

  try {
    let value: FieldValueData
    switch (selectedType.value) {
      case 'formula':
        value = formulaText.value.trim()
        break
      case 'json':
        value = JSON.parse(jsonText.value) as unknown
        break
      case 'color':
        value = currentColor.value
        break
      case 'geo':
        value = {
          lat: Number(geoLat.value),
          lng: Number(geoLng.value),
          name: geoName.value.trim() || undefined,
        }
        break
      case 'autonumber':
        value = autonumberPreview.value
        break
      default:
        value = currentValue.value
    }
    await fieldValueStore.setFieldValue(
      blockId.value,
      customKey.value.trim(),
      value,
      selectedType.value
    )
    close()
  } catch (error) {
    console.error('Failed to save field value:', error)
  }
}

watch(visible, (val) => {
  if (val) {
    open()
    focusInitialField()
  }
}, { immediate: true })
</script>

<template>
  <!-- 面板外框与关闭行为（Teleport / overlay 点击 / Escape）由 BasePopover 统一提供，
       这里只管表单本体；锚点用触发元素矩形（同 PropertyQuickEditor）。 -->
  <BasePopover
    :visible="visible"
    :position="popoverPosition"
    @close="close"
  >
    <div
      ref="panelRoot"
      class="property-editor-panel"
    >
      <div class="dialog-header">
        <h3>{{ initialKey ? '编辑自定义属性' : '添加自定义属性' }}</h3>
      </div>
      
      <div class="dialog-body">
        <!-- 名称：编辑模式下 key 不可改，展示为纯文本 -->
        <div class="form-group">
          <label>属性名称</label>
          <input
            v-if="!initialKey"
            ref="nameInput"
            v-model="customKey"
            type="text"
            placeholder="输入属性名称"
          >
          <span
            v-else
            class="form-static"
          >{{ customKey }}</span>
        </div>

        <div class="form-group">
          <label>类型</label>
          <select
            v-if="!initialKey"
            v-model="selectedType"
          >
            <option
              v-for="t in fieldTypes"
              :key="t.type"
              :value="t.type"
            >
              {{ t.label }}
            </option>
          </select>
          <span
            v-else
            class="form-static"
          >{{ typeLabel }}</span>
        </div>

        <div class="form-group">
          <label>值</label>
          
          <!-- Boolean -->
          <div
            v-if="selectedType === 'boolean'"
            ref="booleanOptions"
            class="boolean-options"
          >
            <label class="boolean-option">
              <input
                v-model="currentValue"
                type="radio"
                :value="true"
              >
              <span>是</span>
            </label>
            <label class="boolean-option">
              <input
                v-model="currentValue"
                type="radio"
                :value="false"
              >
              <span>否</span>
            </label>
          </div>

          <!-- Date -->
          <DatePicker
            v-else-if="selectedType === 'date'"
            class="date-field"
            :model-value="typeof currentValue === 'string' ? currentValue : ''"
            @update:model-value="setDateValue"
          />

          <!-- DateTime（日期 + 时分，yyyy-MM-dd HH:mm 落库） -->
          <DateTimePicker
            v-else-if="selectedType === 'datetime'"
            class="date-field"
            :model-value="typeof currentValue === 'string' && currentValue ? currentValue : undefined"
            @update:model-value="setDateTimeValue"
          />

          <!-- DateRange（起止两日期，两端齐才可保存） -->
          <DateRangePicker
            v-else-if="selectedType === 'daterange'"
            class="date-field"
            :model-value="daterangeValue"
            @update:model-value="setDaterangeValue"
          />

          <!-- File（附件，issue T9）：上传 → v-model 回 { path, name, mime } -->
          <FileRefEditor
            v-else-if="selectedType === 'file'"
            class="file-field"
            :model-value="typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue) && 'path' in currentValue ? (currentValue as FileRefValue) : undefined"
            @update:model-value="setFileValue"
          />

          <!-- Page（页面引用，issue T3）：PageRefPicker 搜索选择现有页面，值存 page id；
               pageRef 不再走文本兜底输入框。page 特化 person（issue T10）：
               候选限定 person 页（personOnly 过滤通路） -->
          <PageRefPicker
            v-else-if="selectedType === 'page'"
            class="page-field"
            :person-only="pageSpecKind === 'person'"
            :model-value="typeof currentValue === 'string' ? currentValue : undefined"
            @update:model-value="setPageValue"
          />

          <!-- Relation（关系引用，issue T5）：RelationRefEditor 两段式选定
               （目标块/页 + 关系类型），payload { targetId, relationshipTypeId } 齐备才可保存；
               字段定义约定的关系类型（closed_values[0] 配置位）作为预选 -->
          <RelationRefEditor
            v-else-if="selectedType === 'relation'"
            class="relation-field"
            :model-value="typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue) && 'targetId' in currentValue ? (currentValue as RelationRefValue) : undefined"
            :relationship-type-id="relationConfigTypeId"
            @update:model-value="setRelationValue"
          />

          <!-- Formula（计算字段，issue T11）：表达式输入 + 实时预览 + 循环依赖提示 -->
          <template v-else-if="selectedType === 'formula'">
            <input
              ref="valueInput"
              v-model="formulaText"
              class="formula-field"
              type="text"
              placeholder="如 price * qty"
            >
            <div
              class="formula-preview"
              :class="{ 'formula-preview--error': !formulaPreview.ok }"
            >
              预览：{{ formulaPreview.text }}
            </div>
            <div
              v-if="formulaError"
              class="spec-error"
            >
              {{ formulaError }}
            </div>
          </template>

          <!-- JSON（结构化对象，issue T12）：textarea + 解析校验 -->
          <template v-else-if="selectedType === 'json'">
            <textarea
              v-model="jsonText"
              class="json-field"
              rows="5"
              placeholder="{ &quot;k&quot;: &quot;v&quot; }"
            />
            <div
              v-if="jsonError"
              class="spec-error"
            >
              {{ jsonError }}
            </div>
          </template>

          <!-- Color（颜色，issue T12）：色板复用 --tag-color-* token -->
          <template v-else-if="selectedType === 'color'">
            <div class="color-swatches">
              <button
                v-for="c in tagColors"
                :key="c.token"
                type="button"
                class="color-swatch"
                :class="{ 'color-swatch--selected': currentColor === c.token }"
                :style="{ background: `var(${c.token})` }"
                :title="c.label"
                @click="currentColor = c.token"
              />
            </div>
          </template>

          <!-- Geo（地理位置，issue T12）：纬度 / 经度 / 地名 -->
          <template v-else-if="selectedType === 'geo'">
            <div class="geo-field">
              <input
                v-model="geoLat"
                class="geo-input"
                type="text"
                placeholder="纬度 lat"
              >
              <input
                v-model="geoLng"
                class="geo-input"
                type="text"
                placeholder="经度 lng"
              >
              <input
                v-model="geoName"
                class="geo-input"
                type="text"
                placeholder="地名（可选）"
              >
            </div>
          </template>

          <!-- Autonumber（自增编号，issue T12）：只读预览将分配编号 -->
          <template v-else-if="selectedType === 'autonumber'">
            <div class="autonumber-preview">
              将分配编号：<strong>{{ autonumberPreview }}</strong>（新增时自增，不可编辑）
            </div>
          </template>

          <!-- Number（rating 特化 issue T7：spec='rating' 换星级编辑器；
               currency / percent 与无特化仍走原数字输入，零回归） -->
          <RatingInput
            v-else-if="selectedType === 'number' && isRatingSpec"
            :model-value="typeof currentValue === 'number' ? currentValue : undefined"
            aria-label="评分"
            @update:model-value="setRatingValue"
          />

          <!-- Number -->
          <input
            v-else-if="selectedType === 'number'"
            ref="valueInput"
            v-model.number="currentValue"
            type="number"
            :placeholder="numberPlaceholder"
          >

          <!-- multiSelect（多选枚举，T4）：封闭选项来自字段定义 closedValues；
               无定义（新建无选项）时回退自由输入，与 array 分支共用。 -->
          <MultiEnumSelect
            v-else-if="selectedType === 'multiSelect' && multiSelectOptions.length"
            :options="multiSelectOptions"
            :model-value="currentMultiValue"
            placeholder="未填"
            @update:model-value="setMultiValue"
          />

          <!-- Array (tags) / multiSelect 无选项回退 -->
          <div
            v-else-if="selectedType === 'array' || selectedType === 'multiSelect'"
            class="array-input"
          >
            <input
              ref="tagInput"
              v-model="arrayInput"
              placeholder="输入标签，回车添加"
              @keydown.enter.prevent="addArrayItem"
            >
            <div class="array-items">
              <span
                v-for="(item, idx) in currentArrayValue"
                :key="idx"
                class="array-item"
              >
                {{ item }}
                <button
                  class="remove-btn"
                  @click="removeArrayItem(idx)"
                >×</button>
              </span>
            </div>
          </div>

          <!-- Default: string（按特化标记分派，issue T6：
               email / phone → SpecializedText（格式校验）；richtext → 多行 textarea；
               url / 无特化 → 原单行输入，零回归） -->
          <template v-else>
            <SpecializedText
              v-if="stringSpecEntry?.validate"
              class="spec-editor"
              :spec="stringSpec ?? 'email'"
              :model-value="typeof currentValue === 'string' ? currentValue : undefined"
              :placeholder="stringPlaceholder"
              @update:model-value="setStringValue"
            />
            <textarea
              v-else-if="stringSpec === 'richtext'"
              :value="typeof currentValue === 'string' ? currentValue : ''"
              class="richtext-editor"
              rows="4"
              :placeholder="stringPlaceholder"
              @input="onRichtextInput"
            />
            <input
              v-else
              ref="valueInput"
              v-model="currentValue"
              type="text"
              :placeholder="stringPlaceholder"
            >
            <!-- 特化校验失败红字提示（var(--error)），同时由 canSave 阻止保存 -->
            <div
              v-if="specValidationError"
              class="spec-error"
            >
              {{ specValidationError }}
            </div>
          </template>
        </div>
      </div>

      <div class="dialog-footer">
        <button
          class="btn btn-secondary"
          @click="close"
        >
          取消
        </button>
        <button
          class="btn btn-primary"
          :disabled="!canSave"
          @click="save"
        >
          保存
        </button>
      </div>
    </div>
  </BasePopover>
</template>

<style scoped>
/* 面板外框（背景 / 边框 / 圆角 / 阴影 / Teleport / overlay 关闭）由 BasePopover 提供，
   这里只管表单排版。定宽是必须的：输入框是 width:100%，面板交给内容撑宽会构成
   「百分比尺寸 ↔ auto 宽容器」的循环依赖。 */
.property-editor-panel {
  box-sizing: border-box;
  width: 300px;
  padding: 12px;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.dialog-header h3 {
  margin: 0;
  font-size: var(--heading-5);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

/* 表单项：标签在左、字段在右，同处一行（面板窄，竖排会让三行字段各自占两行高度） */
.form-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

/* 子组合器是有意的：字段标签只取直接子级，不波及单选框的 <label class="boolean-option">
   （它在 .boolean-options 里），否则 display 会被这里压掉。
   定宽 + 右对齐：三个标签右边缘对齐，右侧字段的左边缘因此天然对齐。 */
.form-group > label {
  flex: 0 0 60px;
  text-align: right;
  font-weight: var(--font-medium);
  font-size: var(--text-sm);
  color: var(--text-primary);
}

/* 编辑模式下「属性名称 / 类型」是只读信息，以纯文本展示（不再是输入控件）。
   flex:1 与输入框同宽，overflow-wrap 让长 key 换行而不是撑破面板。 */
.form-static {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.form-group input,
.form-group select {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: var(--text-sm);
  color: var(--text-primary);
  /* 必须给不透明底，不能用 transparent：原生 <select> 展开的选项列表是浏览器自绘的
     独立弹层，它的底色取自元素自身的 background-color —— 透明时弹层无处可透，会回退
     成不透明浅色，而文字色仍是 --text-primary（暗色主题下是浅色），于是「浅底浅字」。
     color-scheme 管不了这一层（那只管日历面板、滚动条、步进按钮等 UA 内绘制）。
     --bg-base 与面板底色相同，所以闭合态观感与透明时一模一样。 */
  background: var(--bg-base);
  transition: border-color var(--dur-fast) var(--ease-out);
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--accent);
}

/* 日期字段（DatePicker）：与上面的输入框同处标签右侧、占满剩余宽度，
   否则内容宽度会把面板挤窄（.form-group 是 flex 行） */
.date-field {
  flex: 1;
  min-width: 0;
}

/* 页面引用字段（PageRefPicker，T3）：同 .date-field，占满标签右侧剩余宽度 */
.page-field {
  flex: 1;
  min-width: 0;
}

/* 关系引用字段（RelationRefEditor，T5）：同 .date-field，占满标签右侧剩余宽度 */
.relation-field {
  flex: 1;
  min-width: 0;
}

/* 收音机选项（是 / 否）：与上面的字段标签同处一行，占满标签右侧的剩余宽度 */
.boolean-options {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: 16px;
}

.boolean-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: var(--text-sm);
}

/* 标签输入组（array 分支）：占据标签右侧的剩余宽度 */
.array-input {
  flex: 1;
  min-width: 0;
}

/* array 分支的输入框是 .array-input 的子级（非 flex 容器），拿不到上面的 flex:1，
   需显式撑满（全局 box-sizing: border-box，100% 含内边距，不会溢出） */
.array-input input {
  width: 100%;
}

.array-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.array-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--accent-subtle);
  border-radius: 4px;
  font-size: var(--text-sm);
}

.remove-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--text-sm);
  padding: 0 4px;
  color: var(--text-secondary);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  transition: background var(--dur-fast) var(--ease-out);
}

.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

.btn-secondary:hover {
  background: var(--surface-faint);
}

.btn-primary {
  background: var(--accent);
  color: var(--color-white);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── string 特化（issue T6） ── */

/* 特化编辑器（SpecializedText）：占满标签右侧剩余宽度（与输入框同构） */
.spec-editor {
  flex: 1;
  min-width: 0;
}

/* richtext 多行编辑：等宽栏位内自动换行，不引第三方 markdown 依赖 */
.richtext-editor {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: var(--text-sm);
  font-family: inherit;
  line-height: var(--leading-normal);
  color: var(--text-primary);
  background: var(--bg-base);
  resize: vertical;
  outline: none;

  &::placeholder {
    color: var(--text-tertiary);
  }

  &:focus {
    border-color: var(--accent);
  }
}

/* 特化校验失败红字提示：值控件下方（var(--error) token） */
.spec-error {
  flex-basis: 100%;
  font-size: var(--text-xs);
  color: var(--error);
}

/* ── T11 公式字段编辑器 ── */

.formula-field {
  flex: 1;
  min-width: 0;
}

.formula-preview {
  flex-basis: 100%;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.formula-preview--error {
  color: var(--error);
}

/* ── T12 json 字段编辑器 ── */

.json-field {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: var(--text-sm);
  font-family: var(--font-mono, monospace);
  line-height: var(--leading-normal);
  color: var(--text-primary);
  background: var(--bg-base);
  resize: vertical;
  outline: none;

  &:focus {
    border-color: var(--accent);
  }
}

/* ── T12 color 字段编辑器（色板）── */

.color-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.color-swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition: transform var(--dur-fast) var(--ease-out);

  &:hover {
    transform: scale(1.1);
  }

  &--selected {
    border-color: var(--text-primary);
  }
}

/* ── T12 geo 字段编辑器 ── */

.geo-field {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.geo-input {
  flex: 1 1 80px;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: var(--bg-base);
  outline: none;

  &:focus {
    border-color: var(--accent);
  }
}

/* ── T12 autonumber 字段编辑器 ── */

.autonumber-preview {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
</style>
