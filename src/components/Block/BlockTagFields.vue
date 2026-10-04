<script setup lang="ts">
/**
 * 块字段渲染载体（ADR-0050 D1「挂载即显示」＋ ADR-0051 D6 职责全迁）。
 *
 * 单一载体承载块字段值的全部渲染位（原 `PropertyInline` / `PropertyDisplay` 的职责）：
 * - `between`：bullet 与内容之间的内联槽（如 status 任务图标）
 * - `right`：内容右侧内联槽（`priority` 入口已移至斜杠命令面板，故实际为空）
 * - `chips`：块行尾右侧 chips 列（超出 2 个按序折进「+N」浮层）
 * - `book-note`：书笔记来源行（Pin + 章节 + 原文引用）
 * - `all`：完整字段列表（Backlinks 等）
 * - `list`：content 下方「挂载即显示」的 Tag 字段区（含空占位、隐藏规则）
 *
 * `list` 变体是**唯一 tag 本位**的一支：字段集合来自该块已挂标签的有效字段并集
 * （解析单源在 Rust：`effective_field_ids`），无值字段以空占位呈现；其余变体沿用
 * 「块上已有字段值行 → 按字段定义渲染」的既有口径（与迁移前完全一致）。
 *
 * 值读写走 fieldValue store；行内存储形态是库内 `FieldValue` 原形，读取端统一经
 * `decodeFieldValueData` 还原内存值。
 */
import { Pin } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { openReaderWindow } from '../../composables/useReaderWindow'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import { useFieldValueStore } from '../../stores/fieldValue'
import { useTagsStore } from '../../stores/tags'
import type { FieldDefinition } from '../../types/field-definition'
import { getFieldDefinition } from '../../types/field-definition'
import type { FieldValue } from '../../types/field-value'
import type { PersistedFieldDefinition } from '../../types/tag-persisted'
import { isSystemField } from '../../types/tag'
import { decodeFieldValueData } from '../../utils/field-value-codec'
import { decodeDefaultJson, isFieldHiddenByRule, normalizeHideWhen } from '../../utils/field-hide'
import { isTauriEnvironment } from '../../wasm/tauri-platform'
import BasePopover from '../common/BasePopover.vue'
import { Icon } from '../Icons'

const props = withDefaults(defineProps<{
  blockId: string
  /** 该块已挂的 tag id（来自 Block.tags 派生缓存）；仅 `list` 变体消费。 */
  tagIds?: string[]
  variant?: 'between' | 'right' | 'chips' | 'book-note' | 'all' | 'list'
}>(), {
  tagIds: () => [],
  variant: 'list',
})

const tagsStore = useTagsStore()
const fieldValueStore = useFieldValueStore()
const editorStore = useEditorStore()
const blockStore = useBlockStore()

onMounted(() => {
  if (props.variant !== 'list') return
  // 幂等：标签树未加载时补一次（块可能在标签页未访问过的会话里直接渲染）
  void tagsStore.ensureLoaded()
})

/** 该块已挂标签（软删 / 悬空 id 由 store 静默过滤）。 */
const tags = computed(() => tagsStore.resolveTags(props.tagIds))

// ── 字段值行 → 内存值 ────────────────────────────────────────

/** 解码后的内存值（写回时的 `value_json` 由 codec 编码，此处还原） */
function dataOf(fv: FieldValue): unknown {
  return decodeFieldValueData(fv.value_json, fv.value_type)
}

/** 该块全部字段值行（含软删行，与迁移前同口径：默认无软删行） */
const rows = computed<FieldValue[]>(() => fieldValueStore.getBlockFieldValues(props.blockId))

function defOf(key: string): FieldDefinition | undefined {
  return getFieldDefinition(key)
}

/** 按 displayPosition 取行（内联槽用） */
function rowsAt(position: string): FieldValue[] {
  return rows.value.filter((fv) => defOf(fv.key)?.displayPosition === position)
}

const betweenRows = computed<FieldValue[]>(() => rowsAt('between-bullet-content'))

