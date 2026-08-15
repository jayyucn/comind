<script setup lang="ts">
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { Search, ArrowUpDown, ListFilter, Layers, X } from 'lucide-vue-next'

defineOptions({ name: 'QueryToolbar' })

/**
 * 页面库顶栏的「查询工具条」展示壳：搜索（可收起开关）+ 筛选/排序/分组 三按钮。
 * 纯展示——不持有任何芯片编排逻辑（芯片行显隐/菜单由父组件经事件回调处理），
 * 故可复用于任意含「搜索 + 筛选/排序/分组」的视图。与 FilterBuilder / FilterChipBar 同目录，
 * 仅依赖通用 UI 令牌，不耦合任何实体业务。
 */
const props = defineProps<{
  /** 搜索关键词（v-model 受控，父组件持有真相）。 */
  modelValue: string
  /** 是否存在筛选条件（填色激活态）。 */
  hasFilter: boolean
  /** 是否存在排序键（填色激活态）。 */
  hasSort: boolean
  /** 是否已分组（填色激活态）。 */
  hasGroup: boolean
  /** 芯片行是否展开（筛选按钮的 collapsed 描边态依赖它）。 */
  chipBarVisible: boolean
}>()

const emit = defineEmits<{
  /** 搜索词变更，emit 完整新值（父级经 v-model 落库）。 */
  'update:modelValue': [value: string]
  /** 点筛选按钮——父级负责切换芯片行显隐。 */
  filter: []
  /** 点排序按钮，携带原生事件用于锚定菜单。 */
  sort: [e: MouseEvent]
  /** 点分组按钮，携带原生事件用于锚定菜单。 */
  group: [e: MouseEvent]
}>()

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

// 搜索框展开态：纯本地展示状态。收起不影响已输入的 searchQuery 值。
const searchOpen = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)
const searchRoot = ref<HTMLElement | null>(null)

function focusSearch() {
  nextTick(() => searchInputRef.value?.focus())
}

function toggleSearch() {
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) focusSearch()
}

// 清除搜索词（clearable）：emit 空值让父级清库，并重新聚焦输入框。
function clearSearch() {
  emit('update:modelValue', '')
  focusSearch()
}

// 点搜索区域外的任何内容都收起搜索框（含筛选/排序/分组、视图切换、页面等）；
// 但当搜索区已有输入内容时不收起，避免误关正在使用的搜索。
function onDocClick(e: MouseEvent) {
  if (
    searchOpen.value &&
    !props.modelValue &&
    searchRoot.value &&
    !searchRoot.value.contains(e.target as Node)
  ) {
    searchOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick, true))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true))
</script>

<template>
  <div class="query-toolbar">
    <!-- 筛选 / 排序 / 分组 三按钮 -->
    <button
      class="hdr-btn"
      :class="{ active: hasFilter, collapsed: hasFilter && !chipBarVisible }"
      title="筛选"
      @click="emit('filter')"
    >
      <ListFilter :size="15" />
    </button>
    <button
      class="hdr-btn"
      :class="{ active: hasSort }"
      title="排序"
      @click="emit('sort', $event)"
    >
      <ArrowUpDown :size="15" />
    </button>
    <button
      class="hdr-btn"
      :class="{ active: hasGroup }"
      title="分组"
      @click="emit('group', $event)"
    >
      <Layers :size="15" />
    </button>

    <!-- 搜索：图标按钮开关 + 可收起输入框（输入框在按钮右侧，从左向右展开）；点外部任何内容收起 -->
    <div class="search" ref="searchRoot" :class="{ open: searchOpen }">
      <button
        class="hdr-btn"
        title="搜索"
        :aria-expanded="searchOpen"
        @click="toggleSearch"
      >
        <Search :size="15" />
      </button>
      <div class="search-field">
        <input
          ref="searchInputRef"
          :value="modelValue"
          type="text"
          placeholder="搜索标题..."
          class="search-input"
          @input="onInput"
        />
      </div>
      <button
        v-if="searchOpen && modelValue"
        class="search-clear"
        title="清除"
        @click="clearSearch"
      >
        <X :size="14" />
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.query-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}


.search-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* 搜索：图标按钮开关 + 可收起输入框 */
.search {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 输入框包裹层：在按钮右侧从左向右展开（左端固定在按钮右侧，右端随宽度增长） */
.search-field {
  display: flex;
  justify-content: flex-start;
  width: 0;
  opacity: 0;
  overflow: hidden;
  transition: width 200ms ease, opacity 200ms ease;
}

.search.open .search-field {
  width: 200px;
  opacity: 1;
}

.search-input {
  width: 200px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  padding: 4px 4px;
  font-size: var(--text-sm);
  color: var(--text-primary);
  outline: none;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

/* 清除按钮（clearable）：无边框、随态变色，匹配极简风格 */
.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.search-clear:hover {
  color: var(--text-secondary);
}

/* 筛选 / 排序 / 分组 三按钮 */
.hdr-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 30px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 80ms ease, color 80ms ease, border-color 120ms ease;
}

.hdr-btn:hover {
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

/* 有筛选/排序/分组时的激活态（filled） */
.hdr-btn.active {
  color: var(--accent, #6366f1);
}

/* 有筛选但芯片行被收起（仅描边，提示「有筛选但隐藏」） */
.hdr-btn.collapsed {
  color: var(--accent, #6366f1);
  background: transparent;
}
</style>
