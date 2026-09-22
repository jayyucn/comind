<script setup lang="ts">
/**
 * 标签管理页（ADR-0050 D5）：左栏（统计副标题 / 搜索 / 全部·最近使用·未使用 /
 * 行 = 标题胶囊 · 成员数 · 字段数 · 来源）+ 右栏详情（成员与来源页统计 / 字段模板白卡 /
 * 单父继承区 / 删除标签）。
 *
 * 边界与归属：
 * - 打标入口不在此页 —— 建实体 ≠ 打标，打标仍唯一走 content `#名`（ADR-0049 D6）。
 * - 「新建标签」= 标题 + 可选父标签；「+ 添加字段」= 建字段定义 + 追加该标签自身字段。
 * - 成员口径：管理页用**直系数**（ADR-0050 D10 #3）；含后代的聚合口径只在 tag 聚合页用。
 * - 字段数口径：**有效字段数**（含继承，即该标签下真正可填的字段数量）。
 * - 继承解析（有效字段集合）单源在 Rust，本页只消费 store 的解析结果。
 * - **系统标签右栏只读**：字段 / 继承 / 删除一律不给可点入口 —— Rust 侧
 *   `reject_system_tag` 已拒，UI 若照给按钮就是静默失败（点了没反应且无提示）。
 * - 字段定义是全局共享的，故只有**自身声明**的字段可在此编辑（继承方无权改他人定义）。
 * - 进聚合页的入口在本页右栏标题行（`/tags/:tagId`）。
 */
import { computed, onMounted, ref } from 'vue'
import { Plus, Search, X } from 'lucide-vue-next'
import type { PersistedFieldDefinition, PersistedTag } from '../../types/tag-persisted'
import { useBlockCardStore } from '../../stores/blockCard'
import { useTagsStore } from '../../stores/tags'
import { useNavigateToTag } from '../../composables/useNavigateToTag'
import BasePopover from '../common/BasePopover.vue'
import ConfirmDialog from '../ConfirmDialog.vue'
import PageTitle from '../common/PageTitle.vue'

const tagsStore = useTagsStore()
const blockCardStore = useBlockCardStore()
const { navigateToTag } = useNavigateToTag()

type FilterMode = 'all' | 'recent' | 'unused'

const searchQuery = ref('')
const filterMode = ref<FilterMode>('all')
const selectedTagId = ref<string | null>(null)

onMounted(async () => {
  await Promise.all([tagsStore.ensureLoaded(), blockCardStore.getCards()])
  if (!selectedTagId.value && tagsStore.allTags.length) {
    selectedTagId.value = sortedByMembers(tagsStore.allTags)[0].id
  }
})

// ── 左栏：统计与列表 ──────────────────────────────────────────

const statsSubtitle = computed(() => {
  const all = tagsStore.allTags
  const withParent = all.filter((t) => !!t.parent_id).length
  const members = all.reduce((sum, t) => sum + tagsStore.memberSummary(t.id).count, 0)
  return `${all.length} 个标签 · ${withParent} 个带父标签 · ${members} 个成员`
})

const filterChips = computed<Array<{ key: FilterMode; label: string; count: number | null }>>(
  () => [
    { key: 'all', label: '全部', count: tagsStore.allTags.length },
    { key: 'recent', label: '最近使用', count: null },
    { key: 'unused', label: '未使用', count: tagsStore.unusedTags().length },
  ],
)

function memberCount(tagId: string): number {
  return tagsStore.memberSummary(tagId).count
}

/** 有效字段数（含继承）——即该标签下真正可填的字段数量。 */
function fieldCount(tagId: string): number {
  return tagsStore.effectiveFieldIds(tagId).length
}

/** 按直系成员数降序，同数按标题——常用标签浮在上面。 */
function sortedByMembers(list: PersistedTag[]): PersistedTag[] {
  return [...list].sort(
    (a, b) => memberCount(b.id) - memberCount(a.id) || a.title.localeCompare(b.title),
  )
}

const filteredTags = computed<PersistedTag[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const base =
    filterMode.value === 'recent'
      ? tagsStore.recentTags()
      : filterMode.value === 'unused'
        ? tagsStore.unusedTags()
        : tagsStore.allTags
  const list = q ? base.filter((t) => t.title.toLowerCase().includes(q)) : [...base]
  // 「最近使用」按成员块 recent 序（store 已排）；其余按成员数降序
  return filterMode.value === 'recent' ? list : sortedByMembers(list)
})

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