/** 内联槽行：`right` 变体排除 priority（编辑器入口移至斜杠命令面板） */
const inlineRows = computed<FieldValue[]>(() => {
  if (props.variant === 'between') return betweenRows.value
  return rowsAt('right-of-content').filter((fv) => fv.key !== 'priority')
})

/**
 * chips / all 变体的可见行：bottom-of-block 内置字段 + 全部自定义字段，
 * 排除已内联为 dateRef 的 deadline / scheduled。
 * 「是否系统字段」由所属 Tag 的 isSystem 承载（ADR-0049 D5）。
 */
const displayRows = computed<FieldValue[]>(() =>
  rows.value.filter((fv) => {
    // T14: deadline/scheduled 已内联为 dateRef，不在字段面板展示
    if (fv.key === 'deadline' || fv.key === 'scheduled') return false
    return defOf(fv.key)?.displayPosition === 'bottom-of-block' || !isSystemField(fv.key)
  }),
)

// ── 图标 / 文案（封闭值取 label，数组拼接，其余原样）──

function getIcon(key: string, value: unknown): string | null {
  const def = defOf(key)
  if (def?.closedValues) {
    const cv = def.closedValues.find((c) => c.value === value)
    if (cv?.icon) return cv.icon
  }
  switch (key) {
    case 'tags':
      return '🏷️'
    case 'project':
      return '📁'
    case 'area':
      return '🌐'
    case 'book':
      return '📖'
    case 'chapter':
      return '📄'
    case 'quote':
      return '❝'
    default:
      return null
  }
}

function getLabel(key: string, value: unknown): string {
  const def = defOf(key)
  if (def?.closedValues) {
    const cv = def.closedValues.find((c) => c.value === value)
    if (cv?.label) return cv.label
  }
  switch (key) {
    case 'project':
    case 'area':
      return String(value)
    case 'tags':
      return Array.isArray(value) ? value.join(', ') : String(value)
    default:
      return String(value)
  }
}

function isSvgIcon(icon: string): boolean {
  return icon.startsWith('status-') || icon.startsWith('priority-') || icon.startsWith('icon-')
}

/** 字段标题（chips 的 hover 全量与浮层用）；无定义时回退 key */
function titleOf(key: string): string {
  return defOf(key)?.title ?? key
}

// ── 编辑器入口（快捷菜单与完整编辑器共用同一锚点约定：触发元素左下 + 4px）──

function editorPosition(el: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect()
  return { x: rect.left, y: rect.bottom + 4 }
}

function openEditor(key: string, el: HTMLElement) {
  if (isSystemField(key)) {
    editorStore.showQuickFieldValueEditor(props.blockId, key, editorPosition(el))
  } else {
    editorStore.showFieldValueEditor(props.blockId, key, editorPosition(el))
  }
}

function deleteRow(fv: FieldValue, event: MouseEvent) {
  event.stopPropagation()
  void fieldValueStore.deleteFieldValue(fv.id, props.blockId)
}

// ── between / right 内联槽交互 ──────────────────────────────

const hoveredId = ref<string | null>(null)

/** status 单击循环顺序；环外值（Canceled / Archived 等）一律回到首个 */
const STATUS_CYCLE = ['Todo', 'Doing', 'Done'] as const
const LONG_PRESS_MS = 500

let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressHandled = false

function clearLongPress() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function onPointerDown(fv: FieldValue, event: PointerEvent) {
  clearLongPress()
  longPressHandled = false
  if (event.button !== 0) return
  // currentTarget 在 setTimeout 回调里已被置空，必须同步取 rect
  const el = event.currentTarget as HTMLElement
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    longPressHandled = true
    openEditor(fv.key, el)
  }, LONG_PRESS_MS)
}

/** status 专用：Todo → Doing → Done → Todo 循环，直接落库，不弹菜单 */
function cycleStatus(fv: FieldValue) {
  const current = dataOf(fv) as (typeof STATUS_CYCLE)[number]
  const idx = STATUS_CYCLE.indexOf(current)
  const next = idx === -1 ? STATUS_CYCLE[0] : STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
  void fieldValueStore.setFieldValue(props.blockId, fv.key, next, 'string')
}

