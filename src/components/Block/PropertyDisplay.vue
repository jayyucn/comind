<script setup lang="ts">
import { Pin } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { openReaderWindow } from '../../composables/useReaderWindow'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'
import type { Property } from '../../types/property'
import { isSystemField } from '../../types/tag'
import { isTauriEnvironment } from '../../wasm/tauri-platform'
import BasePopover from '../common/BasePopover.vue'
import { Icon } from '../Icons'

const props = withDefaults(defineProps<{
  blockId: string
  /** 渲染变体：all=完整（默认，Backlinks 等既有用法）；chips=仅常规属性（块行尾右侧列）；book-note=仅书笔记来源行（content 下方原位） */
  variant?: 'all' | 'chips' | 'book-note'
}>(), {
  variant: 'all',
})

const propertyStore = usePropertyStore()
const blockStore = useBlockStore()
const editorStore = useEditorStore()

const visibleProperties = computed<Property[]>(() => {
  const all = propertyStore.getBlockProperties(props.blockId)
  return all.filter(prop => {
    if (prop.isHidden) return false
    // T14: deadline/scheduled 已内联为 dateRef，不在属性面板展示
    if (prop.key === 'deadline' || prop.key === 'scheduled') return false
    const def = propertyStore.getPropertyDef(prop.key)
    // 显示内置属性（displayPosition === 'bottom-of-block'）和所有自定义属性；
    // 「是否系统字段」由所属 Tag 的 isSystem 承载（ADR-0049 D5）
    return def?.displayPosition === 'bottom-of-block' || !isSystemField(prop.key)
  })
})

// ---- 票 06：跳回原文（书笔记 Block） ----

/** block 的全部属性（供书笔记紧凑行读取 chapter/quote） */
const allProperties = computed(() => propertyStore.getBlockProperties(props.blockId))

/** cfi 属性值（「跳回原文」的数据源） */
const sourceCfi = computed<string | null>(() => {
  const prop = allProperties.value.find(p => p.key === 'cfi')
  return prop ? String(prop.value) : null
})

/** 父级章节属性值（卷/部，双层结构时使用） */
const part = computed(() => {
  const prop = allProperties.value.find(p => p.key === 'part')
  return prop ? String(prop.value) : ''
})

/** 章节属性值 */
const chapter = computed(() => {
  const prop = allProperties.value.find(p => p.key === 'chapter')
  return prop ? String(prop.value) : ''
})

/** 原文引用属性值 */
const quote = computed(() => {
  const prop = allProperties.value.find(p => p.key === 'quote')
  return prop ? String(prop.value) : ''
})

/** 章节展示：双层结构 part/chapter，单层仅 chapter */
const chapterLabel = computed(() => {
  if (!chapter.value) return ''
  if (part.value) return `${part.value} / ${chapter.value}`
  return chapter.value
})

/** 书笔记：存在原文引用属性（quote 是书笔记四件套的核心展示属性） */
const isBookNote = computed(() => !!quote.value)

/** 仅 Tauri 环境且 cfi 属性存在时显示（web/Android 无阅读器窗口） */
const canJumpToSource = computed(() => isTauriEnvironment() && !!sourceCfi.value)

/** 唤起（或聚焦）该书阅读器窗口并定位到高亮处：bookPageId 即 Block 所属书 Page */
async function jumpToSource(): Promise<void> {
  const cfi = sourceCfi.value
  if (!cfi) return
  const block = blockStore.getBlock(props.blockId)
  const bookPageId = block?.pageId
  if (!bookPageId) return
  await openReaderWindow(bookPageId, { jumpCfi: cfi })
}

const hoveredPropertyId = ref<string | null>(null)

function isBuiltIn(key: string): boolean {
  return isSystemField(key)
}

function editProperty(prop: Property, event: MouseEvent) {
  // 快捷菜单与完整编辑器共用同一锚点约定（触发元素左下 + 4px）
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const position = { x: rect.left, y: rect.bottom + 4 }
  if (isBuiltIn(prop.key)) {
    editorStore.showQuickPropertyEditor(props.blockId, prop.key, position)
  } else {
    editorStore.showPropertyEditor(props.blockId, prop.key, position)
  }
}

// ---- 行内 chips 收纳：只显示前 CHIPS_PER_LINE 个 ----
// 装不下的整 chip 按序折进「+N」徽标，点开 BasePopover 看这些被收纳的属性。
// 刻意不随块内文本行数放量（曾按「行数 × 每行个数」放开）：chips 是行尾的附属信息，
// 不该因为正文写了三行就摊开三行 chip。

