<script setup lang="ts">
/**
 * 页面引用 picker（issue T3 AC2）—— page 类型字段值的专属录入控件。
 *
 * 交互（对齐 EnumSelect / DatePicker 的 common 家族约定）：
 * - 触发按钮显示当前目标页标题（page id 反查；悬空 id 降级显示原始 id）
 *   或空值占位符，点击弹出 BasePopover 浮层（锚点避让模式，ADR-0038）。
 * - 浮层内：搜索框（按标题子串过滤，大小写不敏感）+ 候选页面列表，点一次即回传。
 * - 页面清单来源：pages store（已加载页，排除已删）；打开时 ensurePagesLoaded 兜底。
 *
 * 复用接口（T10 person 字段复用同一形状）：
 * - props.modelValue: string | undefined —— 值为引用对象 id；undefined = 未填
 * - props.placeholder: string —— 空值占位符
 * - props.personOnly: boolean —— 候选限定 person 页（issue T10）：页面的主页块
 *   挂了 'person' 标签才算候选（判据单源 utils/person-page.isPersonPage，
 *   块 → 标签读取接 blocks store）；空态文案随之切「暂无可选人员」
 * - emit 'update:modelValue'（id | undefined）—— 不可变 update 事件，与 EnumSelect 同约定；
 *   落库（类型、删行语义）由调用方完成，本组件不碰 fieldValue store
 * - defineExpose({ openPanel, close, select }) 测试钩子（绕过 jsdom 合成事件）
 */
import { computed, nextTick, ref } from 'vue'
import BasePopover from './BasePopover.vue'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import { isPersonPage } from '../../utils/person-page'

const props = withDefaults(
  defineProps<{
    /** 当前值（目标页 id）；undefined / 空 = 未填。 */
    modelValue?: string
    /** 空值占位符（触发按钮）。 */
    placeholder?: string
    /** 候选限定 person 页（issue T10 负责人字段）。 */
    personOnly?: boolean
  }>(),
  { modelValue: undefined, placeholder: '选择页面', personOnly: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>()

const pageStore = usePageStore()
const blockStore = useBlockStore()

const open = ref(false)
const triggerEl = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const query = ref('')

/** 候选页面（排除已删；personOnly 时再限定 person 页——判据单源 isPersonPage）。 */
const pages = computed(() =>
  pageStore.pages.filter((p) => {
    if (p.deleted) return false
    if (props.personOnly && !isPersonPage(p, (blockId) => blockStore.getBlock(blockId)?.tags)) {
      return false
    }
    return true
  }),
)

/** 当前值展示：page id 反查标题；悬空 id（目标页不在 store）降级显示原始 id。 */
const currentTitle = computed(() => {
  if (!props.modelValue) return null
  return pageStore.getPage(props.modelValue)?.title ?? props.modelValue
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return pages.value
  return pages.value.filter((p) => p.title.toLowerCase().includes(q))
})

/** 空态文案：personOnly 语义下提示「无人员」而非「无页面」。 */
const emptyText = computed(() => (props.personOnly ? '暂无可选人员' : '无匹配页面'))

function openPanel() {
  open.value = true
  query.value = ''
  // 页面树未加载时补一次（幂等；失败静默——列表为空仅是候选缺失）
  void pageStore.ensurePagesLoaded()
  nextTick(() => searchInput.value?.focus())
}

function close() {
  open.value = false
}

function select(id: string) {
  emit('update:modelValue', id)
  close()
}

// 测试钩子：语义原子，绕过 jsdom 合成事件的不确定性（同 EnumSelect 约定）
defineExpose({ openPanel, close, select })
</script>

<template>
  <span class="page-ref-picker">
    <button
      ref="triggerEl"
      type="button"
      class="prp-trigger"
      :class="{ 'prp-placeholder': !currentTitle }"
      data-testid="prp-trigger"
      @click.stop="open ? close() : openPanel()"
    >
      <span class="prp-text">{{ currentTitle ?? placeholder }}</span>
    </button>

    <BasePopover
      :visible="open"
      :anchor-el="triggerEl"
      placement="bottom"
      @close="close"
    >
      <div class="prp-panel">
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          class="prp-search"
          data-testid="prp-search"
          placeholder="搜索页面"
        >
        <ul
          class="prp-list"
          data-testid="prp-option-list"
        >
          <li
            v-for="p in filtered"
            :key="p.id"
            class="prp-option"
            :class="{ selected: p.id === modelValue }"
            :data-page-id="p.id"
            @click.stop="select(p.id)"
          >
            <span class="prp-option-title">{{ p.title || '未命名页面' }}</span>
          </li>
          <li
            v-if="filtered.length === 0"
            class="prp-empty"
          >
            {{ emptyText }}
          </li>
        </ul>
      </div>
    </BasePopover>
  </span>
</template>

<style scoped>
/* 触发按钮：与 EnumSelect .es-trigger 同一 28px 基线 + 渐进披露语言 */
.page-ref-picker {
  display: inline-flex;
  min-width: 0;
}

.prp-trigger {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  box-sizing: border-box;
  padding: 4px 10px;
  border: none;
  outline: none;
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  transition: background var(--dur-base) var(--ease-out);
}

.prp-trigger:hover {
  background: var(--bg-hover);
}

.prp-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prp-trigger.prp-placeholder .prp-text {
  color: var(--text-tertiary);
}

/* 浮层面板：搜索框 + 候选列表 */
.prp-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 240px;
  padding: var(--space-2, 8px);
}

.prp-search {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-sm);
  box-sizing: border-box;
}

.prp-search:focus {
  outline: none;
  border-color: var(--accent);
}

.prp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
}

.prp-option {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--text-primary);
  transition: background var(--dur-fast) var(--ease-out);
}

.prp-option:hover,
.prp-option.selected {
  background: var(--surface-subtle);
}

.prp-empty {
  padding: 8px 10px;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}
</style>
