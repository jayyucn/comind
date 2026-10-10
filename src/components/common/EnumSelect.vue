<script setup lang="ts">
/**
 * 通用枚举选择组件 —— 与 DatePicker / NumberInput 同构（common/ 下、v-model 契约），
 * 是枚举（封闭选项）字段值的专属录入控件。
 *
 * 两种形态：
 * - 默认（trigger 模式）：触发按钮显示当前选项（图标 + 文案）或占位符，点击弹出选项面板
 *   （Teleport 到 body，fixed 定位 + 视口收边，与 DatePicker 同一套定位策略）。
 * - inline：不渲染触发按钮与弹层，直接平铺选项列表——供嵌进既有弹层
 *   （先例：FieldValueQuickEditor 的 closedValues 分支，保持「点一次选项即落库」的一跳交互）。
 *
 * 接口（与 project 约定一致：不可变 update 事件）：
 * - v-model（modelValue: string | undefined / update:modelValue）：undefined = 未填，
 *   与 deleteFieldValue 的「无行即空」语义一致（上层据此删值行）。
 * - options：封闭选项（value/label/icon/description）；icon 以 status- / priority- /
 *   icon- 前缀的走 Icon 组件（SVG），其余按字符渲染（emoji 等）。
 * - 触发按钮 hover 浮现「×」清除（同 DatePicker 的 dp-clear 渐进披露），emit undefined。
 */
import { computed, nextTick, ref } from 'vue'
import { Icon } from '../Icons'

export interface EnumOption {
  value: string
  label: string
  icon?: string | null
  description?: string | null
}

export type EnumSelectValue = string | undefined

const props = withDefaults(
  defineProps<{
    /** 封闭选项列表（渲染顺序即展示顺序）。 */
    options: EnumOption[]
    /** 当前值；undefined = 未填。 */
    modelValue?: EnumSelectValue
    /** 空值占位符（trigger 模式）。 */
    placeholder?: string
    /** inline 模式：平铺选项列表，无触发按钮与弹层。 */
    inline?: boolean
    /** 无障碍标签（缺省用 placeholder）。 */
    ariaLabel?: string
  }>(),
  { modelValue: undefined, placeholder: '未填', inline: false, ariaLabel: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: EnumSelectValue] }>()

const open = ref(false)
const triggerEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const anchor = ref<{ x: number; y: number }>({ x: 0, y: 0 })

const current = computed<EnumOption | null>(
  () => props.options.find((o) => o.value === props.modelValue) ?? null,
)

/** SVG 图标名（status- / priority- / icon- 前缀）走 Icon 组件，其余按字符渲染。 */
function isSvgIcon(icon: string): boolean {
  return icon.startsWith('status-') || icon.startsWith('priority-') || icon.startsWith('icon-')
}

/* —— 展开 / 收起（trigger 模式；inline 模式无弹层） —— */
function toggle() {
  if (open.value) close()
  else openPanel()
}
function openPanel() {
  open.value = true
  nextTick(placePanel)
}
function close() {
  open.value = false
}

/** 测量触发按钮位置并视口收边（避免被窗口裁切），与 DatePicker.placePanel 同策略。 */
function placePanel() {
  const btn = triggerEl.value
  if (!btn) return
  const r = btn.getBoundingClientRect()
  let x = r.left
  let y = r.bottom + 4
  const el = panelEl.value
  if (el && typeof window !== 'undefined') {
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (x + el.offsetWidth > vw - 8) x = Math.max(8, vw - el.offsetWidth - 8)
    if (y + el.offsetHeight > vh - 8) {
      const above = r.top - el.offsetHeight - 4
      y = above >= 8 ? above : Math.max(8, vh - el.offsetHeight - 8)
    }
  }
  anchor.value = { x, y }
}

/* —— 取值回调 —— */
function select(value: string) {
  emit('update:modelValue', value)
  open.value = false
}

/** 清除：emit undefined，上层据此删值行（「无行即空」语义）。 */
function clearValue() {
  emit('update:modelValue', undefined)
}

// 测试钩子：暴露语义原子（openPanel/close/select），绕过 jsdom 合成事件的不确定性。
// 不参与生产交互。
defineExpose({ openPanel, close, select })
</script>

