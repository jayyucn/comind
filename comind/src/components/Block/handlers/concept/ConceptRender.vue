<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import { useBlockStore } from '../../../../stores/blocks'
import { useEditorStore } from '../../../../stores/editor'
import ConceptSection from './ConceptSection.vue'

const props = defineProps<{
  blockId: string
  content: string
  showPlaceholder?: boolean
  properties: Record<string, any>
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'content-click', event: MouseEvent): void
  (e: 'language-change', lang: string): void
  (e: 'clear'): void
  (e: 'exit-edit'): void
}>()

const blockStore = useBlockStore()
const editorStore = useEditorStore()

const isActive = computed(() => editorStore.activeBlockId === props.blockId)
const block = computed(() => blockStore.blocks.find(b => b.id === props.blockId))
const fmt = computed(() => block.value?.format || {})

// ── 编辑字段（双向绑定到 format） ──
const definition = ref(fmt.value.definition || '')
const boundaryExtension = ref(fmt.value.boundaryExtension || '')
const boundaryForbidden = ref(fmt.value.boundaryForbidden || '')
const comparisonLeft = ref(fmt.value.comparisonLeft || '')
const comparisonRight = ref(fmt.value.comparisonRight || '')
const exampleInstances = ref(fmt.value.exampleInstances || '')
const exampleUsage = ref(fmt.value.exampleUsage || '')

// format 变化时同步到本地 ref
watch(() => fmt.value, (f) => {
  definition.value = f.definition || ''
  boundaryExtension.value = f.boundaryExtension || ''
  boundaryForbidden.value = f.boundaryForbidden || ''
  comparisonLeft.value = f.comparisonLeft || ''
  comparisonRight.value = f.comparisonRight || ''
  exampleInstances.value = f.exampleInstances || ''
  exampleUsage.value = f.exampleUsage || ''
}, { deep: true })

// ── 输入框 ref（Tab 导航用） ──
const definitionRef = ref<HTMLTextAreaElement | null>(null)
const boundaryExtensionRef = ref<HTMLTextAreaElement | null>(null)
const boundaryForbiddenRef = ref<HTMLTextAreaElement | null>(null)
const comparisonLeftRef = ref<HTMLTextAreaElement | null>(null)
const comparisonRightRef = ref<HTMLTextAreaElement | null>(null)
const exampleInstancesRef = ref<HTMLTextAreaElement | null>(null)
const exampleUsageRef = ref<HTMLTextAreaElement | null>(null)

const fieldRefs = computed(() => [
  definitionRef,
  boundaryExtensionRef,
  boundaryForbiddenRef,
  comparisonLeftRef,
  comparisonRightRef,
  exampleInstancesRef,
  exampleUsageRef
])

// ── 保存 ──
async function saveFormat() {
  await blockStore.updateBlockFormat(props.blockId, {
    definition: definition.value,
    boundaryExtension: boundaryExtension.value,
    boundaryForbidden: boundaryForbidden.value,
    comparisonLeft: comparisonLeft.value,
    comparisonRight: comparisonRight.value,
    exampleInstances: exampleInstances.value,
    exampleUsage: exampleUsage.value
  })
}

function handleBlur() {
  saveFormat()
}

// ── Tab 导航 ──
function handleTab(e: KeyboardEvent, currentIndex: number) {
  e.preventDefault()
  saveFormat()
  if (e.shiftKey) {
    if (currentIndex > 0) {
      fieldRefs.value[currentIndex - 1].value?.focus()
    } else {
      emit('exit-edit')
    }
  } else {
    if (currentIndex < fieldRefs.value.length - 1) {
      fieldRefs.value[currentIndex + 1].value?.focus()
    } else {
      emit('exit-edit')
    }
  }
}

function handleEscape() {
  saveFormat()
  emit('exit-edit')
}

// ── textarea 自动高度 ──
function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

