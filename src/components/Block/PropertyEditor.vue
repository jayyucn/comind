<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'
import type { PropertyType, PropertyValue } from '../../types/property'
import BasePopover from '../common/BasePopover.vue'

const editorStore = useEditorStore()
const propertyStore = usePropertyStore()

const visible = computed(() => editorStore.propertyEditor?.visible ?? false)
const blockId = computed(() => editorStore.propertyEditor?.blockId ?? '')
const initialKey = computed(() => editorStore.propertyEditor?.initialKey ?? null)

// 自定义属性的状态
const customKey = ref<string>('')
const selectedType = ref<PropertyType>('string')
const currentValue = ref<PropertyValue>('')
const arrayInput = ref('')

const propertyTypes: { type: PropertyType; label: string }[] = [
  { type: 'string', label: '文本' },
  { type: 'number', label: '数字' },
  { type: 'boolean', label: '布尔值' },
  { type: 'date', label: '日期' },
  { type: 'array', label: '数组/标签' },
]

const currentArrayValue = computed<string[]>({
  get: () => Array.isArray(currentValue.value) ? currentValue.value : [],
  set: (val) => { currentValue.value = val }
})

/** 类型的展示文案（编辑模式下类型是纯文本，不再走 select 的 option 文案） */
const typeLabel = computed(
  () => propertyTypes.find(t => t.type === selectedType.value)?.label ?? selectedType.value,
)

// 默认焦点的候选元素（各 v-if 分支同时只挂一个，同一 ref 名可跨分支复用）
const panelRoot = ref<HTMLElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const valueInput = ref<HTMLInputElement | null>(null)
const tagInput = ref<HTMLInputElement | null>(null)
const booleanOptions = ref<HTMLElement | null>(null)

/** 打开时的默认焦点：新建模式落「属性名称」，编辑模式落「值」——值的元素随类型而变
 *  （文本/数字/日期共用一个 input，布尔取已选中的单选框，数组取标签输入框）。 */
function resolveFocusTarget(): HTMLElement | null {
  if (!initialKey.value) return nameInput.value
  if (selectedType.value === 'boolean') {
    const radios = booleanOptions.value?.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    if (!radios?.length) return null
    return Array.from(radios).find(r => r.checked) ?? radios[0]
  }
  if (selectedType.value === 'array') return tagInput.value
  return valueInput.value
}

/**
 * 等渲染落地再 focus —— 面板随 v-if 挂载，调用时 DOM 还不存在。
 * `isConnected` 守卫是必需的：Page 与 Ideas 各自常驻一个本组件（KeepAlive 下可能同时存活），
 * 未激活实例的 Teleport 内容不在文档里，抢 focus 会把焦点从真正打开的那份抢走。
 */
function focusInitialField() {
  nextTick(() => {
    const root = panelRoot.value
    if (!root?.isConnected) return
    resolveFocusTarget()?.focus()
  })
}

const canSave = computed(() => {
  if (!customKey.value.trim()) return false
  if (selectedType.value === 'array' && currentArrayValue.value.length === 0) return false
  if (selectedType.value !== 'array' && currentValue.value === '') return false
  return true
})

function open() {
  if (initialKey.value) {
    // 编辑模式
    customKey.value = initialKey.value
    const existing = propertyStore.getBlockProperty(blockId.value, initialKey.value)
    if (existing) {
      selectedType.value = existing.type
      currentValue.value = existing.value
    } else {
      currentValue.value = selectedType.value === 'array' ? [] : ''
    }
  } else {
    // 新建模式
    customKey.value = ''
    selectedType.value = 'string'
    currentValue.value = ''
    arrayInput.value = ''
  }
}

function close() {
  editorStore.hidePropertyEditor()
  customKey.value = ''
  selectedType.value = 'string'
  currentValue.value = ''
  arrayInput.value = ''
}

/** 浮层锚点（触发元素矩形）；生产调用方均会传，缺省时退化为视口居中 */
const position = computed(() => editorStore.propertyEditor?.position ?? null)
const popoverPosition = computed(
  () => position.value ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 },
)

function addArrayItem() {
  const val = arrayInput.value.trim()
  if (val && !currentArrayValue.value.includes(val)) {
    currentArrayValue.value = [...currentArrayValue.value, val]
  }
  arrayInput.value = ''
}

function removeArrayItem(idx: number) {
  currentArrayValue.value = currentArrayValue.value.filter((_, i) => i !== idx)
}

async function save() {
  if (!canSave.value || !blockId.value) return

  try {
    await propertyStore.setProperty(
      blockId.value,
      customKey.value.trim(),
      currentValue.value,
      selectedType.value
    )
    close()
  } catch (error) {
    console.error('Failed to save property:', error)
  }
}

watch(visible, (val) => {
  if (val) {
    open()
    focusInitialField()
  }
}, { immediate: true })
</script>

