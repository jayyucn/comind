<script setup lang="ts">
/**
 * 关系引用编辑器（issue T5）—— relation 字段值的专属录入控件，与
 * DatePicker / NumberInput / EnumSelect / TextField 同构（common/ 下、
 * v-model 契约、28px 高度基线 + 渐进披露语言）。
 *
 * 形态：触发按钮（有值 = 按关系类型着色的目标 chip；无值 = 虚线 ghost「未填」）
 * + 点击弹出两段式面板（Teleport 到 body，fixed 定位 + 视口收边，与 EnumSelect
 * 同一套定位策略）：
 *   1. 关系类型段：复用关系类型清单（useRelationshipTypes），按色点 + label 渲染；
 *   2. 目标段：搜索块/页清单（pages store 全量 + blocks store 已加载块）。
 *
 * 值契约（ADR 字段值家族统一）：
 * - v-model（modelValue: RelationRefValue | undefined / update:modelValue）：
 *   undefined = 未填 = 删行（与 deleteFieldValue 的「无行即空」语义一致）。
 * - 两段都选定（目标 + 关系类型）才 emit 完整 payload；关系类型优先取字段定义上
 *   的约定值（relationshipTypeId prop，来自 PersistedFieldDefinition.closed_values[0]）。
 * - 清除 × 按钮：emit undefined，上层据此删值行。
 *
 * 着色：关系类型自带 color（relationship_type 领域模型，hex 值来自用户数据而非
 * 代码硬编码），经 `--relation-color` CSS 变量喂给描边/文字；无类型或无色回落
 * 中性 chip（.rre-chip 无色变量态）。悬空 targetId（块/页已删）降级显示
 * 「未知目标」+ 中性样式（.rre-chip--dangling）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRelationshipTypes } from '../../composables/useRelationshipTypes'
import type { RelationshipType } from '../../types/relationship-type'
import type { RelationRefValue } from '../../types/field-definition'
import { useBlockStore } from '../../stores/blocks'
import { usePageStore } from '../../stores/pages'

export type RelationRefEditorValue = RelationRefValue | undefined

const props = withDefaults(
  defineProps<{
    /** 当前值；undefined = 未填。 */
    modelValue?: RelationRefEditorValue
    /** 空值占位符。 */
    placeholder?: string
    /** 字段定义上约定的关系类型 id（closed_values[0]）；无值新建时预选。 */
    relationshipTypeId?: string
    /** 排除的目标 id（通常 = 宿主块自身，不允许自引用）。 */
    excludeId?: string
  }>(),
  { modelValue: undefined, placeholder: '未填', relationshipTypeId: '', excludeId: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: RelationRefEditorValue] }>()

const relationshipTypes = useRelationshipTypes()
const blockStore = useBlockStore()
const pageStore = usePageStore()

// 关系类型清单惰性加载（fire-and-forget：jsdom / 离线环境静默失败，
// 清单为空时关系类型段显示空态，不阻断目标选择）
void relationshipTypes.load().catch(() => {})

const open = ref(false)
const triggerEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const anchor = ref<{ x: number; y: number }>({ x: 0, y: 0 })
const query = ref('')

/** 目标候选（统一形状）：页（全量）+ 块（已加载页的块）。 */
interface TargetCandidate {
  id: string
  label: string
  kind: '页' | '块'
}

/** 块内容摘要（首行、截断；空内容给占位文案）。 */
function blockLabel(content: string): string {
  const firstLine = (content ?? '').split('\n').find((l) => l.trim()) ?? ''
  const trimmed = firstLine.trim()
  return trimmed ? (trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed) : '（空块）'
}

const targetCandidates = computed<TargetCandidate[]>(() => {
  const out: TargetCandidate[] = []
  for (const p of pageStore.pages) {
    out.push({ id: p.id, label: p.title, kind: '页' })
  }
  for (const b of blockStore.blocks) {
    if (b.id === props.excludeId) continue
    out.push({ id: b.id, label: blockLabel(b.content), kind: '块' })
  }
  return out
})

const filteredTargets = computed<TargetCandidate[]>(() => {
  const q = query.value.trim().toLowerCase()
  const base = q
    ? targetCandidates.value.filter((c) => c.label.toLowerCase().includes(q))
    : targetCandidates.value
  return base.slice(0, 50)
})

/** 关系类型记录：按 id 或 type 双匹配（容错历史值存 type 的形态）。 */
function relTypeOf(idOrType: string): RelationshipType | undefined {
  if (!idOrType) return undefined
  return relationshipTypes.all.value.find((r) => r.id === idOrType || r.type === idOrType)
}

/** 目标未选时的关系类型挂起态：先点类型再点目标，payload 一次成文（见 pickRelType / pickTarget）。 */
const pendingRelTypeId = ref('')

