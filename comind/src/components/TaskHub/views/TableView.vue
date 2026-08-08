<script setup lang="ts">
import { computed } from 'vue'
import { Square, CheckSquare, MapPin } from 'lucide-vue-next'
import type { BlockCard } from '../../../wasm/types'
import type { BlockQuery, SortRule } from '../../../types/blockQuery'

const props = defineProps<{
  cards: BlockCard[]
  query: BlockQuery
}>()

const emit = defineEmits<{
  statusChange: [blockId: string, newStatus: string]
  navigateToBlock: [blockId: string]
}>()

const STATUS_OPTIONS = ['Todo', 'Doing', 'Done', 'Canceled']

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  'P0': { label: 'P0', color: 'var(--error, #DC2626)' },
  'P1': { label: 'P1', color: 'var(--warning, #D97706)' },
  'P2': { label: 'P2', color: 'var(--accent, #6366F1)' },
  'P3': { label: 'P3', color: 'var(--text-tertiary, #9CA3AF)' },
}

function getStatus(card: BlockCard): string {
  return card.properties['status'] ?? 'Todo'
}

function getPriority(card: BlockCard): string {
  return card.properties['priority'] ?? ''
}

function getProject(card: BlockCard): string {
  return card.properties['project'] ?? ''
}

function getDeadline(card: BlockCard): { text: string; isOverdue: boolean; kind: string } | null {
  const dr = card.date_refs.find(d => d.kind === 'deadline')
  if (!dr) return null
  const date = new Date(dr.date_day)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const isOverdue = date < today
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return { text: `${month}-${day}`, isOverdue, kind: dr.kind }
}

function isDone(card: BlockCard): boolean {
  return getStatus(card) === 'Done'
}

function toggleDone(card: BlockCard, event: Event) {
  event.stopPropagation()
  const newStatus = isDone(card) ? 'Todo' : 'Done'
  emit('statusChange', card.block_id, newStatus)
}

function handleStatusChange(card: BlockCard, event: Event) {
  event.stopPropagation()
  const select = event.target as HTMLSelectElement
  emit('statusChange', card.block_id, select.value)
}

function getSortDir(fieldKey: string): string | null {
  const rule = props.query.sort.find(s => {
    if (s.field.kind === 'property' && s.field.key === fieldKey) return true
    if (fieldKey === 'content' && s.field.kind === 'content') return true
    return false
  })
  return rule?.dir ?? null
}

function renderSortIcon(fieldKey: string) {
  const dir = getSortDir(fieldKey)
  if (!dir) return ''
  return dir === 'asc' ? ' ↑' : ' ↓'
}

const DONE_COUNT = computed(() => props.cards.filter(c => isDone(c)).length)
</script>

