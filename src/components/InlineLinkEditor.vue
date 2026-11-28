<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

import { extractHttpUrl, linkTitleRejectionHint } from '../utils/inline-link'

/**
 * 「添加链接」输入面板（形如 `[标题](url)` 的两段）。
 *
 * 与 `InlineColorPalette` 同一个位置：塞进宿主的 `FloatingSubmenu`，只管「画两行输入 +
 * 报结果」，定位 / 层级 / Esc 收口全在宿主。形态沿用 `WebLinkToolbar` 的编辑链接
 * （同一个操作，两处观感不该不一样）。
 *
 * `mousedown.stop`：`FloatingSubmenu` 根上有 `mousedown.prevent`（防编辑器失焦），
 * 对 input 是致命的 —— preventDefault 会挡掉聚焦与选字。本面板自带真实输入框，
 * 必须把这层拦在门外，让点击照常落进输入框。
 */
const props = defineProps<{
  /** 预填标题（选区文字） */
  title?: string
  /** 预填 URL（剪贴板里已是 http(s) 链接时） */
  url?: string
}>()

const emit = defineEmits<{
  (e: 'apply', title: string, url: string): void
}>()

const titleInput = ref(props.title ?? '')
const urlInput = ref(props.url ?? '')
const urlEl = ref<HTMLInputElement | null>(null)

const titleError = computed(() => linkTitleRejectionHint(titleInput.value))
/** 归一后的 URL：缺协议补 https://，非 http(s) 为 null */
const normalizedUrl = computed(() => extractHttpUrl(urlInput.value))
const urlError = computed(() => {
  if (!urlInput.value.trim()) return ''
  return normalizedUrl.value ? '' : '不是可用的网址，只支持 http / https'
})
const canApply = computed(() => !titleError.value && !!normalizedUrl.value)

function apply() {
  const url = normalizedUrl.value
  if (!canApply.value || !url) return
  emit('apply', titleInput.value.trim(), url)
}

onMounted(async () => {
  await nextTick()
  urlEl.value?.focus()
  urlEl.value?.select()
})
</script>

<template>
  <div
    class="inline-link-editor"
    @mousedown.stop
  >
    <label class="inline-link-row">
      <span class="inline-link-label">文字</span>
      <input
        v-model="titleInput"
        class="inline-link-input"
        placeholder="链接文字"
        @keydown.enter.prevent="urlEl?.focus()"
      >
    </label>
    <label class="inline-link-row">
      <span class="inline-link-label">链接</span>
      <input
        ref="urlEl"
        v-model="urlInput"
        class="inline-link-input"
        placeholder="https://…"
        @keydown.enter.prevent.stop="apply"
      >
    </label>
    <!-- 错误只出一条：标题不合法时优先说标题（URL 为空不算错，用户还没填） -->
    <div
      v-if="titleError || urlError"
      class="inline-link-hint"
    >
      {{ titleError || urlError }}
    </div>
    <button
      type="button"
      class="inline-link-apply"
      :disabled="!canApply"
      @click="apply"
    >
      添加链接
    </button>
  </div>
</template>

<style scoped>
.inline-link-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 252px;
  padding: 8px;
}

.inline-link-row {
  display: grid;
  grid-template-columns: 32px 1fr;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.inline-link-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
  outline: none;
}

.inline-link-input:focus {
  border-color: var(--accent);
}

.inline-link-hint {
  color: var(--error);
  font-size: var(--text-xs);
  line-height: 1.4;
}

.inline-link-apply {
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--color-white);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.inline-link-apply:disabled {
  background: var(--bg-hover);
  color: var(--text-tertiary);
  cursor: default;
}
</style>
