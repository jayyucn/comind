<script setup lang="ts">
/**
 * 标签管理页（ADR-0050 D5）：左栏列表（统计副标题 / 搜索 / 全部·最近使用·未使用 /
 * 行含成员数·字段数·来源）+ 右栏详情（成员与来源页统计 / 字段模板含继承徽标 /
 * 单父继承区 / 删除标签）。
 *
 * 边界与归属：
 * - 打标入口不在此页 —— 建实体 ≠ 打标，打标仍唯一走 content `#名`（ADR-0049 D6）。
 * - 「新建标签」= 标题 + 可选父标签；「+ 添加字段」= 建字段定义 + 追加该标签自身字段。
 * - 成员口径：管理页用**直系数**（ADR-0050 D10 #3）；含后代的聚合口径只在 tag 聚合页用。
 * - 继承解析（有效字段集合）单源在 Rust，本页只消费 store 的解析结果。
 */
import { computed, onMounted, ref } from 'vue'
import type { PersistedFieldDefinition, PersistedTag } from '../../types/tag-persisted'
import { useBlockCardStore } from '../../stores/blockCard'
import { useTagsStore } from '../../stores/tags'
import BasePopover from '../common/BasePopover.vue'
import ConfirmDialog from '../ConfirmDialog.vue'
import PageTitle from '../common/PageTitle.vue'

const tagsStore = useTagsStore()
const blockCardStore = useBlockCardStore()

type FilterMode = 'all' | 'recent' | 'unused'

const searchQuery = ref('')
const filterMode = ref<FilterMode>('all')
const selectedTagId = ref<string | null>(null)

onMounted(async () => {
  await Promise.all([tagsStore.ensureLoaded(), blockCardStore.getCards()])
  if (!selectedTagId.value && tagsStore.userTags.length) {
    selectedTagId.value = tagsStore.userTags[0].id
  }
})

// ── 左栏：统计与列表 ──────────────────────────────────────────

const statsSubtitle = computed(() => {
  const all = tagsStore.userTags
  const withParent = all.filter((t) => !!t.parent_id).length
  const members = all.reduce((sum, t) => sum + tagsStore.memberSummary(t.id).count, 0)
  return `${all.length} 个标签 · ${withParent} 个带父标签 · ${members} 个成员`
})

const filteredTags = computed<PersistedTag[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const base =
    filterMode.value === 'recent'
      ? tagsStore.recentTags()
      : filterMode.value === 'unused'
        ? tagsStore.unusedTags()
        : tagsStore.userTags
  return q ? base.filter((t) => t.title.toLowerCase().includes(q)) : base
})

function memberCount(tagId: string): number {
  return tagsStore.memberSummary(tagId).count
}

/** 来源徽标：未使用 → 无成员；有父 → ← 父名；否则顶级标签。 */
function sourceLabel(tag: PersistedTag): string {
  if (memberCount(tag.id) === 0) return '未使用'
  const parent = tagsStore.parentTagOf(tag.id)
  return parent ? `← ${parent.title}` : '顶级标签'
}

// ── 右栏：详情 ────────────────────────────────────────────────

const selectedTag = computed(() =>
  selectedTagId.value ? tagsStore.getTagById(selectedTagId.value) : undefined,
)

const detailSummary = computed(() =>
  selectedTag.value
    ? tagsStore.memberSummary(selectedTag.value.id)
    : { count: 0, pageCount: 0 },
)

/** 字段模板行：有效字段（含继承）+ 来源标签（自身 / 继承自哪个祖先）。 */
const detailFields = computed(() => {
  const tag = selectedTag.value
  if (!tag) return [] as Array<{ def: PersistedFieldDefinition; origin: PersistedTag | undefined }>
  return tagsStore.effectiveFieldDefinitions(tag.id).map((def) => ({
    def,
    origin: tagsStore.fieldOrigin(tag.id, def.id),
  }))
})

function typeLabel(def: PersistedFieldDefinition): string {
  if (def.closed_values?.length) return '下拉选择'
  const map: Record<string, string> = {
    string: '文本',
    number: '数值',
    date: '日期',
    boolean: '是/否',
    page: '页面引用',
    array: '列表',
  }
  return map[def.type] ?? def.type
}