<template>
  <!-- 面板外框与关闭行为（Teleport / overlay 点击 / Escape）由 BasePopover 统一提供，
       这里只管表单本体；锚点用触发元素矩形（同 PropertyQuickEditor）。 -->
  <BasePopover
    :visible="visible"
    :position="popoverPosition"
    @close="close"
  >
    <div
      ref="panelRoot"
      class="property-editor-panel"
    >
      <div class="dialog-header">
        <h3>{{ initialKey ? '编辑自定义属性' : '添加自定义属性' }}</h3>
      </div>
      
      <div class="dialog-body">
        <!-- 名称：编辑模式下 key 不可改，展示为纯文本 -->
        <div class="form-group">
          <label>属性名称</label>
          <input
            v-if="!initialKey"
            ref="nameInput"
            v-model="customKey"
            type="text"
            placeholder="输入属性名称"
          >
          <span
            v-else
            class="form-static"
          >{{ customKey }}</span>
        </div>

        <div class="form-group">
          <label>类型</label>
          <select
            v-if="!initialKey"
            v-model="selectedType"
          >
            <option
              v-for="t in propertyTypes"
              :key="t.type"
              :value="t.type"
            >
              {{ t.label }}
            </option>
          </select>
          <span
            v-else
            class="form-static"
          >{{ typeLabel }}</span>
        </div>

        <div class="form-group">
          <label>值</label>
          
          <!-- Boolean -->
          <div
            v-if="selectedType === 'boolean'"
            ref="booleanOptions"
            class="boolean-options"
          >
            <label class="boolean-option">
              <input
                v-model="currentValue"
                type="radio"
                :value="true"
              >
              <span>是</span>
            </label>
            <label class="boolean-option">
              <input
                v-model="currentValue"
                type="radio"
                :value="false"
              >
              <span>否</span>
            </label>
          </div>

          <!-- Date -->
          <input
            v-else-if="selectedType === 'date'"
            ref="valueInput"
            v-model="currentValue"
            type="date"
          >

          <!-- Number -->
          <input
            v-else-if="selectedType === 'number'"
            ref="valueInput"
            v-model.number="currentValue"
            type="number"
          >

          <!-- Array (tags) -->
          <div
            v-else-if="selectedType === 'array'"
            class="array-input"
          >
            <input
              ref="tagInput"
              v-model="arrayInput"
              placeholder="输入标签，回车添加"
              @keydown.enter.prevent="addArrayItem"
            >
            <div class="array-items">
              <span
                v-for="(item, idx) in currentArrayValue"
                :key="idx"
                class="array-item"
              >
                {{ item }}
                <button
                  class="remove-btn"
                  @click="removeArrayItem(idx)"
                >×</button>
              </span>
            </div>
          </div>

          <!-- Default: string -->
          <input
            v-else
            ref="valueInput"
            v-model="currentValue"
            type="text"
            placeholder="输入值"
          >
        </div>
      </div>

      <div class="dialog-footer">
        <button
          class="btn btn-secondary"
          @click="close"
        >
          取消
        </button>
        <button
          class="btn btn-primary"
          :disabled="!canSave"
          @click="save"
        >
          保存
        </button>
      </div>
    </div>
  </BasePopover>
</template>

<style scoped>
/* 面板外框（背景 / 边框 / 圆角 / 阴影 / Teleport / overlay 关闭）由 BasePopover 提供，
   这里只管表单排版。定宽是必须的：输入框是 width:100%，面板交给内容撑宽会构成
   「百分比尺寸 ↔ auto 宽容器」的循环依赖。 */
.property-editor-panel {
  box-sizing: border-box;
  width: 300px;
  padding: 12px;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.dialog-header h3 {
  margin: 0;
  font-size: var(--heading-5);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

/* 表单项：标签在左、字段在右，同处一行（面板窄，竖排会让三行字段各自占两行高度） */
.form-group {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

/* 子组合器是有意的：字段标签只取直接子级，不波及单选框的 <label class="boolean-option">
   （它在 .boolean-options 里），否则 display 会被这里压掉。
   定宽 + 右对齐：三个标签右边缘对齐，右侧字段的左边缘因此天然对齐。 */
.form-group > label {
  flex: 0 0 60px;
  text-align: right;
  font-weight: var(--font-medium);
  font-size: var(--text-sm);
  color: var(--text-primary);
}

/* 编辑模式下「属性名称 / 类型」是只读信息，以纯文本展示（不再是输入控件）。
   flex:1 与输入框同宽，overflow-wrap 让长 key 换行而不是撑破面板。 */
.form-static {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.form-group input,
.form-group select {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: var(--text-sm);
  color: var(--text-primary);
  /* 必须给不透明底，不能用 transparent：原生 <select> 展开的选项列表是浏览器自绘的
     独立弹层，它的底色取自元素自身的 background-color —— 透明时弹层无处可透，会回退
     成不透明浅色，而文字色仍是 --text-primary（暗色主题下是浅色），于是「浅底浅字」。
     color-scheme 管不了这一层（那只管日历面板、滚动条、步进按钮等 UA 内绘制）。
     --bg-base 与面板底色相同，所以闭合态观感与透明时一模一样。 */
  background: var(--bg-base);
  transition: border-color 150ms ease;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--accent);
}

/* 收音机选项（是 / 否）：与上面的字段标签同处一行，占满标签右侧的剩余宽度 */
.boolean-options {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: 16px;
}

.boolean-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: var(--text-sm);
}

/* 标签输入组（array 分支）：占据标签右侧的剩余宽度 */
.array-input {
  flex: 1;
  min-width: 0;
}

/* array 分支的输入框是 .array-input 的子级（非 flex 容器），拿不到上面的 flex:1，
   需显式撑满（全局 box-sizing: border-box，100% 含内边距，不会溢出） */
.array-input input {
  width: 100%;
}

.array-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.array-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--accent-subtle);
  border-radius: 4px;
  font-size: var(--text-sm);
}

.remove-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--text-sm);
  padding: 0 4px;
  color: var(--text-secondary);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  transition: background 120ms ease;
}

.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

.btn-secondary:hover {
  background: var(--surface-faint);
}

.btn-primary {
  background: var(--accent);
  color: var(--color-white);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