/** 系统标签（内置定义）→ 右栏全部写入口收起，只留只读呈现。 */
const isSystemTag = computed(() => !!selectedTag.value?.is_system)

/** 进该标签的聚合页（D7）。 */
function openAggregatePage() {
  if (!selectedTag.value) return
  navigateToTag(selectedTag.value.id).catch((err) => {
    console.error('打开标签聚合页失败:', err)
  })
}

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

/** 字段类型显示名（`select` 是由 closed_values 派生的伪类型）。 */
const TYPE_LABELS: Record<string, string> = {
  string: '文本',
  number: '数值',
  date: '日期',
  boolean: '是/否',
  page: '页面引用',
  array: '列表',
  select: '下拉选择',
}

/** 类型点选顺序（新建与编辑共用；`select` 落库为 type string + closed_values）。 */
const FIELD_TYPE_VALUES = ['string', 'number', 'date', 'select']

const FIELD_TYPE_OPTIONS = FIELD_TYPE_VALUES.map((value) => ({ value, label: TYPE_LABELS[value] }))

/**
 * 编辑面板的类型候选：当前类型若不在点选表内（历史遗留类型，如布尔/页面引用），
 * 把它补成一项 —— 否则原生 select 会回退显示首个选项，看着像「类型被改了」。
 */
const editFieldTypeOptions = computed(() =>
  FIELD_TYPE_VALUES.includes(editFieldType.value)
    ? FIELD_TYPE_OPTIONS
    : [{ value: editFieldType.value, label: TYPE_LABELS[editFieldType.value] ?? editFieldType.value }, ...FIELD_TYPE_OPTIONS],
)

function typeLabel(def: PersistedFieldDefinition): string {
  return TYPE_LABELS[def.closed_values?.length ? 'select' : def.type] ?? def.type
}

/** 该字段是否由本标签自己声明（决定能否从本标签移除 / 编辑其定义）。 */
function isOwnField(origin: PersistedTag | undefined): boolean {
  return !!origin && !!selectedTag.value && origin.id === selectedTag.value.id
}

/** 可编辑 = 自身声明 + 非系统标签（继承字段的定义归祖先，改它等于改所有引用方）。 */
function canEditField(origin: PersistedTag | undefined): boolean {
  return isOwnField(origin) && !isSystemTag.value
}

const parentTag = computed(() =>
  selectedTag.value ? tagsStore.parentTagOf(selectedTag.value.id) : undefined,
)

const parentCandidates = computed(() =>
  selectedTag.value ? tagsStore.parentCandidates(selectedTag.value.id) : [],
)

/** 单父槽位：已有父时按钮语义是「换掉它」，措辞须随之改（否则像是要再加一个父）。 */
const parentActionLabel = computed(() => (parentTag.value ? '更换父标签' : '+ 添加父标签'))

async function onPickParent(parentId: string) {
  if (!selectedTag.value || !parentId) return
  await tagsStore.setParent(selectedTag.value.id, parentId)
  parentPickerOpen.value = false
}

async function onClearParent() {
  if (!selectedTag.value) return
  await tagsStore.setParent(selectedTag.value.id, null)
}

async function onRemoveField(fieldDefinitionId: string) {
  if (!selectedTag.value) return
  await tagsStore.removeFieldFromTag(selectedTag.value.id, fieldDefinitionId)
}

// ── 字段模板：编辑单个字段（标题 / 类型 / 候选值） ──────────────

const fieldEditorOpen = ref(false)
const fieldEditorAnchor = ref<HTMLElement | null>(null)
const fieldEditorPos = ref({ x: 0, y: 0 })
const editingFieldId = ref<string | null>(null)
const editFieldTitle = ref('')
const editFieldType = ref('string')
const editFieldOptions = ref('')

function openFieldEditor(e: Event, def: PersistedFieldDefinition) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  fieldEditorAnchor.value = el
  fieldEditorPos.value = { x: rect.left, y: rect.bottom + 4 }
  editingFieldId.value = def.id
  editFieldTitle.value = def.title
  editFieldType.value = def.closed_values?.length ? 'select' : def.type
  editFieldOptions.value = def.closed_values?.join(', ') ?? ''
  fieldEditorOpen.value = true
}

/** 候选值文本 → 数组（空文本 → null，即非选项型）。 */
function parseOptions(raw: string): string[] | null {
  const values = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return values.length ? values : null
}