const parentTag = computed(() =>
  selectedTag.value ? tagsStore.parentTagOf(selectedTag.value.id) : undefined,
)

const parentCandidates = computed(() =>
  selectedTag.value ? tagsStore.parentCandidates(selectedTag.value.id) : [],
)

async function onPickParent(event: Event) {
  const parentId = (event.target as HTMLSelectElement).value
  if (!selectedTag.value || !parentId) return
  await tagsStore.setParent(selectedTag.value.id, parentId)
}

async function onClearParent() {
  if (!selectedTag.value) return
  await tagsStore.setParent(selectedTag.value.id, null)
}

async function onRemoveField(fieldDefinitionId: string) {
  if (!selectedTag.value) return
  await tagsStore.removeFieldFromTag(selectedTag.value.id, fieldDefinitionId)
}

// ── 删除（先告知影响） ────────────────────────────────────────

const showDeleteConfirm = ref(false)

/** 删除影响文案：成员规模 + 「值保留、可复挂恢复」语义 + 子标签失去继承。 */
const deleteImpact = computed(() => {
  const tag = selectedTag.value
  if (!tag) return ''
  const { count, pageCount } = tagsStore.memberSummary(tag.id)
  const children = tagsStore.childTags(tag.id).length
  const childNote = children > 0 ? `，其下 ${children} 个子标签会失去从这里继承的字段` : ''
  return `#${tag.title} 现有 ${count} 个成员（来自 ${pageCount} 个页面）${childNote}。成员块上已填的值会保留，重新挂载同名标签即可恢复。`
})

function onDeleteTag() {
  if (!selectedTag.value) return
  showDeleteConfirm.value = true
}

async function doDeleteTag() {
  if (!selectedTag.value) return
  const id = selectedTag.value.id
  showDeleteConfirm.value = false
  await tagsStore.deleteTag(id)
  selectedTagId.value = tagsStore.userTags[0]?.id ?? null
}

// ── 新建标签弹层（BasePopover） ────────────────────────────────

const createOpen = ref(false)
const createAnchor = ref<HTMLElement | null>(null)
const createPos = ref({ x: 0, y: 0 })
const newTagTitle = ref('')
const newTagParentId = ref('')

function openCreatePopover(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  createAnchor.value = el
  createPos.value = { x: rect.left, y: rect.bottom + 4 }
  newTagTitle.value = ''
  newTagParentId.value = ''
  createOpen.value = true
}

async function submitCreateTag() {
  const title = newTagTitle.value.trim()
  if (!title) return
  await tagsStore.createTag({ title, parent_id: newTagParentId.value || null })
  createOpen.value = false
}

// ── 添加字段弹层（BasePopover） ────────────────────────────────

const addFieldOpen = ref(false)
const addFieldAnchor = ref<HTMLElement | null>(null)
const addFieldPos = ref({ x: 0, y: 0 })
const newFieldTitle = ref('')
const newFieldType = ref('string')
const newFieldOptions = ref('')

function openAddFieldPopover(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  addFieldAnchor.value = el
  addFieldPos.value = { x: rect.left, y: rect.bottom + 4 }
  newFieldTitle.value = ''
  newFieldType.value = 'string'
  newFieldOptions.value = ''
  addFieldOpen.value = true
}

async function submitAddField() {
  const title = newFieldTitle.value.trim()
  if (!title || !selectedTag.value) return
  const isSelect = newFieldType.value === 'select'
  const closedValues = isSelect
    ? newFieldOptions.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null
  await tagsStore.addFieldToTag(selectedTag.value.id, {
    title,
    type: isSelect ? 'string' : newFieldType.value,
    closed_values: closedValues,
  })
  addFieldOpen.value = false
}
</script>

