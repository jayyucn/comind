<script setup lang="ts">
/**
 * 块字段渲染载体（ADR-0050 D1「挂载即显示」＋ ADR-0051 D6 职责全迁）。
 *
 * 单一载体承载块字段值的全部渲染位（原 `PropertyInline` / `PropertyDisplay` 的职责）：
 * - `between`：bullet 与内容之间的内联槽（如 status 任务图标）
 * - `book-note`：书笔记来源行（Pin + 章节 + 原文引用）
 * - `all`：完整字段列表（Backlinks 等）
 * - `list`：content 下方「挂载即显示」的 Tag 字段区（含空占位、隐藏规则）
 *
 * 块上每个字段值有且只有一个权威展示位（ADR-0050 D19 / D20）：行内 chips 列已下线，
 * 块内字段展示统一由 `list` 承担——它按标签模板驱动、标题取自持久化定义，
 * 比编译期反查更准（自定义字段不会退化成显示 field id）。`between` 内联槽独占
 * `between-bullet-content`（status 以图标呈现，形态不同，不在本区列文本）。
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
import { isSystemField } from '../../types/tag'
import type { PersistedFieldDefinition } from '../../types/tag-persisted'
import { decodeDefaultJson, isFieldHiddenByRule, normalizeHideWhen } from '../../utils/field-hide'
import { decodeFieldValueData } from '../../utils/field-value-codec'
import { isTauriEnvironment } from '../../wasm/tauri-platform'
import { Icon } from '../Icons'

const props = withDefaults(defineProps<{
  blockId: string
  /** 该块已挂的 tag id（来自 Block.tags 派生缓存）；仅 `list` 变体消费。 */
  tagIds?: string[]
  variant?: 'between' | 'right' | 'book-note' | 'all' | 'list'
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

/**
 * 内联槽行，按变体分流：`between` = bullet 与内容之间（status 任务图标）；
 * `right` = 内容行尾（priority 象限网格图标，ADR-0054 D3 恢复此槽）。
 *
 * `right` 槽此前以「恒空」为由移除（ADR-0050 D19 决策 4）：当时
 * `right-of-content` 全仓仅 priority 一个字段，而整行底色已承担扫描级信号，
 * 行内位被认为多余。ADR-0054 去掉底色后块行缺失扫描级展示位，故恢复。
 *
 * 两个内联槽分属不同字段、位置不同不构成重复；`list` 区（录入面）仍渲染
 * priority —— 它是唯一可写入口，与只读展示位职责不同、不互斥。
 */
const inlineRows = computed<FieldValue[]>(() =>
  rowsAt(props.variant === 'right' ? 'right-of-content' : 'between-bullet-content')
)

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

// ── 悬浮提示 ────────────────────────────────────────────────
// 块行尾 chips 渲染位已下线（ADR-0050 D20）：行内速览由 content 下方字段区承担，
// 它按标签模板驱动、标题取自持久化定义，比行内的编译期反查更准。
// 「+N」徽标与收纳浮层随之移除，`all` 变体（Backlinks 消费）改为全量平铺。

/** 悬浮提示：quote 给全文，其余给「字段名: 值」 */
function chipTitleAttr(fv: FieldValue): string | undefined {
  const value = dataOf(fv)
  if (fv.key === 'quote') return String(value)
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
 * 本区是块内**唯一的字段录入面**（ADR-0050 D20：行内 chips 列已下线），故模板内
 * 所有字段都在此列出——包括 `bottom-of-block` 域字段与无 `displayPosition` 的自定义字段。
 *
 * 排除项只有 `between-bullet-content`（`status` 任务图标）：它由 bullet 与内容之间的
 * 内联槽渲染，属另一种视觉形态（图标而非「标题: 值」文本），在本区再列一行是同物两渲染。
 *
 * `right-of-content`（`priority`）**不排除** —— ADR-0054 D4 明确：本区是录入面
 * （唯一可写入口，点击唤起快速编辑器），行内`right` 槽是只读展示位，两者职责不同、
 * 不互斥，不构成 ADR-0050 D19 意义上的「同物两渲染」。
 * 该判定经 `getFieldDefinition(key)` 反查编译期 `FieldDefinition.displayPosition`
 * （`PersistedFieldDefinition` 不持久化该字段，见 `tag-persisted.ts:6`）。
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
  <!-- 内联槽：between（bullet 与内容之间，status 任务图标）
       / right（内容行尾，priority 象限网格图标，ADR-0054 D3） -->
  <div
    v-if="variant === 'between' || variant === 'right'"
    class="property-inline"
    :class="`property-inline--${variant}`"
  >
    <div
      v-for="fv in inlineRows"
      :key="fv.id"
      class="property-inline-item"
      :class="{
        'built-in': isSystemField(fv.key),
        'icon-only': defOf(fv.key)?.displayStyle === 'icon'
      }"
      :data-field="fv.key"
      :data-value="String(dataOf(fv))"
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
            :size="variant === 'right' ? 14 : undefined"
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

  <!-- all：完整字段列表（Backlinks 消费；块行内已无此渲染位，ADR-0050 D20） -->
  <div
    v-else-if="variant === 'all' && !isBookNote && displayRows.length > 0"
    class="property-display"
  >
    <div class="property-list">
      <div
        v-for="fv in displayRows"
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

/* 内容行尾槽（priority 象限网格图标，ADR-0054 D3）：
   与 `between` 槽同为内联位置差异，靠 margin-left 推到行尾。
   尺寸 18 —— 旧注释的「20px 下限」实测对象是已被 ADR 否决的十字轴图元，
   对现用的 2×2 方格不成立；18 为按 D5#1（灰度下位置可辨）复核后的取值。
   本槽同时承担降层级（ADR-0054 D6）：强度只压点亮格，栅格（参照系）保持不变。 */
.property-inline--right {
  margin-left: auto;
  padding-left: 10px;
}

/* 整体减重：让图标比正文轻，不再与正文字号争视觉重量 */
.property-inline--right .property-inline-item {
  opacity: 0.7;
  transition: opacity var(--dur-fast) var(--ease-out);
}

/* hover 澄清而非膨胀：恢复到全不透明，取消 `between` 槽沿用的 scale(1.15) 放大 */
.property-inline--right .property-inline-item:hover {
  transform: none;
  opacity: 1;
}

/* 默认档 Low 不是信号、是「背景态」（新建任务默认即 Low，出现频率最高）：
   只压暗点亮格 —— 栅格照旧，位置读数不受影响 */
.property-inline--right .property-inline-item[data-field='priority'][data-value='Low'] :deep(.pq-lit) {
  opacity: 0.4;
}

/* hover 恢复 Low 的可辨性，保住「可点击编辑」的发现性 */
.property-inline--right .property-inline-item[data-field='priority'][data-value='Low']:hover :deep(.pq-lit) {
  opacity: 1;
}

.property-inline--right :deep(.property-icon) {
  /* 图标尺寸由上方 Icon 的 :size 传入（本槽为 14），此处仅对齐基线 */
  line-height: 1;
  opacity: 0.8;
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
  // 复用，在此限宽会把来源行框成 240px 窄条、长原文引用竖着堆成几百像素高（实测 426px）。
  // 刻意不做主题自适应：几乎不可见的微暗纱。
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
