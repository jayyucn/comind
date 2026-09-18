<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { tagFieldValueType, useTagStore } from '../../composables/useTagStore'
import type { TagFieldSpec } from '../../composables/useTagStore'
import { usePropertyStore } from '../../stores/property'
import type { PropertyValue } from '../../types/property'

/**
 * 标签字段注入面板（#131 / ADR-0049 D6：派生不物化）。
 *
 * 由 `effectiveFieldsForBlock` 派生「本 block 贴的标签 + 继承链」字段集合并渲染；
 * 贴标签本身**不写** block 的 property store（派生），仅当用户显式填写才落库真实属性。
 */

const props = defineProps<{ blockId: string }>()

const tagStore = useTagStore()
const propertyStore = usePropertyStore()

const fields = ref<TagFieldSpec[]>([])

async function load(): Promise<void> {
  fields.value = await tagStore.effectiveFieldsForBlock(props.blockId)
  await propertyStore.loadBlockProperties(props.blockId)
}

onMounted(load)
watch(() => props.blockId, load)
defineExpose({ reload: load })

function currentValue(key: string): unknown {
  return propertyStore.getBlockProperty(props.blockId, key)?.value ?? null
}

function displayValue(key: string): string {
  const v = currentValue(key)
  if (v === null || v === undefined) return ''
  return String(v)
}

function inputType(type: TagFieldSpec['type']): string {
  if (type === 'number') return 'number'
  if (type === 'date') return 'date'
  return 'text'
}

/** 把控件原始字符串强制成字段类型值（codec 契约：值须与声明 type 一致） */
function coerce(field: TagFieldSpec, raw: string): PropertyValue {
  if (field.type === 'number') return raw === '' ? '' : Number(raw)
  if (field.type === 'boolean') return raw === 'true'
  return raw
}

async function onEdit(field: TagFieldSpec, raw: string): Promise<void> {
  // select/multiSelect 的值以 string/array 落库（见 tagFieldValueType）
  await propertyStore.setProperty(props.blockId, field.key, coerce(field, raw), tagFieldValueType(field.type))
}
</script>

<template>
  <div
    v-if="fields.length > 0"
    class="tag-fields-panel"
  >
    <div
      v-for="f in fields"
      :key="f.key"
      class="tag-field-row"
    >
      <span class="tag-field-label">{{ f.label }}</span>
      <select
        v-if="f.type === 'select' && f.options"
        class="tag-field-control"
        :value="displayValue(f.key)"
        @change="onEdit(f, ($event.target as HTMLSelectElement).value)"
      >
        <option value="">
          —
        </option>
        <option
          v-for="o in f.options"
          :key="o.id"
          :value="o.id"
        >
          {{ o.label }}
        </option>
      </select>
      <input
        v-else
        class="tag-field-control"
        :type="inputType(f.type)"
        :value="displayValue(f.key)"
        @change="onEdit(f, ($event.target as HTMLInputElement).value)"
      >
    </div>
  </div>
</template>

<style scoped>
.tag-fields-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0 4px var(--indent-unit, 24px);
}

.tag-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
}

.tag-field-label {
  flex: 0 0 auto;
  min-width: 56px;
  color: var(--text-tertiary);
}

.tag-field-control {
  flex: 1 1 auto;
  max-width: 240px;
  padding: 2px 6px;
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 4px);
}
</style>