<template>
  <div class="tags-page">
    <PageTitle
      title="标签"
      :subtitle="statsSubtitle"
    >
      <template #actions>
        <input
          v-model="searchQuery"
          class="tag-search-input"
          type="text"
          placeholder="搜索标签"
        >
        <button
          class="tag-create-btn"
          type="button"
          @click="openCreatePopover"
        >
          + 新建标签
        </button>
      </template>
    </PageTitle>

    <div class="tags-body">
      <!-- 左栏：列表 -->
      <aside class="tag-list">
        <div class="tag-filter-chips">
          <button
            v-for="chip in [
              { key: 'all', label: '全部' },
              { key: 'recent', label: '最近使用' },
              { key: 'unused', label: '未使用' },
            ]"
            :key="chip.key"
            type="button"
            class="tag-filter-chip"
            :class="{ 'tag-filter-chip--active': filterMode === chip.key }"
            @click="filterMode = chip.key as FilterMode"
          >
            {{ chip.label }}
          </button>
        </div>

        <div class="tag-rows">
          <div
            v-for="tag in filteredTags"
            :key="tag.id"
            class="tag-row"
            :class="`tag-row--${tag.id}`"
            role="button"
            tabindex="0"
            @click="selectedTagId = tag.id"
            @keydown.enter="selectedTagId = tag.id"
          >
            <span class="tag-row-title">#{{ tag.title }}</span>
            <span
              v-if="tag.is_system"
              class="tag-row-system"
            >系统</span>
            <span class="tag-row-meta">{{ memberCount(tag.id) }} 成员</span>
            <span class="tag-row-meta">{{ tag.field_ids.length }} 个字段</span>
            <span class="tag-row-source">{{ sourceLabel(tag) }}</span>
          </div>
          <p
            v-if="!filteredTags.length"
            class="tag-list-empty"
          >
            没有匹配的标签
          </p>
        </div>
      </aside>

      <!-- 右栏：详情 -->
      <section class="tag-detail">
        <template v-if="selectedTag">
          <h2 class="tag-detail-title">
            #{{ selectedTag.title }}
          </h2>
          <p class="tag-detail-meta">
            {{ detailSummary.count }} 个成员 · 来自 {{ detailSummary.pageCount }} 个页面
          </p>

          <h3 class="tag-section-title">
            字段模板
          </h3>
          <div class="tag-fields">
            <div
              v-for="row in detailFields"
              :key="row.def.id"
              class="tag-field-row"
            >
              <span class="tag-field-title">{{ row.def.title }}</span>
              <span class="tag-field-type">{{ typeLabel(row.def) }}</span>
              <span
                v-if="row.origin && row.origin.id !== selectedTag.id"
                class="tag-field-badge tag-field-badge--inherited"
              >继承 ← {{ row.origin.title }}</span>
              <span
                v-else
                class="tag-field-badge"
              >自身</span>
              <button
                v-if="row.origin && row.origin.id === selectedTag.id"
                type="button"
                class="tag-field-remove"
                @click="onRemoveField(row.def.id)"
              >
                移除
              </button>
            </div>
            <p
              v-if="!detailFields.length"
              class="tag-fields-empty"
            >
              该标签还没有字段
            </p>
          </div>
          <button
            class="tag-add-field"
            type="button"
            @click="openAddFieldPopover"
          >
            + 添加字段
          </button>

          <h3 class="tag-section-title">
            继承
          </h3>
          <div class="tag-parent-area">
            <template v-if="parentTag">
              <span class="tag-parent-chip">← {{ parentTag.title }}</span>
              <select
                v-if="parentCandidates.length"
                class="tag-parent-select"
                :value="''"
                @change="onPickParent"
              >
                <option value="">
                  更换父标签
                </option>
                <option
                  v-for="candidate in parentCandidates"
                  :key="candidate.id"
                  :value="candidate.id"
                >
                  {{ candidate.title }}
                </option>
              </select>
              <button
                type="button"
                class="tag-parent-clear"
                @click="onClearParent"
              >
                清除
              </button>
            </template>
            <template v-else>
              <span class="tag-parent-none">顶级标签</span>
              <select
                v-if="parentCandidates.length"
                class="tag-parent-select"
                @change="onPickParent"
              >
                <option value="">
                  + 添加父标签
                </option>
                <option
                  v-for="candidate in parentCandidates"
                  :key="candidate.id"
                  :value="candidate.id"
                >
                  {{ candidate.title }}
                </option>
              </select>
            </template>
          </div>

          <button
            v-if="!selectedTag.is_system"
            type="button"
            class="tag-delete"
            @click="onDeleteTag"
          >
            删除标签
          </button>
        </template>
        <p
          v-else
          class="tag-detail-empty"
        >
          选择左侧标签查看详情
        </p>
      </section>
    </div>

    <!-- 删除确认（先告知影响，spec 用户故事 16/17） -->
    <ConfirmDialog
      :visible="showDeleteConfirm"
      :title="`删除标签 #${selectedTag?.title ?? ''}`"
      :message="deleteImpact"
      confirm-text="删除"
      danger
      @confirm="doDeleteTag"
      @cancel="showDeleteConfirm = false"
    />

    <!-- 新建标签 -->
    <BasePopover
      :visible="createOpen"
      :position="createPos"
      :anchor-el="createAnchor"
      @close="createOpen = false"
    >
      <div class="tag-create-panel">
        <input
          v-model="newTagTitle"
          class="tag-create-title"
          type="text"
          placeholder="标签标题"
        >
        <select
          v-model="newTagParentId"
          class="tag-create-parent"
        >
          <option value="">
            无父标签
          </option>
          <option
            v-for="tag in tagsStore.userTags"
            :key="tag.id"
            :value="tag.id"
          >
            {{ tag.title }}
          </option>
        </select>
        <button
          type="button"
          class="tag-create-confirm"
          @click="submitCreateTag"
        >
          确认
        </button>
      </div>
    </BasePopover>

    <!-- 添加字段 -->
    <BasePopover
      :visible="addFieldOpen"
      :position="addFieldPos"
      :anchor-el="addFieldAnchor"
      @close="addFieldOpen = false"
    >
      <div class="tag-field-panel">
        <input
          v-model="newFieldTitle"
          class="tag-field-title-input"
          type="text"
          placeholder="字段标题"
        >
        <select
          v-model="newFieldType"
          class="tag-field-type-select"
        >
          <option value="string">
            文本
          </option>
          <option value="number">
            数值
          </option>
          <option value="date">
            日期
          </option>
          <option value="select">
            下拉选择
          </option>
        </select>
        <input
          v-if="newFieldType === 'select'"
          v-model="newFieldOptions"
          class="tag-field-options"
          type="text"
          placeholder="候选值，逗号分隔"
        >
        <button
          type="button"
          class="tag-field-confirm"
          @click="submitAddField"
        >
          添加字段
        </button>
      </div>
    </BasePopover>
  </div>