async function submitFieldEdit() {
  const id = editingFieldId.value
  const title = editFieldTitle.value.trim()
  if (!id || !title) return
  const isSelect = editFieldType.value === 'select'
  await tagsStore.updateFieldDefinition({
    id,
    title,
    type: isSelect ? 'string' : editFieldType.value,
    // 非选项型也显式传 null：把「下拉选择 → 文本/数值」的降级写实（清掉候选值）。
    closed_values: isSelect ? parseOptions(editFieldOptions.value) : null,
  })
  fieldEditorOpen.value = false
}

// ── 继承区：父标签选择弹层（BasePopover） ──────────────────────

const parentPickerOpen = ref(false)
const parentPickerAnchor = ref<HTMLElement | null>(null)
const parentPickerPos = ref({ x: 0, y: 0 })

function openParentPicker(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  parentPickerAnchor.value = el
  parentPickerPos.value = { x: rect.left, y: rect.bottom + 4 }
  parentPickerOpen.value = true
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
  const rest = sortedByMembers(tagsStore.allTags)
  selectedTagId.value = rest[0]?.id ?? null
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
  await tagsStore.addFieldToTag(selectedTag.value.id, {
    title,
    type: isSelect ? 'string' : newFieldType.value,
    closed_values: isSelect ? parseOptions(newFieldOptions.value) : null,
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
        <label class="tag-search">
          <Search
            class="tag-search-icon"
            :size="14"
          />
          <input
            v-model="searchQuery"
            class="tag-search-input"
            type="text"
            placeholder="搜索标签"
          >
        </label>
        <button
          class="tag-create-btn"
          type="button"
          @click="openCreatePopover"
        >
          <Plus :size="14" />
          新建标签
        </button>
      </template>
    </PageTitle>

    <div class="tags-body">
      <!-- 左栏：筛选胶囊 + 行列表 -->
      <aside class="tag-list">
        <div class="tag-filter-chips">
          <button
            v-for="chip in filterChips"
            :key="chip.key"
            type="button"
            class="tag-filter-chip"
            :class="{ 'tag-filter-chip--active': filterMode === chip.key }"
            @click="filterMode = chip.key"
          >
            {{ chip.label }}
            <span
              v-if="chip.count !== null"
              class="tag-filter-count"
            >{{ chip.count }}</span>
          </button>
        </div>

        <div class="tag-rows">
          <div
            v-for="tag in filteredTags"
            :key="tag.id"
            class="tag-row"
            :class="[`tag-row--${tag.id}`, { 'tag-row--active': selectedTagId === tag.id }]"
            role="button"
            tabindex="0"
            @click="selectedTagId = tag.id"
            @keydown.enter="selectedTagId = tag.id"
          >
            <span class="tag-row-label">
              <span class="tag-row-title">#{{ tag.title }}</span>
              <span
                v-if="tag.is_system"
                class="tag-row-system"
              >系统</span>
            </span>
            <span class="tag-row-meta tag-row-members">{{ memberCount(tag.id) }} 个成员</span>
            <span class="tag-row-meta">{{ fieldCount(tag.id) }} 个字段</span>
            <span
              class="tag-row-source"
              :class="{ 'tag-row-source--inherited': !!tag.parent_id }"
            >{{ sourceLabel(tag) }}</span>
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
          <div class="tag-detail-head">
            <h2 class="tag-detail-title">
              #{{ selectedTag.title }}
            </h2>
            <button
              type="button"
              class="tag-detail-open"
              @click="openAggregatePage"
            >
              查看成员 →
            </button>
          </div>
          <p class="tag-detail-meta">
            {{ detailSummary.count }} 个成员 · 来自 {{ detailSummary.pageCount }} 个页面
          </p>
          <p
            v-if="isSystemTag"
            class="tag-system-note"
          >
            系统标签为内置定义：字段与继承均不可编辑
          </p>

          <h3 class="tag-section-title">
            字段模板
          </h3>
          <div class="tag-fields">
            <div
              v-for="row in detailFields"
              :key="row.def.id"
              class="tag-field-row"
              :class="{ 'tag-field-row--editable': canEditField(row.origin) }"
              :role="canEditField(row.origin) ? 'button' : undefined"
              :tabindex="canEditField(row.origin) ? 0 : undefined"
              @click="canEditField(row.origin) && openFieldEditor($event, row.def)"
              @keydown.enter="canEditField(row.origin) && openFieldEditor($event, row.def)"
            >
              <span class="tag-field-name">{{ row.def.title }} · {{ typeLabel(row.def) }}</span>
              <span class="tag-field-actions">
                <button
                  v-if="canEditField(row.origin)"
                  type="button"
                  class="tag-field-remove"
                  @click.stop="onRemoveField(row.def.id)"
                >
                  移除
                </button>
                <span
                  v-if="isOwnField(row.origin)"
                  class="tag-field-badge"
                >自身</span>
                <span
                  v-else
                  class="tag-field-badge tag-field-badge--inherited"
                >继承 ← {{ row.origin?.title }}</span>
              </span>
            </div>
            <p
              v-if="!detailFields.length"
              class="tag-fields-empty"
            >
              该标签还没有字段
            </p>
          </div>
          <button
            v-if="!isSystemTag"
            class="tag-add-field"
            type="button"
            @click="openAddFieldPopover"
          >
            + 添加字段
          </button>

          <h3 class="tag-section-title tag-section-title--inherit">
            继承
          </h3>
          <div
            v-if="parentTag"
            class="tag-parent-card"
          >
            <span class="tag-parent-chip">#{{ parentTag.title }}</span>
            <button
              v-if="!isSystemTag"
              type="button"
              class="tag-parent-clear"
              aria-label="清除父标签"
              @click="onClearParent"
            >
              <X :size="12" />
            </button>
          </div>
          <p
            v-else
            class="tag-parent-none"
          >
            顶级标签
          </p>
          <button
            v-if="!isSystemTag"
            class="tag-parent-add"
            type="button"
            @click="openParentPicker"
          >
            {{ parentActionLabel }}
          </button>
          <p class="tag-inherit-note">
            继承字段不写入成员；同名字段以「自身 &gt; 直接父 &gt; 更远祖先」生效，成环请求会被拒绝。
          </p>

          <button
            v-if="!isSystemTag"
            type="button"
            class="tag-delete"
            @click="onDeleteTag"
          >
            删除标签…
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
            v-for="tag in tagsStore.allTags"
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

    <!-- 继承区：挑父标签（单父槽位，选中即替换） -->
    <BasePopover
      :visible="parentPickerOpen"
      :position="parentPickerPos"
      :anchor-el="parentPickerAnchor"
      @close="parentPickerOpen = false"
    >
      <div class="tag-parent-panel">
        <p
          v-if="!parentCandidates.length"
          class="tag-parent-empty"
        >
          没有可选父标签
        </p>
        <button
          v-for="candidate in parentCandidates"
          :key="candidate.id"
          type="button"
          class="tag-parent-option"
          @click="onPickParent(candidate.id)"
        >
          {{ candidate.title }}
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
          <option
            v-for="opt in FIELD_TYPE_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
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

    <!-- 编辑字段（只对自身声明的字段开放；继承字段的定义归祖先） -->
    <BasePopover
      :visible="fieldEditorOpen"
      :position="fieldEditorPos"
      :anchor-el="fieldEditorAnchor"
      @close="fieldEditorOpen = false"
    >
      <div class="tag-field-panel">
        <input
          v-model="editFieldTitle"
          class="tag-field-edit-title"
          type="text"
          placeholder="字段标题"
        >
        <select
          v-model="editFieldType"
          class="tag-field-edit-type"
        >
          <option
            v-for="opt in editFieldTypeOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
        <input
          v-if="editFieldType === 'select'"
          v-model="editFieldOptions"
          class="tag-field-edit-options"
          type="text"
          placeholder="候选值，逗号分隔"
        >
        <button
          type="button"
          class="tag-field-confirm"
          @click="submitFieldEdit"
        >
          保存
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
  padding: 0 var(--space-8) var(--space-7);
}

.tags-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--space-4);
  margin-top: var(--space-5);
}