/** 当前关系类型（挂起的 > 值上的 > 字段定义约定的）。 */
const currentRelType = computed<RelationshipType | undefined>(() => {
  const pending = relTypeOf(pendingRelTypeId.value)
  if (pending) return pending
  const fromValue = props.modelValue ? relTypeOf(props.modelValue.relationshipTypeId) : undefined
  return fromValue ?? relTypeOf(props.relationshipTypeId)
})

/** 关系类型色（用户数据色，非代码硬编码）；空串 = 中性 chip。 */
const relationColor = computed<string>(() => currentRelType.value?.color ?? '')

/** 目标展示信息：命中页/块给标题，悬空给 undefined（降级「未知目标」）。 */
const currentTarget = computed<TargetCandidate | undefined>(() => {
  const id = props.modelValue?.targetId
  if (!id) return undefined
  return targetCandidates.value.find((c) => c.id === id)
})

const hasValue = computed(() => !!props.modelValue?.targetId)
const isDangling = computed(() => hasValue.value && !currentTarget.value)

const triggerLabel = computed<string>(() => {
  if (!hasValue.value) return props.placeholder
  return currentTarget.value?.label ?? '未知目标'
})

/* —— 展开 / 收起 —— */
function toggle() {
  if (open.value) close()
  else openPanel()
}
function openPanel() {
  open.value = true
  query.value = ''
  nextTick(placePanel)
}
function close() {
  open.value = false
  pendingRelTypeId.value = ''
}

/** 测量触发按钮位置并视口收边，与 EnumSelect.placePanel 同策略。 */
function placePanel() {
  const btn = triggerEl.value
  if (!btn) return
  const r = btn.getBoundingClientRect()
  let x = r.left
  let y = r.bottom + 4
  const el = panelEl.value
  if (el && typeof window !== 'undefined') {
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (x + el.offsetWidth > vw - 8) x = Math.max(8, vw - el.offsetWidth - 8)
    if (y + el.offsetHeight > vh - 8) {
      const above = r.top - el.offsetHeight - 4
      y = above >= 8 ? above : Math.max(8, vh - el.offsetHeight - 8)
    }
  }
  anchor.value = { x, y }
}

/* —— 取值回调：两段齐备才 emit 完整 payload —— */

function pickRelType(id: string) {
  const targetId = props.modelValue?.targetId
  if (!targetId) {
    // 目标未选：挂起关系类型，等目标选定后一并 emit（不产半成品 payload）
    pendingRelTypeId.value = id
    return
  }
  if (props.modelValue.relationshipTypeId === id) return
  emit('update:modelValue', { targetId, relationshipTypeId: id })
}

function pickTarget(id: string) {
  const relTypeId = pendingRelTypeId.value
    || props.modelValue?.relationshipTypeId
    || props.relationshipTypeId
  if (!relTypeId) return // 关系类型未定：不 emit 半成品 payload
  pendingRelTypeId.value = ''
  if (props.modelValue?.targetId === id && props.modelValue.relationshipTypeId === relTypeId) return
  emit('update:modelValue', { targetId: id, relationshipTypeId: relTypeId })
  close()
}

/** 清除：emit undefined，上层据此删值行（「无行即空」语义）。 */
function clearValue() {
  emit('update:modelValue', undefined)
}

// 面板打开期间外部值变化时无需同步本地态（两段选择都直接读写 modelValue /
// relationshipTypeId，无本地草稿）——watch 仅用于面板打开时重置搜索词。
watch(open, (v) => {
  if (v) query.value = ''
})

// 测试钩子：暴露语义原子（openPanel/close/pickRelType/pickTarget/clearValue），
// 绕过 jsdom 合成事件的不确定性。不参与生产交互。
defineExpose({ openPanel, close, pickRelType, pickTarget, clearValue })
</script>

