<script setup lang="ts">
/**
 * 跨记录字段引用选择器 —— 在 ValueEditor 的「引用值 / 其他记录」面板中使用的子组件。
 *
 * 两步选择：① 在候选记录列表中按标题搜索并选中一个目标记录；② 列出该记录上**与当前条件同类型**的字段，
 * 点选即确定引用。每个候选记录自带 `fields`（由注入方预取），本组件不查询任何业务注册表。
 * 本组件只负责「选记录 + 选字段」的交互，不涉及求值。
 */
import { computed, ref } from 'vue'
import { ArrowLeft, Search } from 'lucide-vue-next'
import type { FieldDescriptor, FieldType, ReferenceableRecord } from '../../core/query'

const props = defineProps<{
  /** 候选记录列表（已含各自 fields）。业务无关。 */
  sources: ReferenceableRecord[]
  /** 当前条件字段类型，用于过滤每个记录上同类型的候选字段。 */
  descriptorType: FieldType
}>()

const emit = defineEmits<{
  /** 确认选择：目标 recordId + entityType + 字段 key。 */
  select: [recordId: string, entityType: string, field: string]
  /** 取消 / 关闭面板。 */
  cancel: []
}>()

const query = ref('')
const selectedSourceId = ref<string | null>(null)

const filteredSources = computed(() =>
  props.sources.filter((s) => s.title.toLowerCase().includes(query.value.trim().toLowerCase())),
)

const selectedSource = computed(() => props.sources.find((s) => s.id === selectedSourceId.value) ?? null)

// 该记录上与当前条件同类型的字段（注入方已带来，无需查注册表）
const availableFields = computed<FieldDescriptor[]>(() => {
  if (!selectedSource.value) return []
  return selectedSource.value.fields.filter((f) => f.type === props.descriptorType)
})

function chooseSource(id: string) {
  selectedSourceId.value = id
}
function back() {
  selectedSourceId.value = null
}
function pickField(field: FieldDescriptor) {
  const src = selectedSource.value
  if (!src) return
  emit('select', src.id, src.entityType, field.key)
}
</script>

<template>
  <div class="pf-picker">
    <template v-if="!selectedSource">
      <div class="pf-search">
        <Search :size="13" />
        <input v-model="query" type="text" placeholder="搜索记录标题…" />
      </div>
      <div class="pf-source-list">
        <button
          v-for="s in filteredSources"
          :key="s.id"
          type="button"
          class="pf-source"
          @click="chooseSource(s.id)"
        >
          {{ s.title || '(无标题)' }}
        </button>
        <p v-if="filteredSources.length === 0" class="pf-empty">无匹配记录</p>
      </div>
    </template>

    <template v-else>
      <div class="pf-source-head">
        <button type="button" class="qb-icon" title="返回" @click="back">
          <ArrowLeft :size="14" />
        </button>
        <span class="pf-source-title">{{ selectedSource.title || '(无标题)' }}</span>
      </div>
      <div class="pf-field-list">
        <button
          v-for="f in availableFields"
          :key="f.key"
          type="button"
          class="pf-field"
          @click="pickField(f)"
        >
          {{ f.label }}
        </button>
        <p v-if="availableFields.length === 0" class="pf-empty">无同类型字段可引用</p>
      </div>
    </template>

    <button type="button" class="pf-cancel" @click="emit('cancel')">取消</button>
  </div>
</template>

<style lang="scss" scoped>
.pf-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 240px;
  max-height: 280px;
}

.pf-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-base);
  color: var(--text-tertiary, #999);

  input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    outline: none;
    color: var(--text-primary);
    font-size: var(--text-sm, 13px);
  }
}

.pf-source-list,
.pf-field-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  max-height: 180px;
}

.pf-source,
.pf-field {
  text-align: left;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm, 13px);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
    border-color: var(--border);
  }
}

.pf-source-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pf-source-title {
  font-size: var(--text-sm, 13px);
  color: var(--text-secondary, #444);
  font-weight: var(--font-semibold, 600);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pf-empty {
  margin: 4px 0;
  font-size: var(--text-xs, 12px);
  color: var(--text-tertiary, #999);
}

.pf-cancel {
  align-self: flex-end;
  padding: 2px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary, #999);
  font-size: var(--text-xs, 12px);
  cursor: pointer;

  &:hover {
    color: var(--text-secondary, #444);
  }
}

.qb-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary, #999);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
    color: var(--text-secondary, #444);
  }
}
</style>