/** 行内显示的 chip 个数上限（与 _block.scss 的 grid-template-columns: repeat(2, …) 成对，改一处必改另一处） */
const CHIPS_PER_LINE = 2
/** chip 内文字超过此字数即截断，全文由 title 承载 */
const MAX_CHIP_TEXT = 8

const moreBadgeRef = ref<HTMLElement | null>(null)
const moreVisible = ref(false)

/** 单一真相：行内显示前 N 个，其余全部进「+N」浮层（浮层不再重复展示已显示的那些） */
const visibleChips = computed(() => visibleProperties.value.slice(0, CHIPS_PER_LINE))
const hiddenProperties = computed(() => visibleProperties.value.slice(CHIPS_PER_LINE))
const hiddenCount = computed(() => hiddenProperties.value.length)

function pickFromPopover(prop: Property, event: MouseEvent): void {
  moreVisible.value = false
  editProperty(prop, event)
}

function deleteProperty(prop: Property, event: MouseEvent) {
  event.stopPropagation()
  propertyStore.deleteProperty(prop.id, props.blockId)
}

/** 浮层内删除：删到没有剩余收纳项时徽标会消失（浮层锚点随之没了），顺手收起浮层 */
function deleteFromPopover(prop: Property, event: MouseEvent): void {
  deleteProperty(prop, event)
  if (hiddenProperties.value.length <= 1) moreVisible.value = false
}

function getPropertyTitle(key: string): string {
  const def = propertyStore.getPropertyDef(key)
  return def?.title ?? key
}