<template>
  <div class="relation-ref-editor">
    <button
      ref="triggerEl"
      type="button"
      class="rre-chip block-field-zone-chip"
      :class="{
        'block-field-zone-chip--ghost': !hasValue,
        'block-field-zone-chip--relation': hasValue && !isDangling,
        'block-field-zone-chip--dangling': isDangling,
        open,
      }"
      :style="relationColor && !isDangling ? { '--relation-color': relationColor } : undefined"
      data-testid="rre-trigger"
      :aria-label="hasValue ? `关系目标：${triggerLabel}` : '选择关系目标'"
      @click.stop="toggle"
    >
      <span
        class="bfz-chip-value"
        :class="{ 'bfz-chip-value--ghost': !hasValue }"
      >{{ triggerLabel }}</span>
      <span
        v-if="currentRelType && hasValue"
        class="rre-rel-label"
      >{{ currentRelType.label }}</span>
      <span
        v-if="hasValue"
        class="rre-clear"
        title="清除"
        data-testid="rre-clear"
        @click.stop="clearValue"
      >×</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelEl"
        class="rre-root"
        :style="{ left: anchor.x + 'px', top: anchor.y + 'px' }"
      >
        <div
          class="rre-backdrop"
          @click="close"
        />
        <div
          class="rre-panel"
          data-testid="rre-panel"
        >
          <!-- 段一：关系类型（复用关系类型清单，色点 + label） -->
          <div class="rre-section-title">
            关系类型
          </div>
          <ul
            class="rre-list"
            data-testid="rre-rel-list"
          >
            <li
              v-for="rt in relationshipTypes.items.value"
              :key="rt.id"
              class="rre-option"
              :class="{ selected: currentRelType?.id === rt.id }"
              :data-value="rt.id"
              data-testid="rre-rel-option"
              @click.stop="pickRelType(rt.id)"
            >
              <span
                class="rre-dot"
                :style="{ background: rt.color }"
              />
              <span class="rre-option-label">{{ rt.label }}</span>
            </li>
            <li
              v-if="!relationshipTypes.items.value.length"
              class="rre-empty"
            >
              暂无关系类型
            </li>
          </ul>

          <!-- 段二：目标（搜索块/页清单） -->
          <div class="rre-section-title">
            目标
          </div>
          <input
            v-model="query"
            class="rre-search"
            type="text"
            placeholder="搜索页面或块"
            data-testid="rre-search"
          >
          <ul
            class="rre-list"
            data-testid="rre-target-list"
          >
            <li
              v-for="c in filteredTargets"
              :key="c.id"
              class="rre-option"
              :class="{ selected: props.modelValue?.targetId === c.id }"
              :data-value="c.id"
              data-testid="rre-target-option"
              @click.stop="pickTarget(c.id)"
            >
              <span
                class="rre-kind"
                :class="c.kind === '页' ? 'rre-kind--page' : 'rre-kind--block'"
              >{{ c.kind }}</span>
              <span class="rre-option-label">{{ c.label }}</span>
            </li>
            <li
              v-if="!filteredTargets.length"
              class="rre-empty"
            >
              无匹配目标
            </li>
          </ul>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* —— 触发 chip（与 BlockFieldZone 字段 chip 同款描边幽灵款，28px 基线内） —— */
.relation-ref-editor {
  display: inline-flex;
  min-width: 0;
}

.rre-chip {
  position: relative;
  font-family: inherit;
}

/* 有值：按关系类型着色的链接态——色变量来自用户数据（relationship_type.color），
   经 --relation-color 喂描边与文字；无类型/无色时不设变量，回落中性描边。 */
.block-field-zone-chip--relation {
  border-color: var(--relation-color, var(--border-color));
}

.block-field-zone-chip--relation .bfz-chip-value {
  color: var(--relation-color, var(--accent));
}

/* 悬空 targetId 降级：中性 chip + 弱化文字（不再着色） */
.block-field-zone-chip--dangling {
  border-color: var(--border-color);
}

.block-field-zone-chip--dangling .bfz-chip-value {
  color: var(--text-tertiary);
  font-style: italic;
}

.rre-rel-label {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.rre-clear {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 4px;
  /* 仅 hover 触发 chip 时显示（渐进披露，同 es-clear）；隐形态必须 pointer-events:none */
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-base) var(--ease-out);
}

.rre-clear:hover {
  color: var(--error);
  background: var(--bg-hover);
}

.rre-chip:hover .rre-clear,
.rre-clear:hover {
  opacity: 1;
  pointer-events: auto;
}

/* —— 弹层（与 EnumSelect 的 es-root/es-panel 同构） —— */
.rre-root {
  position: fixed;
  z-index: var(--z-popover-deep);
}

.rre-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
}

.rre-panel {
  display: flex;
  flex-direction: column;
  width: 280px;
  max-height: 320px;
  padding: var(--space-2, 8px);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  box-shadow: var(--shadow-modal);
}

.rre-section-title {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  padding: 2px 4px 4px;
}

.rre-search {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 8px;
  margin-bottom: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
}

.rre-search:focus {
  outline: none;
  border-color: var(--accent);
}

.rre-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}

.rre-list + .rre-section-title {
  margin-top: 6px;
}

.rre-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.rre-option:hover {
  background: var(--bg-hover);
}

.rre-option.selected {
  background: var(--accent-subtle, rgba(59, 130, 246, 0.12));
}

.rre-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.rre-kind {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  line-height: 1;
  padding: 2px 4px;
  border-radius: 3px;
  color: var(--text-secondary);
  background: var(--surface-faint);
}

.rre-option-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.rre-empty {
  padding: 8px;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}
</style>