// ── 折叠状态 ──
const collapsedState = computed(() => {
  const c = fmt.value.conceptCollapsed || {}
  return {
    definition: c.definition ?? false,
    boundary: c.boundary ?? false,
    comparison: c.comparison ?? false,
    example: c.example ?? false
  }
})

function toggleSection(section: keyof typeof collapsedState.value) {
  const newFormat = { ...fmt.value }
  if (!newFormat.conceptCollapsed) newFormat.conceptCollapsed = {}
  newFormat.conceptCollapsed[section] = !newFormat.conceptCollapsed[section]
  blockStore.updateBlockFormat(props.blockId, newFormat)
}

// ── 激活时自动 focus ──
watch(isActive, async (active) => {
  if (active) {
    await nextTick()
    const emptyIdx = fieldRefs.value.findIndex(r => r.value && r.value.value === '')
    const targetIdx = emptyIdx >= 0 ? emptyIdx : 0
    fieldRefs.value[targetIdx]?.value?.focus()
  }
})

// ── BlockTypeEditorExposed 接口 ──
defineExpose({
  getEditor: () => null,
  getText: () => props.content,
  focus: (_pos?: number | 'end') => {
    nextTick(() => {
      const emptyIdx = fieldRefs.value.findIndex(r => r.value && r.value.value === '')
      const targetIdx = emptyIdx >= 0 ? emptyIdx : 0
      fieldRefs.value[targetIdx]?.value?.focus()
    })
  },
  markSaved: () => {}
})
</script>