function onInlineClick(fv: FieldValue, event: MouseEvent) {
  clearLongPress()
  // 长按已弹过菜单，吞掉随后的 click
  if (longPressHandled) {
    longPressHandled = false
    return
  }
  if (fv.key === 'status') {
    cycleStatus(fv)
    return
  }
  openEditor(fv.key, event.currentTarget as HTMLElement)
}

// ── chips 收纳：只显示前 CHIPS_PER_LINE 个 ──────────────────
// 装不下的整 chip 按序折进「+N」徽标，点开 BasePopover 看这些被收纳的字段。
// 刻意不随块内文本行数放量（曾按「行数 × 每行个数」放开）：chips 是行尾的附属信息，
// 不该因为正文写了三行就摊开三行 chip。

/** 行内显示的 chip 个数上限（与 _block.scss 的 grid-template-columns: repeat(2, …) 成对，改一处必改另一处） */
const CHIPS_PER_LINE = 2
/** chip 内文字超过此字数即截断，全文由 title 承载 */
const MAX_CHIP_TEXT = 8

const moreBadgeRef = ref<HTMLElement | null>(null)
const moreVisible = ref(false)

/** 单一真相：行内显示前 N 个，其余全部进「+N」浮层（浮层不再重复展示已显示的那些） */
const visibleChips = computed(() => displayRows.value.slice(0, CHIPS_PER_LINE))
const hiddenFields = computed(() => displayRows.value.slice(CHIPS_PER_LINE))
const hiddenCount = computed(() => hiddenFields.value.length)

function pickFromPopover(fv: FieldValue, event: MouseEvent): void {
  moreVisible.value = false
  openEditor(fv.key, event.currentTarget as HTMLElement)
}

/** 浮层内删除：删到没有剩余收纳项时徽标会消失（浮层锚点随之没了），顺手收起浮层 */
function deleteFromPopover(fv: FieldValue, event: MouseEvent): void {
  deleteRow(fv, event)
  if (hiddenFields.value.length <= 1) moreVisible.value = false
}

/** 超长即截断到 MAX_CHIP_TEXT 字，全文由 title 承载 */
function truncateText(text: string): string {
  if (props.variant !== 'chips') return text
  return text.length > MAX_CHIP_TEXT ? `${text.slice(0, MAX_CHIP_TEXT)}…` : text
}

/** chips 的悬浮提示给「字段名: 值」全量；其它变体维持原来只对 quote 给全文的行为 */
function chipTitleAttr(fv: FieldValue): string | undefined {
  const value = dataOf(fv)
  if (props.variant !== 'chips') {
    return fv.key === 'quote' ? String(value) : undefined
  }
  // project/area 不渲染字段名，提示里也不重复
  if (fv.key === 'project' || fv.key === 'area') return String(value)
  return `${titleOf(fv.key)}: ${getLabel(fv.key, value)}`
}

// ── book-note 来源行 ────────────────────────────────────────

function strByKey(key: string): string {
  const fv = rows.value.find((r) => r.key === key)
  return fv ? String(dataOf(fv)) : ''
}

/** cfi 字段值（「跳回原文」的数据源） */
const sourceCfi = computed(() => strByKey('cfi'))
/** 父级章节字段值（卷/部，双层结构时使用） */
const part = computed(() => strByKey('part'))
/** 章节字段值 */
const chapter = computed(() => strByKey('chapter'))
/** 原文引用字段值 */
const quote = computed(() => strByKey('quote'))

/** 章节展示：双层结构 part/chapter，单层仅 chapter */
const chapterLabel = computed(() => {
  if (!chapter.value) return ''
  if (part.value) return `${part.value} / ${chapter.value}`
  return chapter.value
})

/** 书笔记：存在原文引用字段（quote 是书笔记四件套的核心展示字段） */
const isBookNote = computed(() => !!quote.value)

