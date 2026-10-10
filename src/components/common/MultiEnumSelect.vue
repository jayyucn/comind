<script setup lang="ts">
/**
 * 多选枚举选择组件（T4 multiSelect）—— 与 EnumSelect 同契约家族（common/ 下、v-model），
 * 是 multiSelect（封闭选项多选）字段值的专属录入控件。
 *
 * 与 EnumSelect 的差异只在取值语义：v-model 是选项 id **数组**，点选即切换勾选、
 * 面板保持展开（一次展开连续勾选多项）；全部取消或清除 → emit undefined，
 * 上层据此删值行（「无行即空」语义）。
 *
 * 弹层走 BasePopover 原语（Teleport to body + 锚点避让定位，ADR-0038/0009），
 * 不再各自手写定位样板。
 *
 * 接口：
 * - v-model（modelValue: string[] | undefined / update:modelValue）：undefined = 未填，
 *   空数组视为未填（emit undefined 归一）。
 * - options：封闭选项（value/label/icon/description），复用 EnumSelect 的 EnumOption。
 * - 触发按钮 hover 浮现「×」清除（同 EnumSelect 的渐进披露），emit undefined。
 */
import { computed, ref } from 'vue';
import { Icon } from '../Icons';
import BasePopover from './BasePopover.vue';
import { type EnumOption } from './EnumSelect.vue';

const props = withDefaults(
  defineProps<{
    /** 封闭选项列表（渲染顺序即展示顺序）。 */
    options: EnumOption[]
    /** 当前已选选项 id 数组；undefined = 未填。 */
    modelValue?: string[]
    /** 空值占位符。 */
    placeholder?: string
    /** 无障碍标签（缺省用 placeholder）。 */
    ariaLabel?: string
  }>(),
  { modelValue: undefined, placeholder: '未填', ariaLabel: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string[] | undefined] }>()

const open = ref(false)
const triggerEl = ref<HTMLButtonElement | null>(null)

/** 已选项（按 options 展示顺序，文案拼接展示） */
const selectedOptions = computed<EnumOption[]>(() => {
  const selected = new Set(props.modelValue ?? [])
  return props.options.filter((o) => selected.has(o.value))
})

const selectedText = computed(() => selectedOptions.value.map((o) => o.label).join('、'))

/** SVG 图标名（status- / priority- / icon- 前缀）走 Icon 组件，其余按字符渲染（与 EnumSelect 同判据）。 */
function isSvgIcon(icon: string): boolean {
  return icon.startsWith('status-') || icon.startsWith('priority-') || icon.startsWith('icon-')
}

function openPanel() {
  open.value = true
}
function close() {
  open.value = false
}

/** 勾选切换：追加 / 移除；清空归一为 undefined（上层据此删值行）。 */
function toggleOption(value: string) {
  const current = props.modelValue ?? []
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  emit('update:modelValue', next.length ? next : undefined)
}

/** 清除：emit undefined，上层据此删值行（「无行即空」语义）。 */
function clearValue() {
  emit('update:modelValue', undefined)
}

// 测试钩子：暴露语义原子（openPanel/close/toggleOption），绕过 jsdom 合成事件的不确定性。
defineExpose({ openPanel, close, toggleOption })
</script>

<template>
  <div class="multi-enum-select">
    <button
      ref="triggerEl"
      type="button"
      class="mes-trigger"
      :class="{ 'mes-placeholder': !selectedOptions.length, open }"
      data-testid="mes-trigger"
      :aria-label="ariaLabel || placeholder || '选择'"
      @click.stop="open ? close() : openPanel()"
    >
      <span
        v-if="selectedOptions.length"
        class="mes-text"
      >{{ selectedText }}</span>
      <span
        v-else
        class="mes-text"
      >{{ placeholder }}</span>
      <span
        v-if="selectedOptions.length"
        class="mes-clear"
        title="清除"
        @click.stop="clearValue"
      >×</span>
      <svg
        class="mes-chevron"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <path
          d="M4 6l4 4 4-4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <BasePopover
      :visible="open"
      :anchor-el="() => triggerEl"
      placement="bottom"
      @close="close"
    >
      <ul
        class="mes-list"
        data-testid="mes-option-list"
      >
        <li
          v-for="opt in options"
          :key="opt.value"
          class="mes-option"
          :class="{ selected: (modelValue ?? []).includes(opt.value) }"
          :data-value="opt.value"
          @click.stop="toggleOption(opt.value)"
        >
          <span class="mes-check">✓</span>
          <span
            v-if="opt.icon"
            class="mes-option-icon"
          >
            <Icon
              v-if="isSvgIcon(opt.icon)"
              :name="opt.icon"
              :size="16"
            />
            <span v-else>{{ opt.icon }}</span>
          </span>
          <span class="mes-option-label">{{ opt.label }}</span>
        </li>
      </ul>
    </BasePopover>
  </div>
</template>

<style scoped>
/* —— trigger（与 EnumSelect 同一 28px 基线 + 渐进披露语言） —— */
.multi-enum-select {
  display: inline-flex;
  min-width: 0;
}

.mes-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

.mes-trigger:hover,
.mes-trigger.open {
  background: var(--bg-hover);
}

.mes-trigger.mes-placeholder .mes-text {
  color: var(--text-tertiary);
}

.mes-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mes-clear {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 4px;
  /* 仅 hover 触发按钮时显示（透明占位避免宽度跳动）；隐形态必须 pointer-events:none */
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-base) var(--ease-out);
}

.mes-clear:hover {
  color: var(--error);
  background: var(--bg-hover);
}

.mes-trigger:hover .mes-clear,
.mes-trigger.open .mes-clear,
.mes-clear:hover {
  opacity: 1;
  pointer-events: auto;
}

.mes-chevron {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--text-tertiary);
  transition: transform var(--dur-base) var(--ease-out);
}

.mes-trigger:hover .mes-chevron,
.mes-trigger.open .mes-chevron {
  color: var(--text-secondary);
}

.mes-trigger.open .mes-chevron {
  transform: rotate(180deg);
}

/* —— 选项面板（BasePopover 提供外框，这里只管列表） —— */
.mes-list {
  list-style: none;
  margin: 0;
  padding: var(--space-2, 8px);
  min-width: 160px;
  max-height: 240px;
  overflow-y: auto;
}

.mes-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.mes-option:hover {
  background: var(--accent-subtle, rgba(59, 130, 246, 0.08));
}

.mes-option.selected {
  background: var(--accent-subtle, rgba(59, 130, 246, 0.12));
}

/* 勾选标记：仅已选项显示（占位保持对齐） */
.mes-check {
  flex: 0 0 auto;
  width: 14px;
  font-size: var(--text-sm);
  color: var(--accent);
  visibility: hidden;
}

.mes-option.selected .mes-check {
  visibility: visible;
}

.mes-option-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: var(--text-sm);
  flex: 0 0 auto;
}

.mes-option-label {
  font-size: var(--text-sm);
  color: var(--text-primary);
}
</style>