<template>
  <div class="concept-block" @mousedown.stop @click.stop="emit('content-click', $event)">

    <!-- ═══ 展示模式 ═══ -->
    <template v-if="!isActive">
      <!-- 01. 核心定义 -->
      <ConceptSection
        section="definition"
        :collapsed="collapsedState.definition"
        label="Definition · 核心定义"
        label-color="#D97706"
        @toggle="toggleSection('definition')"
      >
        <div class="definition-quote" :class="{ 'is-placeholder': !fmt.definition }">
          {{ fmt.definition || '一句话抓本质...' }}
        </div> 
      </ConceptSection>

      <!-- 02. 边界范围 -->
      <ConceptSection
        section="boundary"
        :collapsed="collapsedState.boundary"
        label="boundary · 边界范围"
        label-color="#059669"
        @toggle="toggleSection('boundary')"
      >
        <div class="boundary-content">
          <div class="boundary-extension">
            <div class="boundary-label">✓ 外延</div>
            <div class="boundary-text" :class="{ 'is-placeholder': !fmt.boundaryExtension }">{{ fmt.boundaryExtension || '包含哪些事物...' }}</div>
          </div>
          <div class="boundary-forbidden">
            <div class="boundary-label">✗ 禁区</div>
            <div class="boundary-text" :class="{ 'is-placeholder': !fmt.boundaryForbidden }">{{ fmt.boundaryForbidden || '哪些不属于该概念...' }}</div>
          </div>
        </div>
      </ConceptSection>

      <!-- 03. 对标辨析 -->
      <ConceptSection
        section="comparison"
        :collapsed="collapsedState.comparison"
        label="comparison · 对标辨析"
        label-color="#6366F1"
        @toggle="toggleSection('comparison')"
      >
        <div class="comparison-content">
          <div class="comparison-left" :class="{ 'is-placeholder': !fmt.comparisonLeft }">{{ fmt.comparisonLeft || '左侧对比...' }}</div>
          <div class="comparison-vs">VS</div>
          <div class="comparison-right" :class="{ 'is-placeholder': !fmt.comparisonRight }">{{ fmt.comparisonRight || '右侧对比...' }}</div>
        </div>
      </ConceptSection>

      <!-- 04. 实例与应用 -->
      <ConceptSection
        section="example"
        :collapsed="collapsedState.example"
        label="examples · 实例与应用"
        label-color="#7C3AED"
        @toggle="toggleSection('example')"
      >
        <div class="example-content">
          <div class="example-examples">
            <div class="example-label">正向实例</div>
            <div class="example-text" :class="{ 'is-placeholder': !fmt.exampleInstances }">{{ fmt.exampleInstances || '2-3个正向实例...' }}</div>
          </div>
          <div class="example-usage">
            <div class="example-label">落地用法</div>
            <div class="example-text" :class="{ 'is-placeholder': !fmt.exampleUsage }">{{ fmt.exampleUsage || '现实中什么时候用...' }}</div>
          </div>
        </div>
      </ConceptSection>
    </template>

    <!-- ═══ 编辑模式 ═══ -->
    <template v-else>
      <!-- 01. 核心定义 -->
      <ConceptSection
        section="definition"
        :collapsed="collapsedState.definition"
        label="01 · 核心定义"
        label-color="#D97706"
        @toggle="toggleSection('definition')"
      >
        <textarea
          ref="definitionRef"
          v-model="definition"
          placeholder="一句话抓本质..."
          rows="1"
          class="concept-input definition-input"
          @input="autoResize($event.target as HTMLTextAreaElement)"
          @blur="handleBlur"
          @keydown.tab="handleTab($event, 0)"
          @keydown.escape="handleEscape"
        />
      </ConceptSection>

      <!-- 02. 边界范围 -->
      <ConceptSection
        section="boundary"
        :collapsed="collapsedState.boundary"
        label="02 · 边界范围"
        label-color="#059669"
        @toggle="toggleSection('boundary')"
      >
        <div class="boundary-content">
          <div class="boundary-extension">
            <div class="boundary-label">✓ 外延</div>
            <textarea
              ref="boundaryExtensionRef"
              v-model="boundaryExtension"
              placeholder="包含哪些事物..."
              rows="1"
              class="concept-input"
              @input="autoResize($event.target as HTMLTextAreaElement)"
              @blur="handleBlur"
              @keydown.tab="handleTab($event, 1)"
              @keydown.escape="handleEscape"
            />
          </div>
          <div class="boundary-forbidden">
            <div class="boundary-label">✗ 禁区</div>
            <textarea
              ref="boundaryForbiddenRef"
              v-model="boundaryForbidden"
              placeholder="哪些不属于该概念..."
              rows="1"
              class="concept-input"
              @input="autoResize($event.target as HTMLTextAreaElement)"
              @blur="handleBlur"
              @keydown.tab="handleTab($event, 2)"
              @keydown.escape="handleEscape"
            />
          </div>
        </div>
      </ConceptSection>

      <!-- 03. 对标辨析 -->
      <ConceptSection
        section="comparison"
        :collapsed="collapsedState.comparison"
        label="03 · 对标辨析"
        label-color="#6366F1"
        @toggle="toggleSection('comparison')"
      >
        <div class="comparison-content">
          <textarea
            ref="comparisonLeftRef"
            v-model="comparisonLeft"
            placeholder="概念A..."
            rows="1"
            class="concept-input comparison-input-left"
            @input="autoResize($event.target as HTMLTextAreaElement)"
            @blur="handleBlur"
            @keydown.tab="handleTab($event, 3)"
            @keydown.escape="handleEscape"
          />
          <div class="comparison-vs">VS</div>
          <textarea
            ref="comparisonRightRef"
            v-model="comparisonRight"
            placeholder="概念B..."
            rows="1"
            class="concept-input comparison-input-right"
            @input="autoResize($event.target as HTMLTextAreaElement)"
            @blur="handleBlur"
            @keydown.tab="handleTab($event, 4)"
            @keydown.escape="handleEscape"
          />
        </div>
      </ConceptSection>

      <!-- 04. 实例与应用 -->
      <ConceptSection
        section="example"
        :collapsed="collapsedState.example"
        label="04 · 实例与应用"
        label-color="#7C3AED"
        @toggle="toggleSection('example')"
      >
        <div class="example-content">
          <div class="example-examples">
            <div class="example-label">正向实例</div>
            <textarea
              ref="exampleInstancesRef"
              v-model="exampleInstances"
              placeholder="2-3个正向实例..."
              rows="1"
              class="concept-input"
              @input="autoResize($event.target as HTMLTextAreaElement)"
              @blur="handleBlur"
              @keydown.tab="handleTab($event, 5)"
              @keydown.escape="handleEscape"
            />
          </div>
          <div class="example-usage">
            <div class="example-label">落地用法</div>
            <textarea
              ref="exampleUsageRef"
              v-model="exampleUsage"
              placeholder="现实中什么时候用..."
              rows="1"
              class="concept-input"
              @input="autoResize($event.target as HTMLTextAreaElement)"
              @blur="handleBlur"
              @keydown.tab="handleTab($event, 6)"
              @keydown.escape="handleEscape"
            />
          </div>
        </div>
      </ConceptSection>
    </template>
  </div>
