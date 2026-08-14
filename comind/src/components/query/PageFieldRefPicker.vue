<script setup lang="ts">
/**
 * 跨记录字段引用选择器 —— 在 ValueEditor 的「引用值 / 其他页面」面板中使用的子组件。
 *
 * 两步选择：① 在可选页面列表中按标题搜索并选中一个目标 Page；② 列出该 Page 上与当前条件
 * 同类型的字段，点选即确定引用。本组件只负责「选页 + 选字段」的交互，不涉及求值。
 */
import { computed, ref } from 'vue'
import { ArrowLeft, Search } from 'lucide-vue-next'
import type { FieldDescriptor } from '../../core/query'

const props = defineProps<{
  /** 可选页面列表（id + 标题），由消费方（如 PagesLibrary）从页面 store 注入。 */
  pages: { id: string; title: string }[]
  /** 与目标同类型的候选字段（已排除当前条件字段）。 */
  fields: FieldDescriptor[]
}>()

const emit = defineEmits<{
  /** 确认选择：目标 pageId + 字段 key。 */
  select: [pageId: string, field: string]
  /** 取消 / 关闭面板。 */
  cancel: []
}>()

const query = ref('')
const selectedPageId = ref<string | null>(null)

const filteredPages = computed(() =>
  props.pages.filter((p) => p.title.toLowerCase().includes(query.value.trim().toLowerCase())),
)

const selectedPage = computed(() => props.pages.find((p) => p.id === selectedPageId.value) ?? null)

function choosePage(id: string) {
  selectedPageId.value = id
}
function back() {
  selectedPageId.value = null
}
function pickField(key: string) {
  if (selectedPageId.value) emit('select', selectedPageId.value, key)
}
</script>

<template>
  <div class="pf-picker">
    <template v-if="!selectedPage">
      <div class="pf-search">
        <Search :size="13" />
        <input v-model="query" type="text" placeholder="搜索页面标题…" />
      </div>
      <div class="pf-page-list">
        <button
          v-for="p in filteredPages"
          :key="p.id"
          type="button"
          class="pf-page"
          @click="choosePage(p.id)"
        >
          {{ p.title || '(无标题)' }}
        </button>
        <p v-if="filteredPages.length === 0" class="pf-empty">无匹配页面</p>
      </div>
    </template>

    <template v-else>
      <div class="pf-page-head">
        <button type="button" class="qb-icon" title="返回" @click="back">
          <ArrowLeft :size="14" />
        </button>
        <span class="pf-page-title">{{ selectedPage.title || '(无标题)' }}</span>
      </div>
      <div class="pf-field-list">
        <button
          v-for="f in fields"
          :key="f.key"
          type="button"
          class="pf-field"
          @click="pickField(f.key)"
        >
          {{ f.label }}
        </button>
        <p v-if="fields.length === 0" class="pf-empty">无同类型字段可引用</p>
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

.pf-page-list,
.pf-field-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  max-height: 180px;
}

.pf-page,
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

.pf-page-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pf-page-title {
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