/** 仅 Tauri 环境且 cfi 字段存在时显示（web/Android 无阅读器窗口） */
const canJumpToSource = computed(() => isTauriEnvironment() && !!sourceCfi.value)

/** 唤起（或聚焦）该书阅读器窗口并定位到高亮处：bookPageId 即 Block 所属书 Page */
async function jumpToSource(): Promise<void> {
  const cfi = sourceCfi.value
  if (!cfi) return
  const bookPageId = blockStore.getBlock(props.blockId)?.pageId
  if (!bookPageId) return
  await openReaderWindow(bookPageId, { jumpCfi: cfi })
}

// ── list 变体：Tag 字段区 ───────────────────────────────────

/**
 * 有效字段并集（去重按字段定义 id，保持首次出现顺序）。
 *
 * 已在块内联槽真正渲染的字段，下方不再重复列文字，避免同物两渲染：
 * 例如 `status` 以任务图标呈现在 bullet 与内容之间（`displayPosition: 'between-bullet-content'`，
 * 由 `between` 变体渲染），在下方再列 `状态: 进行中` 纯文本即冗余。
 *
 * 判定口径 = 编译期 `FieldDefinition.displayPosition`（`PersistedFieldDefinition` 不持久化该字段，
 * 见 `tag-persisted.ts:6`），经 `getFieldDefinition(key)` 反查。
 * 仅 `between-bullet-content` 会被内联槽真正渲染；`right-of-content` 当前仅 `priority`，
 * 而它已被内联槽显式排除出右侧（入口移至斜杠命令面板），并不在 inline 渲染，
 * 故必须保留在下方、不能一并排除。
 */
const fields = computed<PersistedFieldDefinition[]>(() => {
  const seen = new Set<string>()
  const out: PersistedFieldDefinition[] = []
  for (const tag of tags.value) {
    for (const def of tagsStore.effectiveFieldDefinitions(tag.id)) {
      if (seen.has(def.id)) continue
      if (defOf(def.key)?.displayPosition === 'between-bullet-content') continue
      if (isHiddenByRule(def)) continue
      seen.add(def.id)
      out.push(def)
    }
  }
  return out
})

/** 该块此字段的值形态：未填（无行 / 空串 / 空数组）→ null。 */
function rawValueOf(def: PersistedFieldDefinition): string | null {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return null
  const v = dataOf(fv)
  if (v === null || v === undefined || v === '') return null
  if (Array.isArray(v) && !v.length) return null
  return String(v)
}

/**
 * 隐藏规则判定（ADR-0050 D18，定义级共享）：规则单源在 `utils/field-hide`，
 * 这里只负责从 store 取值喂给它。注意这个判定是**逐块**的——
 * 「为空时隐藏」下同一字段在 A 块消失、在 B 块照常显示。
 */
function isHiddenByRule(def: PersistedFieldDefinition): boolean {
  if (normalizeHideWhen(def.hide_when) === 'never') return false
  const value = rawValueOf(def)
  return isFieldHiddenByRule(
    def.hide_when,
    value !== null,
    value ?? '',
    decodeDefaultJson(def.default_value),
  )
}

/** 当前值文本（选项型取 label，数组拼接，其余原样）；无值 → null（渲染占位）。 */
function valueText(def: PersistedFieldDefinition): string | null {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return null
  const value = dataOf(fv)
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) return value.length ? value.map(String).join('、') : null
  const closed = def.closed_values?.find((v) => String(v) === String(value))
  return closed ? String(closed) : String(value)
}

/** 点击 / Enter 唤起该字段的快速编辑器（锚点 = 行元素矩形）；参数取 Event 以兼容键盘触发。 */
function openFieldRow(event: Event, def: PersistedFieldDefinition) {
  editorStore.showQuickFieldValueEditor(props.blockId, def.key, editorPosition(event.currentTarget as HTMLElement))
}
</script>