function getIcon(key: string, value: Property['value']): string | null {
  const def = propertyStore.getPropertyDef(key)
  if (def?.closedValues) {
    const cv = def.closedValues.find(cv => cv.value === value)
    if (cv?.icon) {
      return cv.icon
    }
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

function getLabel(key: string, value: Property['value']): string {
  const def = propertyStore.getPropertyDef(key)
  if (def?.closedValues) {
    const cv = def.closedValues.find(cv => cv.value === value)
    if (cv?.label) {
      return cv.label
    }
  }
  switch (key) {
    case 'project':
    case 'area':
      return String(value)
    case 'tags':
      return Array.isArray(value) ? value.join(', ') : String(value)
    case 'boolean':
      return value ? '是' : '否'
    default:
      return String(value)
  }
}

function isSvgIcon(icon: string): boolean {
  return icon.startsWith('status-') || icon.startsWith('priority-') || icon.startsWith('icon-')
}

// ---- 行内 chips 的文字截断与悬浮全量（仅 chips 变体，其它变体原样输出） ----

/** 超长即截断到 MAX_CHIP_TEXT 字，全文由 title 承载 */
function truncateText(text: string): string {
  if (props.variant !== 'chips') return text
  return text.length > MAX_CHIP_TEXT ? `${text.slice(0, MAX_CHIP_TEXT)}…` : text
}

/** chips 的悬浮提示给「属性名: 值」全量；其它变体维持原来只对 quote 给全文的行为 */
function chipTitleAttr(prop: Property): string | undefined {
  if (props.variant !== 'chips') {
    return prop.key === 'quote' ? String(prop.value) : undefined
  }
  // project/area 不渲染属性名，提示里也不重复
  if (prop.key === 'project' || prop.key === 'area') return String(prop.value)
  return `${getPropertyTitle(prop.key)}: ${getLabel(prop.key, prop.value)}`
}
</script>

<template>
  <!-- 书笔记：紧凑一行展示来源信息（Pin + 章节/序号 + "原文引用" + 页码），不展开属性列表 -->
  <div
    v-if="isBookNote && variant !== 'chips'"
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

  <div
    v-else-if="!isBookNote && variant !== 'book-note' && visibleProperties.length > 0"
    class="property-display"
  >
    <div class="property-list">
      <div
        v-for="prop in visibleChips"
        :key="prop.id"
        class="property-item"
        :class="{ 'built-in': isBuiltIn(prop.key), 'quote-item': prop.key === 'quote' }"
        :title="chipTitleAttr(prop)"
        @mouseenter="hoveredPropertyId = prop.id"
        @mouseleave="hoveredPropertyId = null"
        @click.stop="editProperty(prop, $event)"
      >
        <!-- project/area 直接以图标+名称展示，不渲染标签 -->
        <span
          v-if="prop.key !== 'project' && prop.key !== 'area'"
          class="property-key"
        >{{ truncateText(getPropertyTitle(prop.key)) }}:</span>
        <span class="property-value">
          <template v-if="getIcon(prop.key, prop.value)">
            <Icon
              v-if="isSvgIcon(getIcon(prop.key, prop.value)!)"
              :name="getIcon(prop.key, prop.value)!"
            />
            <span v-else>{{ getIcon(prop.key, prop.value) }}</span>
            <span v-if="getLabel(prop.key, prop.value) && propertyStore.getPropertyDef(prop.key)?.displayStyle !== 'icon'">
              {{ truncateText(getLabel(prop.key, prop.value)) }}
            </span>
          </template>
          <span v-else>{{ truncateText(getLabel(prop.key, prop.value)) }}</span>
        </span>
        <button
          v-if="hoveredPropertyId === prop.id"
          class="delete-button"
          title="删除属性"
          @click.stop="deleteProperty(prop, $event)"
        >
          ×
        </button>
      </div>
    </div>

    <!-- 「+N」刻意放在 .property-list 之外：网格固定 2 列，徽标留在网格里会占掉一个
         格位、把块行多撑一行（实测行高 47.2 → 65.2）。作为 .property-display 的 flex
         兄弟，它贴在 chips 块右侧、垂直居中，行高不变。 -->
    <button
      v-if="hiddenCount > 0"
      ref="moreBadgeRef"
      class="chips-more-badge"
      type="button"
      :title="`还有 ${hiddenCount} 个属性`"
      @click.stop="moreVisible = !moreVisible"
    >
      +{{ hiddenCount }}
    </button>

    <!-- 收纳浮层：只列被折叠的属性（行内已显示的那 2 个不重复出现），Teleport 到 body（ADR-0032），
         item 纵向逐行排列（见 _block.scss 的 .property-list--full），点击编辑 -->
    <BasePopover
      :visible="moreVisible"
      :anchor-el="moreBadgeRef"
      placement="bottom"
      @close="moreVisible = false"
    >
      <div class="property-list property-list--full">
        <div
          v-for="prop in hiddenProperties"
          :key="prop.id"
          class="property-item"
          :class="{ 'built-in': isBuiltIn(prop.key), 'quote-item': prop.key === 'quote' }"
          :title="prop.key === 'quote' ? String(prop.value) : undefined"
          @click.stop="pickFromPopover(prop, $event)"
        >
          <span
            v-if="prop.key !== 'project' && prop.key !== 'area'"
            class="property-key"
          >{{ getPropertyTitle(prop.key) }}:</span>
          <span class="property-value">
            <template v-if="getIcon(prop.key, prop.value)">
              <Icon
                v-if="isSvgIcon(getIcon(prop.key, prop.value)!)"
                :name="getIcon(prop.key, prop.value)!"
              />
              <span v-else>{{ getIcon(prop.key, prop.value) }}</span>
              <span v-if="getLabel(prop.key, prop.value) && propertyStore.getPropertyDef(prop.key)?.displayStyle !== 'icon'">
                {{ getLabel(prop.key, prop.value) }}
              </span>
            </template>
            <span v-else>{{ getLabel(prop.key, prop.value) }}</span>
          </span>
          <!-- 面板是这些属性的唯一入口（行内只到第 2 个），所以 × 常驻可见而非 hover 才出 -->
          <button
            class="delete-button"
            title="删除属性"
            @click.stop="deleteFromPopover(prop, $event)"
          >
            ×
          </button>
        </div>
      </div>
    </BasePopover>
  </div>
</template>

<style lang="scss" scoped>
.property-display {
  margin-top: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  // 刻意不设 max-width：本类名同时被书笔记来源行（.property-display.book-note-source）
  // 复用，在此限宽会把来源行框成 240px 窄条、长原文引用竖着堆成几百像素高（实测 426px）；
  // 行内 chips 的宽度预算由 .block-row-properties 的 max-width 一处管（见 _block.scss）。
  // 与「带右侧属性的块行」背景同源（同为写死的 rgba(0,0,0,.02)），
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
  transition: background 120ms ease, color 120ms ease;
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
  gap:  0px;
}

/* 票 06：quote 属性（高亮原文）单行截断，悬浮 title 看全文 */
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
  transition: background 120ms ease;
  position: relative;
}

.property-item:hover {
  background: var(--accent-08, rgba(59, 130, 246, 0.08));
  // hover 才为「×」腾位（容器右端固定，chips 区整体向左扩 16px；实测不换行、不推正文）
  padding-right: 20px;
}

/* 浮层是属性的管理面：× 常驻显示，因此也要常驻留出占位——与行内「hover 才腾位」相反 */
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
  transition: color 120ms ease, background 120ms ease;
}

.delete-button:hover {
  color: #374151;
  background: rgba(0, 0, 0, 0.05);
}
</style>