<template>
  <div class="table-view">
    <div v-if="cards.length === 0" class="empty-state">
      <p>没有匹配的任务</p>
      <span class="empty-hint">尝试修改筛选条件</span>
    </div>

    <table v-else class="task-table">
      <thead>
        <tr>
          <th class="col-check">
            <span class="done-count">{{ DONE_COUNT }}/{{ cards.length }}</span>
          </th>
          <th class="col-content">内容{{ renderSortIcon('content') }}</th>
          <th class="col-status">状态{{ renderSortIcon('status') }}</th>
          <th class="col-priority">优先级{{ renderSortIcon('priority') }}</th>
          <th class="col-project">项目</th>
          <th class="col-deadline">截止</th>
          <th class="col-page">页面</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="card in cards"
          :key="card.block_id"
          class="task-row"
          :class="{ 'is-done': isDone(card) }"
          @click="emit('navigateToBlock', card.block_id)"
        >
          <!-- Checkbox -->
          <td class="col-check" @click.stop>
            <button class="check-btn" @click="toggleDone(card, $event)" :title="isDone(card) ? '标记未完成' : '标记完成'">
              <CheckSquare v-if="isDone(card)" :size="16" :stroke-width="1.75" class="text-success" />
              <Square v-else :size="16" :stroke-width="1.75" class="text-tertiary" />
            </button>
          </td>

          <!-- Content -->
          <td class="col-content">
            <span class="content-text" :title="card.content_preview">
              {{ card.content_preview }}
            </span>
          </td>

          <!-- Status -->
          <td class="col-status" @click.stop>
            <select
              class="status-select"
              :value="getStatus(card)"
              @change="handleStatusChange(card, $event)"
            >
              <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
            </select>
          </td>

          <!-- Priority -->
          <td class="col-priority">
            <span
              v-if="getPriority(card)"
              class="priority-badge"
              :style="{ color: PRIORITY_CONFIG[getPriority(card)]?.color, borderColor: PRIORITY_CONFIG[getPriority(card)]?.color }"
            >
              {{ PRIORITY_CONFIG[getPriority(card)]?.label ?? getPriority(card) }}
            </span>
          </td>

          <!-- Project -->
          <td class="col-project">
            <span class="text-secondary">{{ getProject(card) }}</span>
          </td>

          <!-- Deadline -->
          <td class="col-deadline">
            <template v-if="getDeadline(card)">
              <span
                class="deadline-text"
                :class="{ overdue: getDeadline(card)!.isOverdue, schedule: getDeadline(card)!.kind === 'schedule' }"
              >
                ⏰ {{ getDeadline(card)!.text }}
              </span>
            </template>
          </td>

          <!-- Page -->
          <td class="col-page">
            <button class="page-link-btn" @click.stop="emit('navigateToBlock', card.block_id)" :title="card.page_id">
              <MapPin :size="12" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style lang="scss" scoped>
.table-view {
  height: 100%;
  overflow: auto;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-tertiary);
  gap: 4px;

  p {
    font-size: var(--text-base);
    margin: 0;
  }
}

.empty-hint {
  font-size: var(--text-sm);
}

.task-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);

  thead {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg-primary);

    th {
      padding: 8px 10px;
      text-align: left;
      font-weight: var(--font-medium);
      color: var(--text-tertiary);
      border-bottom: 1px solid var(--border-color, var(--app-split));
      white-space: nowrap;
      font-size: var(--text-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  }

  tbody tr {
    border-bottom: 1px solid var(--border-color, var(--app-split));
    cursor: pointer;
    transition: background 80ms ease;

    &:hover {
      background: var(--bg-hover);
    }

    &.is-done {
      opacity: 0.55;

      .content-text {
        text-decoration: line-through;
      }
    }
  }

  td {
    padding: 8px 10px;
    vertical-align: middle;
  }
}

.col-check {
  width: 60px;
  text-align: center;
}

.col-content {
  min-width: 200px;
  max-width: 400px;
}

.col-status {
  width: 100px;
}

.col-priority {
  width: 60px;
}

.col-project {
  width: 100px;
}

.col-deadline {
  width: 80px;
}

.col-page {
  width: 40px;
}

.check-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;

  &:hover {
    background: var(--bg-hover);
  }
}

.text-success { color: var(--success, #10B981); }
.text-tertiary { color: var(--text-tertiary); }

.content-text {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-primary);
}

.status-select {
  padding: 2px 6px;
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: 4px;
  font-size: var(--text-xs);
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
  cursor: pointer;

  &:focus {
    border-color: var(--accent);
  }
}

.priority-badge {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid;
  font-size: 11px;
  font-weight: var(--font-semibold);
}

.deadline-text {
  font-size: var(--text-xs);
  white-space: nowrap;

  &.overdue {
    color: var(--error, #DC2626);
    font-weight: var(--font-semibold);
  }

  &.schedule {
    color: var(--accent, #6366F1);
  }

  &:not(.overdue):not(.schedule) {
    color: var(--warning, #D97706);
  }
}

.text-secondary {
  color: var(--text-secondary);
}

.page-link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-tertiary);
  padding: 2px;
  border-radius: 4px;

  &:hover {
    color: var(--accent);
    background: var(--bg-hover);
  }
}

.done-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-weight: var(--font-normal);
}
</style>