<template>
  <!-- 内联槽：between（bullet 与内容之间） / right（内容右侧） -->
  <div
    v-if="variant === 'between' || variant === 'right'"
    class="property-inline"
  >
    <div
      v-for="fv in inlineRows"
      :key="fv.id"
      class="property-inline-item"
      :class="{
        'built-in': isSystemField(fv.key),
        'icon-only': defOf(fv.key)?.displayStyle === 'icon'
      }"
      @mouseenter="hoveredId = fv.id"
      @mouseleave="hoveredId = null"
      @pointerdown="onPointerDown(fv, $event)"
      @pointerup="clearLongPress"
      @pointerleave="clearLongPress"
      @pointercancel="clearLongPress"
      @click.stop="onInlineClick(fv, $event)"
    >
      <template v-if="getIcon(fv.key, dataOf(fv))">
        <span class="property-icon">
          <Icon
            v-if="isSvgIcon(getIcon(fv.key, dataOf(fv)) as string)"
            :name="getIcon(fv.key, dataOf(fv)) as string"
          />
          <span v-else>{{ getIcon(fv.key, dataOf(fv)) }}</span>
        </span>
        <span
          v-if="defOf(fv.key)?.displayStyle !== 'icon'"
          class="property-label"
        >
          {{ getLabel(fv.key, dataOf(fv)) }}
        </span>
      </template>
      <template v-else>
        <span>{{ getLabel(fv.key, dataOf(fv)) }}</span>
      </template>
      <button
        v-if="variant === 'right' && hoveredId === fv.id"
        class="delete-button"
        title="删除字段值"
        @click.stop="deleteRow(fv, $event)"
      >
        ×
      </button>
    </div>
  </div>

  <!-- 书笔记：紧凑一行展示来源信息（Pin + 章节 + 原文引用），不展开字段列表 -->
  <div
    v-else-if="(variant === 'book-note' || variant === 'all') && isBookNote"
    class="property-display book-note-source"
    :class="{ 'can-jump': canJumpToSource }"
    :title="canJumpToSource ? '跳回原文（在阅读器中定位高亮）' : undefined"
    @click.stop="jumpToSource"
  >
    <Pin
      :size="14"
      class="source-pin"
      color="var(--accent)"
    />
    <span
      v-if="chapterLabel"
      class="source-chapter"
    >{{ chapterLabel }}</span>
    <span
      v-if="quote"
      class="source-quote"
    >{{ quote }}</span>
  </div>

  <!-- chips / all：字段列表（chips 变体收纳进「+N」浮层） -->
  <div
    v-else-if="(variant === 'chips' || variant === 'all') && !isBookNote && displayRows.length > 0"
    class="property-display"
  >
    <div class="property-list">
      <div
        v-for="fv in variant === 'chips' ? visibleChips : displayRows"
        :key="fv.id"
        class="property-item"
        :class="{ 'built-in': isSystemField(fv.key), 'quote-item': fv.key === 'quote' }"
        :title="chipTitleAttr(fv)"
        @mouseenter="hoveredId = fv.id"
        @mouseleave="hoveredId = null"
        @click.stop="openEditor(fv.key, $event.currentTarget as HTMLElement)"
      >
        <!-- project/area 直接以图标+名称展示，不渲染字段名 -->
        <span
          v-if="fv.key !== 'project' && fv.key !== 'area'"
          class="property-key"
        >{{ truncateText(titleOf(fv.key)) }}:</span>
        <span class="property-value">
          <template v-if="getIcon(fv.key, dataOf(fv))">
            <Icon
              v-if="isSvgIcon(getIcon(fv.key, dataOf(fv)) as string)"
              :name="getIcon(fv.key, dataOf(fv)) as string"
            />
            <span v-else>{{ getIcon(fv.key, dataOf(fv)) }}</span>
            <span v-if="getLabel(fv.key, dataOf(fv)) && defOf(fv.key)?.displayStyle !== 'icon'">
              {{ truncateText(getLabel(fv.key, dataOf(fv))) }}
            </span>
          </template>
          <span v-else>{{ truncateText(getLabel(fv.key, dataOf(fv))) }}</span>
        </span>
        <button
          v-if="hoveredId === fv.id"
          class="delete-button"
          title="删除字段值"
          @click.stop="deleteRow(fv, $event)"
        >
          ×
        </button>
      </div>
    </div>

    <!-- 「+N」刻意放在 .property-list 之外：网格固定 2 列，徽标留在网格里会占掉一个
         格位、把块行多撑一行（实测行高 47.2 → 65.2）。作为 .property-display 的 flex
         兄弟，它贴在 chips 块右侧、垂直居中，行高不变。 -->
    <button
      v-if="variant === 'chips' && hiddenCount > 0"
      ref="moreBadgeRef"
      class="chips-more-badge"
      type="button"
      :title="`还有 ${hiddenCount} 个字段`"
      @click.stop="moreVisible = !moreVisible"
    >
      +{{ hiddenCount }}
    </button>

    <!-- 收纳浮层：只列被折叠的字段（行内已显示的那 2 个不重复出现），Teleport 到 body（ADR-0032），
         item 纵向逐行排列（见 _block.scss 的 .property-list--full），点击编辑 -->
    <BasePopover
      v-if="variant === 'chips'"
      :visible="moreVisible"
      :anchor-el="moreBadgeRef"
      placement="bottom"
      @close="moreVisible = false"
    >
      <div class="property-list property-list--full">
        <div
          v-for="fv in hiddenFields"
          :key="fv.id"
          class="property-item"
          :class="{ 'built-in': isSystemField(fv.key), 'quote-item': fv.key === 'quote' }"
          :title="fv.key === 'quote' ? String(dataOf(fv)) : undefined"
          @click.stop="pickFromPopover(fv, $event)"
        >
          <span
            v-if="fv.key !== 'project' && fv.key !== 'area'"
            class="property-key"
          >{{ titleOf(fv.key) }}:</span>
          <span class="property-value">
            <template v-if="getIcon(fv.key, dataOf(fv))">
              <Icon
                v-if="isSvgIcon(getIcon(fv.key, dataOf(fv)) as string)"
                :name="getIcon(fv.key, dataOf(fv)) as string"
              />
              <span v-else>{{ getIcon(fv.key, dataOf(fv)) }}</span>
              <span v-if="getLabel(fv.key, dataOf(fv)) && defOf(fv.key)?.displayStyle !== 'icon'">
                {{ getLabel(fv.key, dataOf(fv)) }}
              </span>
            </template>
            <span v-else>{{ getLabel(fv.key, dataOf(fv)) }}</span>
          </span>
          <!-- 面板是这些字段的唯一入口（行内只到第 2 个），所以 × 常驻可见而非 hover 才出 -->
          <button
            class="delete-button"
            title="删除字段值"
            @click.stop="deleteFromPopover(fv, $event)"
          >
            ×
          </button>
        </div>
      </div>
    </BasePopover>
  </div>

  <!-- list：content 下方「挂载即显示」的 Tag 字段区 -->
  <div
    v-else-if="variant === 'list' && tags.length"
    class="block-tag-fields"
  >
    <div
      v-for="def in fields"
      :key="def.id"
      class="block-tag-field-row"
      role="button"
      tabindex="0"
      @click="openFieldRow($event, def)"
      @keydown.enter="openFieldRow($event, def)"
    >
      <span class="block-tag-field-title">{{ def.title }}</span>
      <span
        v-if="valueText(def) !== null"
        class="block-tag-field-value"
      >{{ valueText(def) }}</span>
      <span
        v-else
        class="block-tag-field-placeholder"
      >—</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
