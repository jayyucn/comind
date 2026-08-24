<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsLeftIcon, ChevronsRight, CircleDot, MapPinHouse, MapPinHouseIcon } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  modelValue: string // yyyy-MM
  monthsWithData?: string[]
}>(), {
  monthsWithData: () => [],
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const now = new Date()
const currentYear = now.getFullYear()
const currentMonth = now.getMonth() // 0-11

function parseYear(value: string): number {
  const y = parseInt(value.slice(0, 4), 10)
  return Number.isNaN(y) ? currentYear : y
}

// 当前展示的年份，从 modelValue 推导；外部 modelValue 变化时同步
const viewYear = ref(parseYear(props.modelValue))

watch(
  () => props.modelValue,
  (v) => {
    viewYear.value = parseYear(v)
  }
)

const dataSet = computed(() => new Set(props.monthsWithData))

const months = computed(() => {
  return Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0')
    const key = `${viewYear.value}-${mm}`
    return {
      index: i,
      label: `${i + 1}月`,
      isSelected: key === props.modelValue,
      isCurrent: viewYear.value === currentYear && i === currentMonth,
      isFuture: viewYear.value === currentYear && i > currentMonth,
      hasData: dataSet.value.has(key),
    }
  })
})

const todayKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`
const isTodayActive = computed(() =>
  viewYear.value === currentYear && props.modelValue === todayKey
)

function prevYear() {
  viewYear.value--
}
function nextYear() {
  if (viewYear.value < currentYear) viewYear.value++
}
function goToday() {
  viewYear.value = currentYear
  emit('update:modelValue', todayKey)
}
function selectMonth(index: number) {
  const mm = String(index + 1).padStart(2, '0')
  emit('update:modelValue', `${viewYear.value}-${mm}`)
}
</script>

<template>
  <div class="month-picker">
    <div class="mp-header">
      <button class="mp-today" type="button" :disabled="isTodayActive" @click="goToday">
        <MapPinHouse />
      </button>
     
      <span class="mp-year-label">{{ viewYear }}年</span>
       <button class="mp-nav" type="button" aria-label="上一年" @click="prevYear">
        <ChevronsLeft :size="18" :stroke-width="2" />
      </button>
      <button class="mp-nav" type="button" aria-label="下一年" :disabled="viewYear >= currentYear" @click="nextYear">
        <ChevronsRight :size="18" :stroke-width="2" />
      </button>

    </div>
    <div class="mp-grid">
      <button v-for="m in months" :key="m.index" type="button" class="mp-cell" :class="{
        'is-selected': m.isSelected,
        'is-current': m.isCurrent,
        'is-future': m.isFuture,
        'has-data': m.hasData,
      }" :disabled="m.isFuture" @click="selectMonth(m.index)">{{ m.label }}</button>
    </div>
  </div>
</template>

<style scoped>
.month-picker {
  display: flex;
  flex-direction: column;
  padding: 0 var(--space-4);
  gap: 4px;
  font-family: inherit;
}

.mp-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 var(--space-8);
}

.mp-nav {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  padding: 0;
  transition: background var(--transition-base), color var(--transition-base);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

.mp-year-label {
  flex: 1;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}

.mp-today {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* border: 1px solid var(--border); */
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  /* border-radius: var(--radius-sm); */
  font-size: 10px;
  font-weight: 600;
  padding: 0;
  font-family: inherit;
  /* transition: background var(--transition-base), border-color var(--transition-base); */

  &:hover:not(:disabled) {
    /* background: var(--bg-hover); */
    /* border-color: var(--border-strong); */
    scale: 1.1;
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
}

.mp-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-3);
  padding-bottom: var(--space-4);
}

.mp-cell {
  position: relative;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: var(--font-normal);
  padding: 0;
  font-family: inherit;
  transition: background var(--transition-base), color var(--transition-base);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }
}

.mp-cell.is-current {
  color: var(--accent);
  font-weight: 600;
}

.mp-cell.is-selected {
  background: var(--accent-subtle);
  color: var(--accent);
  font-weight: 600;
}

.mp-cell.is-current.is-selected {
  background: var(--accent-subtle);
  color: var(--accent);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}

.mp-cell.is-future {
  color: var(--text-tertiary);
  opacity: 0.45;
  cursor: not-allowed;
}

.mp-cell.has-data::after {
  content: '';
  position: absolute;
  right: 4px;
  bottom: 3px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--accent);
}
</style>
