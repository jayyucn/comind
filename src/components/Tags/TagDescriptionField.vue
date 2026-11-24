<script setup lang="ts">
/**
 * 标签描述字段（ADR-0050 D11 身份三要素之二）：展示 + 就地编辑。
 *
 * 两处挂载（标签管理页右栏详情 / 聚合页标题区），**同一份数据、同一组写入原语**（D12）——
 * 本组件不持有真相，落库由调用方经 `save` 交 store，避免出现第二份状态。
 *
 * 系统标签只读（D5「系统标签右栏只读」延伸至此）：Rust 侧 `reject_system_tag` 已拒写，
 * UI 若照给可点入口就是「点了没反应且无提示」的静默失败 —— 故只读时不渲染可点元素。
 */
import { nextTick, ref, watch } from 'vue';

const TAG_DESCRIPTION_PLACEHOLDER = '+ 添加描述'

const props = defineProps<{
  /** 当前描述；空串 = 未填写 */
  value: string
  /** 只读（系统标签） */
  readonly?: boolean
}>()

const emit = defineEmits<{ save: [value: string] }>()

const editing = ref(false)
const draft = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const canEdit = () => !props.readonly

async function startEdit() {
  if (!canEdit()) return
  draft.value = props.value
  editing.value = true
  await nextTick()
  inputEl.value?.focus()
}

/**
 * 提交草稿。`editing` 守卫用于吞掉 Enter → blur 的第二次触发（同一次编辑只落一次库）；
 * 值未变则不 emit，避免产生一次无意义的写与 store 重读。
 */
function commit() {
  if (!editing.value) return
  editing.value = false
  const next = draft.value.trim()
  if (next !== props.value) emit('save', next)
}

function cancel() {
  editing.value = false
}

// 外部值变化（落库后 store 整体重读）会打断编辑态，避免停在已过期的草稿上
watch(
  () => props.value,
  () => {
    if (editing.value) cancel()
  },
)
</script>

<template>
  <input
    v-if="editing"
    ref="inputEl"
    v-model="draft"
    class="tag-desc"
    type="text"
    :placeholder="TAG_DESCRIPTION_PLACEHOLDER"
    @keydown.enter.prevent="commit"
    @keydown.esc.prevent="cancel"
    @blur="commit"
  >
  <button
    v-else-if="canEdit()"
    type="button"
    class="tag-desc tag-desc--button"
    :class="{ 'tag-desc--empty': !value }"
    @click="startEdit"
  >
    {{ value || TAG_DESCRIPTION_PLACEHOLDER }}
  </button>
  <span
    v-else-if="value"
    class="tag-desc tag-desc--readonly"
  >{{ value }}</span>
</template>

<style lang="scss" scoped>
.tag-desc {
  display: block;
  max-width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  text-align: left;
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.tag-desc--empty {
  color: var(--text-tertiary);
}

.tag-desc--button {
  cursor: pointer;
}

.tag-desc--button:hover {
  color: var(--text-primary);
}

.tag-desc--readonly {
  cursor: default;
}

input.tag-desc {
  width: 100%;
  padding: var(--space-1) var(--space-1);
  background: var(--bg-base);
  color: var(--text-primary);
}

input.tag-desc:focus {
  border-color: var(--accent);
  outline: none;
}
</style>