/* ── 内联槽（原 PropertyInline） ── */
.property-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.property-inline-item {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 2px 6px;
  padding-right: 20px;
  transition: background var(--dur-fast) var(--ease-out);
  font-size: var(--text-sm);
  position: relative;
  /* 确保内部所有元素的基线对齐 */
  line-height: var(--leading-normal);
}

.property-inline-item.built-in {
  font-weight: var(--font-medium);
}

.property-inline-item.icon-only {
  padding: 2px 0;
  padding-right: 0;
}

.property-inline-item.icon-only .property-icon {
  margin-right: 0;
  font-size: var(--text-lg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.property-inline-item:hover {
  transform: scale(1.15);
}

.property-icon {
  margin-right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 确保 icon 和文本的垂直对齐 */
  line-height: var(--leading-none);
}

/* ── chips / all / book-note（原 PropertyDisplay） ── */
.property-display {
  margin-top: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  // 刻意不设 max-width：本类名同时被书笔记来源行（.property-display.book-note-source）
  // 复用，在此限宽会把来源行框成 240px 窄条、长原文引用竖着堆成几百像素高（实测 426px）；
  // 行内 chips 的宽度预算由 .block-row-properties 的 max-width 一处管（见 _block.scss）。
  // 与「带右侧字段的块行」背景同源（同为写死的 rgba(0,0,0,.02)），
  // 二者靠同色表达视觉连通。刻意不做主题自适应：要的就是几乎不可见的微暗纱。
  background-color: var(--surface-faint);
}

/* 书笔记紧凑来源行：Pin + [章节] + 原文引用（原文引用可完整换行） */
.book-note-source {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  width: 100%;
  gap: 6px;
  /* 整体向右缩进，使来源行明显位于笔记内容之下（不在同一左对齐线上） */
  margin-left: 22px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.book-note-source.can-jump {
  cursor: pointer;
}

.book-note-source.can-jump:hover {
  background: var(--accent-08, rgba(59, 130, 246, 0.08));
  color: var(--accent);
}

.source-pin {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.source-chapter {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-weight: 500;
}

/* 原文引用占满整行（换行到第二行），左对齐到章节之下 */
.source-quote {
  flex: 1 1 100%;
  margin-left: 14px;
  color: var(--text-tertiary);
  font-style: italic;
}

.property-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0px;
}

/* 票 06：quote 字段（高亮原文）单行截断，悬浮 title 看全文 */
.property-item.quote-item .property-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 420px;
  display: inline-block;
  vertical-align: bottom;
}

.property-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
  cursor: pointer;
  padding: 2px 4px;
  // 行内：× 只在 hover 出现，故常驻不留 20px 占位——那会把每个 chip 白撑宽 16px
  // （实测 93.1 → 77.1），两列合计 32px 提前顶到容器 max-width 上限。
  // 浮层内的 item 例外（× 常驻），见 .property-list--full 规则。
  padding-right: 4px;
  border-radius: 4px;
  transition: background var(--dur-fast) var(--ease-out);
  position: relative;
}

.property-item:hover {
  background: var(--accent-08, rgba(59, 130, 246, 0.08));
  // hover 才为「×」腾位（容器右端固定，chips 区整体向左扩 16px；实测不换行、不推正文）
  padding-right: 20px;
}

/* 浮层是字段的管理面：× 常驻显示，因此也要常驻留出占位——与行内「hover 才腾位」相反 */
.property-list--full .property-item {
  padding-right: 20px;
}

.property-item.built-in .property-key {
  color: var(--primary-color, #007bff);
  font-weight: var(--font-medium);
}

.property-key {
  color: #6b7280;
}

.property-value {
  color: #374151;
}

.delete-button {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--heading-5);
  line-height: var(--leading-none);
  color: #9ca3af;
  padding: 0 4px;
  border-radius: 4px;
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.delete-button:hover {
  color: #374151;
  background: rgba(0, 0, 0, 0.05);
}

/* ── list 变体（Tag 字段区） ── */
.block-tag-fields {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-1) 0;
}

.block-tag-field-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--text-sm);
  cursor: pointer;
  border-radius: var(--radius-sm);
  padding: 1px var(--space-1);

  &:hover {
    background: var(--bg-base2);
  }
}

.block-tag-field-title {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  min-width: 4em;
}

.block-tag-field-value {
  color: var(--text-primary);
}

.block-tag-field-placeholder {
  color: var(--text-tertiary);
}
</style>