</template>

<style scoped>
.concept-block {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

/* ── 展示模式 placeholder 样式 ── */
.is-placeholder {
  color: var(--text-tertiary) !important;
  font-style: italic;
}

/* ── 编辑模式输入框 ── */
.concept-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  resize: none;
  overflow: hidden;
  padding: 0;
}

.concept-input::placeholder {
  color: var(--text-tertiary);
  font-style: italic;
}

.concept-input:focus {
  background: rgba(99, 102, 241, 0.03);
  border-radius: 4px;
}

.definition-input {
  border-left: 3px solid #6366F1;
  padding: 8px 12px;
  background: rgba(99, 102, 241, 0.04);
  border-radius: 0 6px 6px 0;
}

.comparison-input-left {
  flex: 1;
  background: rgba(99, 102, 241, 0.08);
  border-radius: 6px;
  padding: 8px 12px;
  text-align: center;
}

.comparison-input-right {
  flex: 1;
  background: rgba(217, 119, 6, 0.06);
  border-radius: 6px;
  padding: 8px 12px;
  text-align: center;
}

/* ── 展示模式 ── */
.definition-quote {
  border-left: 3px solid #6366F1;
  padding: 10px 14px;
  background: rgba(99, 102, 241, 0.04);
  border-radius: 0 6px 6px 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-primary);
}

.boundary-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.boundary-extension {
  background: rgba(5, 150, 105, 0.05);
  border: 1px solid rgba(5, 150, 105, 0.15);
  border-radius: 6px;
  padding: 10px 12px;
}

.boundary-forbidden {
  background: rgba(220, 38, 38, 0.04);
  border: 1px solid rgba(220, 38, 38, 0.12);
  border-radius: 6px;
  padding: 10px 12px;
}

.boundary-label {
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 4px;
}

.boundary-extension .boundary-label { color: #059669; }
.boundary-forbidden .boundary-label { color: #DC2626; }

.boundary-text {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  white-space: pre-line;
}

.comparison-content {
  display: flex;
  gap: 10px;
  align-items: stretch;
}

.comparison-left {
  flex: 1;
  background: rgba(99, 102, 241, 0.08);
  border-radius: 6px;
  padding: 8px 12px;
  text-align: center;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
}

.comparison-vs {
  display: flex;
  align-items: center;
  font-size: 10px;
  color: var(--text-tertiary);
  font-weight: 500;
}

.comparison-right {
  flex: 1;
  background: rgba(217, 119, 6, 0.06);
  border-radius: 6px;
  padding: 8px 12px;
  text-align: center;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
}

.example-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.example-examples {
  background: rgba(124, 58, 237, 0.05);
  border: 1px solid rgba(124, 58, 237, 0.12);
  border-radius: 6px;
  padding: 10px 12px;
}

.example-usage {
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.10);
  border-radius: 6px;
  padding: 10px 12px;
}

.example-label {
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 4px;
}

.example-examples .example-label { color: #7C3AED; }
.example-usage .example-label { color: #6366F1; }

.example-text {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  white-space: pre-line;
}
</style>
