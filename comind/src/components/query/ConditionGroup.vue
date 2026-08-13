<script setup lang="ts">
/**
 * 条件组 —— 通用 FilterBuilder 的递归子组件。
 *
 * 渲染一个条件组：combinator（且/或）切换 + children 列表（条件走 ConditionRow，子组递归本组件 depth+1）。
 * 支持添加条件 / 添加嵌套组（软限制 3 层：depth >= 3 时隐藏「添加条件组」）。
 * 组级 negate 在模型中存在，但本 UI 不暴露任何取反控件（v1 约定）。
 * 通过 defineModel 以不可变方式交出新 ConditionGroup（每次变更都构造新对象 emit，符合 vue/no-mutating-props）。
 */
import { computed } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import type { Condition, ConditionGroup as GroupNode, Registry } from '../../core/query'
import ConditionRow from './ConditionRow.vue'

const props = withDefaults(
  defineProps<{
    registry: Registry
    entityType: string
    /** 嵌套深度，根组为 1。 */
    depth?: number
  }>(),
  { depth: 1 },
)

const emit = defineEmits<{ remove: [] }>()
const model = defineModel<GroupNode>()

function isGroup(child: Condition | GroupNode): child is GroupNode {
  return !!child && typeof child === 'object' && 'children' in child
}

const canAddGroup = computed(() => props.depth < 3)

// 子节点列表（排除 model 可能为空的情况），保证 v-for 中 child 类型为 Condition | GroupNode 而非含 undefined
const children = computed<(Condition | GroupNode)[]>(() => model.value?.children ?? [])

function replaceChild(i: number, child: Condition | GroupNode | undefined) {
  if (!child) return
  model.value = {
    ...model.value!,
    children: model.value!.children.map((c, idx) => (idx === i ? child : c)),
  }
}

function addCondition() {
  model.value = {
    ...model.value!,
    children: [...model.value!.children, { field: '', op: 'is', value: undefined }],
  }
}

function addGroup() {
  model.value = {
    ...model.value!,
    children: [...model.value!.children, { combinator: 'and', children: [] }],
  }
}

function removeChild(i: number) {
  model.value = {
    ...model.value!,
    children: model.value!.children.filter((_, idx) => idx !== i),
  }
}

function setCombinator(c: 'and' | 'or') {
  model.value = { ...model.value!, combinator: c }
}
</script>

<template>
  <div class="qb-group" :class="{ 'qb-group-nested': depth > 1 }">
    <div class="qb-group-header">
      <div class="qb-combinator">
        <button
          type="button"
          :class="{ active: model?.combinator === 'and' }"
          @click="setCombinator('and')"
        >
          且
        </button>
        <button
          type="button"
          :class="{ active: model?.combinator === 'or' }"
          @click="setCombinator('or')"
        >
          或
        </button>
      </div>
      <button
        v-if="depth > 1"
        class="qb-icon"
        type="button"
        title="删除条件组"
        @click="emit('remove')"
      >
        <X :size="14" />
      </button>
    </div>

    <div class="qb-children">
      <template v-for="(child, i) in children" :key="i">
        <ConditionGroup
          v-if="isGroup(child)"
          :registry="registry"
          :entityType="entityType"
          :depth="depth + 1"
          :model-value="child"
          @update:model-value="replaceChild(i, $event)"
          @remove="removeChild(i)"
        />
        <ConditionRow
          v-else
          :registry="registry"
          :entityType="entityType"
          :model-value="child"
          @update:model-value="replaceChild(i, $event)"
          @remove="removeChild(i)"
        />
      </template>
    </div>

    <div class="qb-group-actions">
      <button type="button" class="qb-text-btn" @click="addCondition">
        <Plus :size="14" /> 添加条件
      </button>
      <button v-if="canAddGroup" type="button" class="qb-text-btn" @click="addGroup">
        <Plus :size="14" /> 添加条件组
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.qb-group {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  background: var(--bg-base2);
}

.qb-group-nested {
  background: var(--bg-hover);
}

.qb-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.qb-combinator {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;

  button {
    padding: 2px 10px;
    border: none;
    background: transparent;
    color: var(--text-secondary, #444);
    font-size: var(--text-xs, 12px);
    cursor: pointer;

    &.active {
      background: var(--accent, #6366f1);
      color: #fff;
    }
  }
}

.qb-children {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 6px;
}

.qb-group-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.qb-text-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary, #999);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
    color: var(--error, #dc2626);
  }
}
</style>