<template>
  <!-- inline 模式：直接平铺选项列表（嵌在既有弹层内），点一次选项即落库 -->
  <ul
    v-if="inline"
    class="es-list es-list--inline"
    data-testid="es-option-list"
  >
    <li
      v-for="opt in options"
      :key="opt.value"
      class="es-option"
      :class="{ selected: opt.value === modelValue }"
      :data-value="opt.value"
      @click.stop="select(opt.value)"
    >
      <span
        v-if="opt.icon"
        class="es-option-icon"
      >
        <Icon
          v-if="isSvgIcon(opt.icon)"
          :name="opt.icon"
          :size="16"
        />
        <span v-else>{{ opt.icon }}</span>
      </span>
      <span class="es-option-text">
        <span class="es-option-label">{{ opt.label }}</span>
        <span
          v-if="opt.description"
          class="es-option-description"
        >{{ opt.description }}</span>
      </span>
    </li>
  </ul>

  <!-- trigger 模式：触发按钮 + Teleport 弹层 -->
  <div
    v-else
    class="enum-select"
  >
    <button
      ref="triggerEl"
      type="button"
      class="es-trigger"
      :class="{ 'es-placeholder': !current, open }"
      data-testid="es-trigger"
      :aria-label="ariaLabel || placeholder || '选择'"
      @click.stop="toggle"
    >
      <template v-if="current">
        <span
          v-if="current.icon"
          class="es-option-icon"
        >
          <Icon
            v-if="isSvgIcon(current.icon)"
            :name="current.icon"
            :size="14"
          />
          <span v-else>{{ current.icon }}</span>
        </span>
        <span class="es-text">{{ current.label }}</span>
      </template>
      <span
        v-else
        class="es-text"
      >{{ placeholder }}</span>
      <span
        v-if="current"
        class="es-clear"
        title="清除"
        @click.stop="clearValue"
      >×</span>
      <svg
        class="es-chevron"
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

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelEl"
        class="es-root"
        :style="{ left: anchor.x + 'px', top: anchor.y + 'px' }"
      >
        <div
          class="es-backdrop"
          @click="close"
        />
        <div class="es-panel">
          <ul
            class="es-list"
            data-testid="es-option-list"
          >
            <li
              v-for="opt in options"
              :key="opt.value"
              class="es-option"
              :class="{ selected: opt.value === modelValue }"
              :data-value="opt.value"
              @click.stop="select(opt.value)"
            >
              <span
                v-if="opt.icon"
                class="es-option-icon"
              >
                <Icon
                  v-if="isSvgIcon(opt.icon)"
                  :name="opt.icon"
                  :size="16"
                />
                <span v-else>{{ opt.icon }}</span>
              </span>
              <span class="es-option-text">
                <span class="es-option-label">{{ opt.label }}</span>
                <span
                  v-if="opt.description"
                  class="es-option-description"
                >{{ opt.description }}</span>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* —— trigger（与 DatePicker / NumberInput 同一 28px 基线 + 渐进披露语言） —— */
.enum-select {
  display: inline-flex;
  min-width: 0;
}

.es-trigger {
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

  &:hover,
  &.open {
    background: var(--bg-hover);
  }
}

.es-trigger.es-placeholder .es-text {
  color: var(--text-tertiary);
}

.es-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.es-clear {
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

  &:hover {
    color: var(--error);
    background: var(--bg-hover);
  }
}

.es-trigger:hover .es-clear,
.es-trigger.open .es-clear,
.es-clear:hover {
  opacity: 1;
  pointer-events: auto;
}

.es-chevron {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--text-tertiary);
  transition: transform var(--dur-base) var(--ease-out);

  .es-trigger:hover &,
  .es-trigger.open & {
    color: var(--text-secondary);
  }
  .es-trigger.open & {
    transform: rotate(180deg);
  }
}

/* —— 弹层（与 DatePicker 的 dp-root/dp-panel 同构） —— */
.es-root {
  position: fixed;
  z-index: var(--z-popover-deep);
}

.es-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
}

.es-panel {
  display: flex;
  flex-direction: column;
  padding: var(--space-2, 8px);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  box-shadow: var(--shadow-modal);
}

/* —— 选项列表（两种模式共用同一行样式） —— */
.es-list {
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 160px;
  max-height: 240px;
  overflow-y: auto;
}

.es-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.es-option:hover {
  background: var(--accent-subtle, rgba(59, 130, 246, 0.08));
}

.es-option.selected {
  background: var(--accent-subtle, rgba(59, 130, 246, 0.12));
}

.es-option-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: var(--text-sm);
  flex: 0 0 auto;
}

.es-option-text {
  display: flex;
  flex-direction: row;
  gap: 8px;
  min-width: 0;
}

.es-option-label {
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.es-option-description {
  margin-top: auto;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