/* ── 顶栏：搜索 / 新建 ── */
.tag-search {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  width: 200px;
  height: 34px;
  padding: 0 var(--space-2);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.tag-search-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.tag-search-input {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: transparent;
  border: none;
  outline: none;

  &::placeholder {
    color: var(--text-tertiary);
  }
}

.tag-create-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 34px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-white);
  background: var(--accent);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;

  &:hover {
    background: var(--accent-hover);
  }
}

/* ── 左栏 ── */
.tag-list {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.tag-filter-chips {
  display: flex;
  gap: var(--space-2);
}

.tag-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 28px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  background: var(--surface-subtle);
  border: none;
  border-radius: 999px;
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
  }

  &--active {
    color: var(--accent-hover);
    background: var(--accent-subtle);
  }
}

.tag-filter-count {
  font-variant-numeric: tabular-nums;
}

.tag-rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tag-row {
  display: grid;
  // 标题胶囊自适应 + 成员数 / 字段数两列定宽 + 来源列吃余量
  grid-template-columns: auto 102px 102px 1fr;
  column-gap: var(--space-3);
  align-items: center;
  min-height: 52px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  background: var(--surface-muted);
  border-radius: var(--radius-md);
  cursor: pointer;

  &:not(.tag-row--active):hover {
    background: var(--bg-hover);
  }
}

