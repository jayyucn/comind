<script setup lang="ts">
import { computed } from 'vue'

import { fieldTypeIcon } from '../../utils/field-type-icons'

/**
 * 字段设置入口组件（ADR-0057 D1）：类型图标 + 字段名，**图标即设置入口**。
 *
 * 两个消费方共用本组件（视觉/交互单源）：
 * - 标签管理页字段模板卡片（`TagsLibrary.vue` 模板区，卡片化后）；
 * - block 字段区字段行（`BlockFieldZone.vue` list 变体，行首图标列）。
 *
 * 纯渲染 + emit：点击图标只发 `open-settings` 意图，弹窗开闭由调用方 / App 层
 * 管理（对齐 BasePopover「store 持状态 + 调用方传锚点」的编排模式）。
 * 入口点击 **`.stop`（click / enter）**：消费方常把本组件放进可点容器（block 字段行
 * 整行点击开快速编辑器），图标点击不得同时触发祖先的点击语义。
 * 门禁由调用方传入：`editable` 只影响 tooltip 文案（false → 只读措辞），不再拦弹窗；
 * `openable` 决定能否点开弹窗（缺省跟随 editable）。现行约定（ADR-0057 D1 修订）：
 * **设置入口不分来源**——自身 / 引用 / 继承字段一律 `openable` 传 true（定义全局共享，
 * 继承方与声明方同权编辑）；系统字段也传 true，进**只读**弹窗。缺省跟随 editable
 * 仅为兼容旧签名，生产消费方应显式传 true。
 */
const props = withDefaults(
  defineProps<{
    /** 字段名。 */
    title: string
    /** 字段类型（决定入口图标）。 */
    type: string
    /**
     * 是否「编辑语义」字段（非系统定义传 true）。只影响 tooltip 措辞：
     * false → 「系统字段只读，点击查看设置」。
     */
    editable?: boolean
    /**
     * 是否可打开设置弹窗（缺省跟随 editable）。现行约定一律传 true：
     * 非系统字段进可编辑弹窗（继承 / 引用与声明方同权），系统字段进只读弹窗。
     */
    openable?: boolean
  }>(),
  // openable 显式缺省 undefined：boolean prop 缺传时 Vue 运行时会布尔转型成 false
  // （而非 undefined），`?? editable` 的「缺省跟随」就被短路了——必须显式声明
  // default undefined 让 hasDefault 命中、跳过转型（tri-state boolean 惯用式）。
  { editable: true, openable: undefined },
)

const emit = defineEmits<{
  (e: 'open-settings'): void
}>()

/** 实际可点开弹窗：openable 显式传入则优先，否则跟随 editable。 */
const canOpen = computed(() => props.openable ?? props.editable)

const icon = computed(() => fieldTypeIcon(props.type))
const tooltip = computed(() => {
  if (!canOpen.value) return '此处不开放字段设置入口'
  return props.editable ? '点击打开字段设置' : '系统字段只读，点击查看设置'
})

function onClick() {
  if (canOpen.value) emit('open-settings')
}
</script>

<template>
  <span class="field-label">
    <button
      class="field-label-entry"
      :disabled="!canOpen"
      :title="tooltip"
      :aria-label="`${title}：${tooltip}`"
      @click.stop="onClick"
      @keydown.enter.stop
    >
      <component
        :is="icon"
        :size="13"
      />
    </button>
    <span class="field-label-name">{{ title }}</span>
  </span>
</template>

<style scoped lang="scss">
.field-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* ghost 图标按钮（对齐 .modal-action 配方：hover bg-hover + text-primary） */
.field-label-entry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &:disabled {
    cursor: default;
  }
}

.field-label-name {
  overflow: hidden;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