</template>

<style lang="scss" scoped>
.tags-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: 0 var(--space-8);
}

.tags-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--space-4);
  margin: var(--space-3) 0 var(--space-4);
}

/* ── 左栏 ── */
.tag-list {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
}

.tag-filter-chips {
  display: flex;
  gap: var(--space-1);
}

.tag-filter-chip {
  padding: 2px var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;

  &--active {
    color: var(--text-primary);
    background: var(--bg-base2);
  }
}

.tag-rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-1);
}

.tag-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);

  &:hover {
    background: var(--bg-base2);
  }
}

.tag-row-title {
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-row-system,
.tag-row-meta,
.tag-row-source {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.tag-list-empty,
.tag-fields-empty,
.tag-detail-empty {
  padding: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

/* ── 右栏 ── */
.tag-detail {
  flex: 1;
  min-width: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
}

.tag-detail-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--text-primary);
}

.tag-detail-meta {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.tag-section-title {
  margin: var(--space-3) 0 var(--space-1);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
}

.tag-field-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  font-size: var(--text-sm);
  border-bottom: 1px solid var(--border);
}

.tag-field-title {
  color: var(--text-primary);
}

.tag-field-type,
.tag-field-badge {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.tag-field-remove,
.tag-parent-clear,
.tag-delete,
.tag-add-field,
.tag-create-btn {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-2);
  cursor: pointer;
}

.tag-delete {
  margin-top: var(--space-4);
  color: var(--danger);
  border-color: var(--danger);
}

.tag-parent-area {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.tag-parent-chip,
.tag-parent-none {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.tag-search-input,
.tag-create-title,
.tag-create-parent,
.tag-field-title-input,
.tag-field-type-select,
.tag-field-options {
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-2);
}

.tag-create-panel,
.tag-field-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 240px;
}
</style>
