<script setup lang="ts">
/**
 * 条件组 —— 通用 FilterBuilder 的递归子组件。
 *
 * 渲染一个条件组：combinator（且/或）切换 + children 列表（条件走 ConditionRow，子组递归本组件 depth+1）。
 * 支持添加条件 / 添加嵌套组（软限制 3 层：depth >= 3 时隐藏「添加条件组」）。
 * 组级 negate 在模型中存在，但本 UI 不暴露任何取反控件（v1 约定）。
 * 通过 defineModel 以不可变方式交出新 ConditionGroup（每次变更都构造新对象 emit，符合 vue/no-mutating-props）。
 */
import { Plus, X } from 'lucide-vue-next';
import { computed } from 'vue';
import type { Condition, ConditionGroup as GroupNode, ReferenceableRecord, Registry } from '../../core/query';
import ConditionRow from './ConditionRow.vue';

const props = withDefaults(
  defineProps<{
    registry: Registry
    entityType: string
    /** 嵌套深度，根组为 1。 */
    depth?: number
    /** 跨记录引用候选记录列表（通用，业务无关），由 FilterBuilder 注入。 */
    crossRecordSources?: ReferenceableRecord[]
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
  <!-- flex 行：内容区（带边框）+ 删除按钮（边框外右侧，不换行） -->
  <div class="qb-group" :data-depth="depth">
    <!-- 内容区：承载所有子条件、边框、底色 -->
    <div class="qb-group-content">
      <div class="qb-group-main">
        <div class="qb-children">
          <div v-for="(child, i) in children" :key="i" class="qb-child-row">
            <!-- 首条：填充文字占位；第 2 条：可编辑且/或下拉；其后：静态且/或文本 -->
            <span v-if="i === 0" class="qb-child-combinator qb-child-combinator--text">满足</span>
            <span v-else-if="i === 1" class="qb-child-combinator">
              <select
                class="qb-combinator-select"
                :value="model?.combinator"
                @change="setCombinator(($event.target as HTMLSelectElement).value as 'and' | 'or')"
              >
                <option value="and">且</option>
                <option value="or">或</option>
              </select>
            </span>
            <span v-else class="qb-child-combinator qb-child-combinator--text">
              {{ model?.combinator === 'or' ? '或' : '且' }}
            </span>

            <ConditionGroup
              v-if="isGroup(child)"
              :registry="registry"
              :entity-type="entityType"
              :depth="depth + 1"
              :cross-record-sources="crossRecordSources"
              :model-value="child"
              @update:model-value="replaceChild(i, $event)"
              @remove="removeChild(i)"
            />
            <ConditionRow
              v-else
              :registry="registry"
              :entity-type="entityType"
              :cross-record-sources="crossRecordSources"
              :model-value="child"
              @update:model-value="replaceChild(i, $event)"
              @remove="removeChild(i)"
            />
          </div>
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
    </div>

    <!-- 删除按钮：flex 兄弟元素，在边框外侧右侧，不换行、不悬空、与首行垂直对齐 -->
    <button
      v-if="depth > 1"
      class="qb-icon qb-group-remove"
      type="button"
      title="删除条件组"
      @click="emit('remove')"
    >
      <X :size="14" />
    </button>
  </div>
</template>

<style lang="scss" scoped>
// ── 组外层：flex 行，内容区 + × 按钮并排，永不换行 ──
.qb-group {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  flex-wrap: nowrap; // 关键：防止 × 被挤到下一行
}

// ── 内容区：边框和底色只作用于此区域，不包裹 × 按钮 ──
.qb-group-content {
  flex: 1 1 auto;
  min-width: 0; // 允许收缩，给 × 留出空间
  border-radius: 6px;
  padding: 8px;

  // 第 1 层（根组）：无边框、无底色
  .qb-group[data-depth='1'] & {
    border: none;
    background: transparent;
  }

  // 第 2/3 层：统一半透明底色 + 统一边框；嵌套叠加靠色差区分层级
  .qb-group[data-depth='2'] &,
  .qb-group[data-depth='3'] & {
    border: 1px solid var(--border);
    background: rgba(0, 0, 0, 0.04);
  }
}

[data-theme='dark'] {
  .qb-group[data-depth='2'] .qb-group-content,
  .qb-group[data-depth='3'] .qb-group-content {
    background: rgba(255, 255, 255, 0.04);
  }
}

.qb-group-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qb-child-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

// 每条子行左侧的前缀列（首条「满足」占位；第 2 条下拉；其后「且/或」文本）
// 固定宽度使各行的字段列左对齐
.qb-child-combinator {
  flex: 0 0 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding-top: 2px;
}

.qb-child-combinator--text {
  font-size: var(--text-xs, 12px);
  color: var(--text-secondary, #444);
  white-space: nowrap;
}

.qb-combinator-select {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-base);
  color: var(--text-secondary, #444);
  font-size: var(--text-xs, 12px);
  cursor: pointer;
  outline: none;

  &:focus {
    border-color: var(--accent, #6366f1);
  }
}

.qb-children {
  display: flex;
  flex-direction: column;
  gap: 6px;
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

// 组删除按钮：flex 兄弟元素，固定不收缩；微下移与第 2 行「且/或」下拉大致对齐
.qb-group-remove {
  flex: 0 0 auto;
  align-items: center;
}
</style>
