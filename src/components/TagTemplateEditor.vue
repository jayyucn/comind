<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-vue-next'
import { VueDraggable } from 'vue-draggable-plus'
import { useTagStore } from '../composables/useTagStore'
import type { TagFieldSpec, TagFieldType } from '../composables/useTagStore'

/**
 * 标签字段模板编辑器（#131 / ADR-0049 D5、D7）—— 挂在 tag-page 正文顶部。
 *
 * 结构化面板，编辑 tag-page 的 `template` 属性（`TagFieldSpec[]`）：
 *  - 新增（key + 显示名 + 类型，key 唯一且不可改：它是值的存储键，改了会孤立既有值）
 *  - 删除 / 拖拽排序（VueDraggable，force-fallback 同 BlockList 约定）
 *  - 就地改 显示名 · 类型 · select/multiSelect 选项
 *
 * 每次变更即 `setTagTemplate` 落库（单一数据源）；**不**向成员 block 写任何字段
 * （派生不物化，D6）。默认折叠，避免标签页正文被编辑面板占满。
 */

const props = defineProps<{ tagPageId: string }>()

const tagStore = useTagStore()

const expanded = ref(false)
const fields = ref<TagFieldSpec[]>([])

const draftKey = ref('')
const draftLabel = ref('')
const draftType = ref<TagFieldType>('string')

/** 可选字段类型（PropertyType 子集 + 查询词汇 select/multiSelect） */
const TYPE_OPTIONS: { value: TagFieldType; label: string }[] = [
  { value: 'string', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'boolean', label: '复选框' },
  { value: 'select', label: '单选' },
  { value: 'multiSelect', label: '多选' },
]

async function load(): Promise<void> {
  fields.value = await tagStore.getTagTemplate(props.tagPageId)
}
onMounted(load)
watch(() => props.tagPageId, load)

async function persist(): Promise<void> {
  await tagStore.setTagTemplate(props.tagPageId, fields.value)
}

const draftKeyTrimmed = computed(() => draftKey.value.trim())
const canAdd = computed(
  () => draftKeyTrimmed.value.length > 0 && !fields.value.some(f => f.key === draftKeyTrimmed.value),
)

async function addField(): Promise<void> {
  const key = draftKeyTrimmed.value
  if (!key || fields.value.some(f => f.key === key)) return
  fields.value = [...fields.value, { key, label: draftLabel.value.trim() || key, type: draftType.value }]
  draftKey.value = ''
  draftLabel.value = ''
  draftType.value = 'string'
  await persist()
}

async function removeField(key: string): Promise<void> {
  fields.value = fields.value.filter(f => f.key !== key)
  await persist()
}

/** select/multiSelect 的选项以逗号串编辑（id 即存储值，与 label 同值） */
function optionsText(f: TagFieldSpec): string {
  return (f.options ?? []).map(o => o.label).join(', ')
}

async function setOptions(f: TagFieldSpec, raw: string): Promise<void> {
  const options = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => ({ id: s, label: s }))
  if (options.length) f.options = options
  else delete f.options
  await persist()
}

async function setType(f: TagFieldSpec, type: TagFieldType): Promise<void> {
  f.type = type
  // 退出选项类类型时清掉残留选项，避免模板里留下不可见的死数据
  if (type !== 'select' && type !== 'multiSelect') delete f.options
  await persist()
}

async function setLabel(f: TagFieldSpec, label: string): Promise<void> {
  f.label = label.trim() || f.key
  await persist()
}

async function onDragEnd(): Promise<void> {
  await persist()
}

// 测试接缝：等价于 VueDraggable 真实拖拽结束（同 FieldManagerPanel 约定）
function __test_setOrder(keys: string[]): void {
  const map = new Map(fields.value.map(f => [f.key, f]))
  fields.value = keys.map(k => map.get(k)).filter((f): f is TagFieldSpec => !!f)
}
defineExpose({ onDragEnd, __test_setOrder })
</script>

