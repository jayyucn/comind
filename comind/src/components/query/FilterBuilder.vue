<script setup lang="ts">
/**
 * 通用 FilterBuilder —— 引擎唯一的 UI 交付物（issue #22）。
 *
 * 由注册表驱动：字段选择器来自注册表、操作符由 deriveOps 按类型派生、值编辑器按类型分派。
 * 组件持有唯一一份响应式 ViewQuery 副本，任何编辑都通过子组件的不可变更新回流，
 * 最终以深拷贝 emit 出合法 ViewQuery（version:1 / filter / sort[] / groupBy）供求值器或持久化消费。
 * 组级 negate 在模型中存在但本 UI 不暴露（v1 约定）。
 */
import { reactive, ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import type { FieldDescriptor, Registry, SortRule, ViewQuery } from '../../core/query'
import ConditionGroup from './ConditionGroup.vue'

const props = defineProps<{
  registry: Registry
  entityType: string
  modelValue: ViewQuery
}>()

const emit = defineEmits<{ 'update:modelValue': [ViewQuery] }>()

// 唯一响应式状态：深拷贝外部传入的查询，避免直接修改 prop。
// 用 JSON 而非 structuredClone：props.modelValue 是 reactive 代理，structuredClone 在 jsdom 下无法克隆代理。
const query = reactive(JSON.parse(JSON.stringify(props.modelValue))) as ViewQuery

// 字段列表响应式跟随注册表运行时增删
const fields = ref<FieldDescriptor[]>(props.registry.list(props.entityType))
let unsubscribe: (() => void) | undefined
onMounted(() => {
  unsubscribe = props.registry.subscribe(() => {
    fields.value = props.registry.list(props.entityType)
  })
})
onUnmounted(() => {
  unsubscribe?.()
})

// 多键排序配置
const sortFieldOptions = computed(() => fields.value)
function addSort() {
  query.sort.push({ field: '', dir: 'asc' })
}
function removeSort(i: number) {
  query.sort.splice(i, 1)
}
function toggleSortDir(rule: SortRule) {
  rule.dir = rule.dir === 'asc' ? 'desc' : 'asc'
}

// 单字段分组配置
const groupOptions = computed(() => fields.value)

// 任意编辑后 emit 深拷贝的合法 ViewQuery（保证外部拿到纯数据，不持有 reactive proxy）
watch(
  query,
  () => {
    emit('update:modelValue', JSON.parse(JSON.stringify(query)) as ViewQuery)
  },
  { deep: true },
)
</script>

<template>
  <div class="qb-builder">
    <!-- 条件区 -->
    <section class="qb-section">
      <h4 class="qb-section-title">筛选条件</h4>
      <ConditionGroup v-model="query.filter" :registry="registry" :entity-type="entityType" :depth="1" />
    </section>

    <!-- 排序区（多键） -->
    <section class="qb-section">
      <h4 class="qb-section-title">排序</h4>
      <div class="qb-sort-list">
        <div v-for="(rule, i) in query.sort" :key="i" class="qb-sort-row">
          <select class="qb-select" v-model="rule.field">
            <option value="">（无）</option>
            <option v-for="f in sortFieldOptions" :key="f.key" :value="f.key">{{ f.label }}</option>
          </select>
          <button
            class="qb-icon"
            type="button"
            :class="{ active: rule.dir === 'asc' }"
            :title="rule.dir === 'asc' ? '升序' : '降序'"
            @click="toggleSortDir(rule)"
          >
            {{ rule.dir === 'asc' ? '↑' : '↓' }}
          </button>
          <button class="qb-icon" type="button" title="删除排序" @click="removeSort(i)">
            <X :size="12" />
          </button>
        </div>
      </div>
      <button type="button" class="qb-text-btn" @click="addSort">
        <Plus :size="14" /> 添加排序
      </button>
    </section>

    <!-- 分组区（单字段） -->
    <section class="qb-section">
      <h4 class="qb-section-title">分组</h4>
      <select class="qb-select" :value="query.groupBy" @change="query.groupBy = ($event.target as HTMLSelectElement).value || null">
        <option :value="null">不分组</option>
        <option v-for="f in groupOptions" :key="f.key" :value="f.key">{{ f.label }}</option>
      </select>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.qb-builder {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

.qb-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qb-section-title {
  margin: 0;
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-semibold, 600);
  color: var(--text-secondary, #444);
}

.qb-sort-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qb-sort-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.qb-select {
  padding: 4px 8px;
  border: 1px solid var(--border-color, var(--app-split, #ddd));
  border-radius: 4px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #111);
  font-size: var(--text-sm, 13px);
  outline: none;

  &:focus {
    border-color: var(--accent, #6366f1);
  }
}

.qb-text-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  padding: 3px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary, #999);
  cursor: pointer;
  font-size: var(--text-xs, 12px);

  &:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
    color: var(--text-secondary, #444);
  }
}

.qb-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary, #999);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
    color: var(--text-secondary, #444);
  }

  &.active {
    color: var(--accent, #6366f1);
    background: var(--accent-bg, rgba(99, 102, 241, 0.08));
  }
}
</style>