.tag-row-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.tag-row-title {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 var(--space-2);
  color: var(--text-primary);
  white-space: nowrap;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.tag-row-system,
.tag-row-source {
  color: var(--text-tertiary);
  white-space: nowrap;
}

.tag-row-meta {
  color: var(--text-secondary);
  white-space: nowrap;
}

.tag-row-source {
  overflow: hidden;
  text-overflow: ellipsis;

  &--inherited {
    color: var(--accent);
  }
}

.tag-row--active {
  background: var(--accent-subtle);

  .tag-row-title {
    color: var(--accent-hover);
    border-color: var(--accent-40);
  }

  .tag-row-members {
    color: var(--accent-hover);
  }
}

.tag-list-empty,
.tag-fields-empty,
.tag-detail-empty,
.tag-parent-empty {
  padding: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

/* ── 右栏 ── */
.tag-detail {
  flex-shrink: 0;
  width: 340px;
  overflow: auto;
  padding: var(--space-5);
  background: var(--surface-muted);
  border: 1px solid var(--border);
}

.tag-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.tag-detail-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--text-primary);
}

/* 进聚合页（D7）的唯一入口 */
.tag-detail-open {
  flex-shrink: 0;
  padding: 0;
  font-size: var(--text-xs);
  color: var(--accent);
  background: transparent;
  border: none;
  cursor: pointer;

  &:hover {
    color: var(--accent-hover);
  }
}

.tag-detail-meta {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.tag-system-note {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.tag-section-title {
  margin: var(--space-2) 0;
  font-size: var(--text-xs);
  font-weight: var(--font-normal);
  color: var(--text-tertiary);

  &--inherit {
    margin-top: var(--space-6);
  }
}

.tag-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.tag-field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 36px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);

  /* 只有自身声明的字段可点开编辑（继承字段 / 系统标签仍是静态行） */
  &--editable {
    cursor: pointer;

    &:hover {
      border-color: var(--accent-40);
    }
  }
}

.tag-field-name {
  color: var(--text-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tag-field-actions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-2);
}

.tag-field-badge {
  font-size: var(--text-xs);
  color: var(--text-tertiary);

  &--inherited {
    color: var(--accent);
  }
}

/* 静态帧里不出现「移除」——悬停该行才露出，避免每行都挂一个破坏性按钮 */
.tag-field-remove {
  visibility: hidden;
  padding: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;

  &:hover {
    color: var(--error);
  }
}

.tag-field-row:hover .tag-field-remove {
  visibility: visible;
}

.tag-add-field,
.tag-parent-add {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-3);
  padding: 0;
  font-size: var(--text-xs);
  color: var(--accent);
  background: transparent;
  border: none;
  cursor: pointer;

  &:hover {
    color: var(--accent-hover);
  }
}

.tag-parent-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 36px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.tag-parent-chip {
  color: var(--text-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tag-parent-clear {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
}

.tag-parent-none {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.tag-inherit-note {
  margin: var(--space-3) 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--text-tertiary);
}

.tag-delete {
  margin-top: var(--space-6);
  padding: 0;
  font-size: var(--text-sm);
  color: var(--error);
  background: transparent;
  border: none;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

/* ── 弹层 ── */
.tag-create-panel,
.tag-field-panel,
.tag-parent-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 240px;
}

.tag-parent-panel {
  width: 180px;
  max-height: 260px;
  overflow: auto;
}

.tag-parent-option {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  text-align: left;
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
  }
}

.tag-create-title,
.tag-create-parent,
.tag-field-title-input,
.tag-field-type-select,
.tag-field-options,
.tag-field-edit-title,
.tag-field-edit-type,
.tag-field-edit-options {
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-2);
}

.tag-create-confirm,
.tag-field-confirm {
  height: 28px;
  font-size: var(--text-xs);
  color: var(--color-white);
  background: var(--accent);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;

  &:hover {
    background: var(--accent-hover);
  }
}
</style>