<template>
  <section class="tag-template-editor">
    <button
      class="tte-header"
      data-testid="tte-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <component
        :is="expanded ? ChevronDown : ChevronRight"
        :size="14"
        class="tte-caret"
      />
      <span class="tte-title">字段模板</span>
      <span
        v-if="!expanded && fields.length > 0"
        class="tte-count"
      >{{ fields.length }} 个字段</span>
    </button>

    <div
      v-if="expanded"
      class="tte-body"
    >
      <VueDraggable
        v-model="fields"
        tag="ul"
        class="tte-list"
        handle=".tte-grip"
        :force-fallback="true"
        ghost-class="tte-ghost"
        @end="onDragEnd"
      >
        <li
          v-for="f in fields"
          :key="f.key"
          class="tte-row"
          data-testid="tte-row"
        >
          <span
            class="tte-grip"
            title="拖拽排序"
          ><GripVertical :size="14" /></span>
          <div class="tte-main">
            <div class="tte-line">
              <code
                class="tte-key"
                :title="f.key"
              >{{ f.key }}</code>
              <input
                class="tte-input tte-label"
                data-testid="tte-label"
                :value="f.label"
                placeholder="显示名"
                @change="setLabel(f, ($event.target as HTMLInputElement).value)"
              >
              <select
                class="tte-select"
                data-testid="tte-type"
                :value="f.type"
                @change="setType(f, ($event.target as HTMLSelectElement).value as TagFieldType)"
              >
                <option
                  v-for="t in TYPE_OPTIONS"
                  :key="t.value"
                  :value="t.value"
                >
                  {{ t.label }}
                </option>
              </select>
              <button
                class="tte-del"
                data-testid="tte-del"
                title="删除字段"
                @click="removeField(f.key)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
            <div
              v-if="f.type === 'select' || f.type === 'multiSelect'"
              class="tte-line"
            >
              <input
                class="tte-input tte-options"
                data-testid="tte-options"
                placeholder="选项（逗号分隔）"
                :value="optionsText(f)"
                @change="setOptions(f, ($event.target as HTMLInputElement).value)"
              >
            </div>
          </div>
        </li>
        <li
          v-if="fields.length === 0"
          class="tte-empty"
        >
          尚无字段
        </li>
      </VueDraggable>

      <div class="tte-add">
        <input
          v-model="draftKey"
          class="tte-input"
          data-testid="tte-new-key"
          placeholder="key"
          @keydown.enter.prevent="addField"
        >
        <input
          v-model="draftLabel"
          class="tte-input"
          data-testid="tte-new-label"
          placeholder="显示名"
          @keydown.enter.prevent="addField"
        >
        <select
          v-model="draftType"
          class="tte-select"
          data-testid="tte-new-type"
        >
          <option
            v-for="t in TYPE_OPTIONS"
            :key="t.value"
            :value="t.value"
          >
            {{ t.label }}
          </option>
        </select>
        <button
          class="tte-add-btn"
          data-testid="tte-add"
          title="添加字段"
          :disabled="!canAdd"
          @click="addField"
        >
          <Plus :size="14" />
        </button>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.tag-template-editor {
  margin: 0 0 var(--space-3, 12px);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-base2, var(--bg-base));
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.tte-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-family: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
  }
}

.tte-caret {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.tte-title {
  font-weight: var(--font-medium);
}

.tte-count {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.tte-body {
  padding: 0 10px 10px;
}

.tte-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tte-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);

  &:hover {
    background: var(--bg-hover);
  }
}

.tte-grip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  color: var(--text-tertiary);
  cursor: grab;
  flex-shrink: 0;

  &:active {
    cursor: grabbing;
  }
}

.tte-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.tte-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.tte-key {
  flex: 0 0 auto;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.tte-input,
.tte-select {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  outline: none;

  &:focus {
    border-color: var(--accent);
  }
}

.tte-label {
  flex: 1;
  min-width: 0;
}

.tte-options {
  flex: 1;
  min-width: 0;
}

.tte-select {
  flex: 0 0 auto;
}

.tte-del,
.tte-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}

.tte-del:hover {
  color: var(--error, #dc2626);
}

.tte-add-btn:hover:not(:disabled) {
  color: var(--accent);
}

.tte-add {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);

  .tte-input:first-child {
    flex: 0 0 96px;
  }

  .tte-input {
    flex: 1;
    min-width: 0;
  }
}

.tte-empty {
  padding: 4px 6px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.tte-ghost {
  opacity: 0.4;
  background: var(--bg-hover);
}
</style>
