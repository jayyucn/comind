<script setup lang="ts">
/**
 * 块级 Tag 字段区（ADR-0050 D1「挂载即显示」）。
 *
 * - 只渲染**该块已挂标签的有效字段并集**（解析单源在 Rust：`effective_field_ids`）；
 *   多个标签携带同一字段定义时只出现一个编辑位（去重按字段定义 id）。
 * - 无值字段以空占位呈现，点击即打开既有快捷属性编辑器（不在此处新造编辑器）。
 * - 没有挂任何标签的块不渲染本区（不提供独立的属性入口）。
 * - **不重复列标签名** —— 标签名已由 content 内联 chip 呈现（`#foo`），此处再列一遍
 *   等于同物两渲染；且那处 chip 可点击导航（D7）而此处不会，行为不一致更糟。
 * - 字段模板（增删字段）不在块上改 —— 那是标签管理页的职责。
 *
 * 值读写仍走 property store（PropertyService 适配层）；数据层去属性化改名属阶段 3。
 */
import { computed, onMounted } from 'vue'
import type { PersistedFieldDefinition } from '../../types/tag-persisted'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'
import { useTagsStore } from '../../stores/tags'

const props = defineProps<{
  blockId: string
  /** 该块已挂的 tag id（来自 Block.tags 派生缓存）。 */
  tagIds: string[]
}>()

const tagsStore = useTagsStore()
const propertyStore = usePropertyStore()
const editorStore = useEditorStore()

onMounted(() => {
  // 幂等：标签树未加载时补一次（块可能在标签页未访问过的会话里直接渲染）
  void tagsStore.ensureLoaded()
})

/** 该块已挂标签（软删 / 悬空 id 由 store 静默过滤）。 */
const tags = computed(() => tagsStore.resolveTags(props.tagIds))

/** 有效字段并集（去重按字段定义 id，保持首次出现顺序）。 */
const fields = computed<PersistedFieldDefinition[]>(() => {
  const seen = new Set<string>()
  const out: PersistedFieldDefinition[] = []
  for (const tag of tags.value) {
    for (const def of tagsStore.effectiveFieldDefinitions(tag.id)) {
      if (seen.has(def.id)) continue
      seen.add(def.id)
      out.push(def)
    }
  }
  return out
})

/** 当前值文本（选项型取 label，数组拼接，其余原样）；无值 → null（渲染占位）。 */
function valueText(def: PersistedFieldDefinition): string | null {
  const prop = propertyStore.getBlockProperty(props.blockId, def.key)
  if (!prop || prop.value === null || prop.value === undefined || prop.value === '') return null
  const value = prop.value
  if (Array.isArray(value)) return value.length ? value.map(String).join('、') : null
  const closed = def.closed_values?.find((v) => String(v) === String(value))
  return closed ? String(closed) : String(value)
}

/** 点击 / Enter 唤起该字段的快速编辑器（锚点 = 行元素矩形）；参数取 Event 以兼容键盘触发。 */
function openEditor(event: Event, def: PersistedFieldDefinition) {
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  editorStore.showQuickPropertyEditor(props.blockId, def.key, {
    x: rect.left,
    y: rect.bottom + 4,
  })
}
</script>

<template>
  <div
    v-if="tags.length"
    class="block-tag-fields"
  >
    <div
      v-for="def in fields"
      :key="def.id"
      class="block-tag-field-row"
      role="button"
      tabindex="0"
      @click="openEditor($event, def)"
      @keydown.enter="openEditor($event, def)"
    >
      <span class="block-tag-field-title">{{ def.title }}</span>
      <span
        v-if="valueText(def) !== null"
        class="block-tag-field-value"
      >{{ valueText(def) }}</span>
      <span
        v-else
        class="block-tag-field-placeholder"
      >—</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.block-tag-fields {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-1) 0;
}

.block-tag-field-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--text-sm);
  cursor: pointer;
  border-radius: var(--radius-sm);
  padding: 1px var(--space-1);

  &:hover {
    background: var(--bg-base2);
  }
}

.block-tag-field-title {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  min-width: 4em;
}

.block-tag-field-value {
  color: var(--text-primary);
}

.block-tag-field-placeholder {
  color: var(--text-tertiary);
}
</style>
