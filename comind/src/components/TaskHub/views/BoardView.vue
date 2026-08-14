<script setup lang="ts">
import { computed, ref } from 'vue'
import { GripVertical } from 'lucide-vue-next'
import type { BlockCard } from '../../../wasm/types'
import type { BlockQuery } from '../../../types/blockQuery'

const props = defineProps<{
  cards: BlockCard[]
  query: BlockQuery
}>()

const emit = defineEmits<{
  statusChange: [blockId: string, newStatus: string]
  navigateToBlock: [blockId: string]
}>()

const COLUMNS = [
  { key: 'Todo', label: '📋 待办', color: 'var(--text-secondary)' },
  { key: 'Doing', label: '🔥 进行中', color: 'var(--warning, #D97706)' },
  { key: 'Done', label: '✅ 已完成', color: 'var(--success, #10B981)' },
  { key: 'Canceled', label: '❌ 已取消', color: 'var(--text-tertiary)' },
] as const

const draggedCardId = ref<string | null>(null)

function cardsByStatus(status: string): BlockCard[] {
  return props.cards.filter(c => (c.properties['status'] ?? 'Todo') === status)
}

function getPriority(card: BlockCard): string {
  return card.properties['priority'] ?? ''
}

const PRIORITY_COLORS: Record<string, string> = {
  'P0': 'var(--error, #DC2626)',
  'P1': 'var(--warning, #D97706)',
  'P2': 'var(--accent, #6366F1)',
  'P3': 'var(--text-tertiary, #9CA3AF)',
}

function getDeadline(card: BlockCard): string | null {
  const dr = card.date_refs.find(d => d.kind === 'deadline')
  if (!dr) return null
  const date = new Date(dr.date_day)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const isOverdue = date < today
  return isOverdue ? `⏰ ${month}-${day}` : `📅 ${month}-${day}`
}

function isDeadlineOverdue(card: BlockCard): boolean {
  const dr = card.date_refs.find(d => d.kind === 'deadline')
  if (!dr) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(dr.date_day) < today
}

// Drag & drop handlers
function onDragStart(blockId: string, event: DragEvent) {
  draggedCardId.value = blockId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', blockId)
  }
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function onDrop(status: string, event: DragEvent) {
  event.preventDefault()
  const blockId = event.dataTransfer?.getData('text/plain')
  if (blockId) {
    emit('statusChange', blockId, status)
  }
  draggedCardId.value = null
}

function onDragEnd() {
  draggedCardId.value = null
}
</script>

<template>
  <div class="board-view">
    <div
      v-for="col in COLUMNS"
      :key="col.key"
      class="board-column"
      :class="col.key.toLowerCase()"
      @dragover="onDragOver"
      @drop="onDrop(col.key, $event)"
    >
      <div class="column-header">
        <span class="column-title" :style="{ color: col.color }">{{ col.label }}</span>
        <span class="column-count">{{ cardsByStatus(col.key).length }}</span>
      </div>

      <div class="column-cards">
        <div v-if="cardsByStatus(col.key).length === 0" class="column-empty">
          暂无卡片
        </div>

        <div
          v-for="card in cardsByStatus(col.key)"
          :key="card.block_id"
          class="board-card"
          :class="{ dragging: draggedCardId === card.block_id }"
          draggable="true"
          @dragstart="onDragStart(card.block_id, $event)"
          @dragend="onDragEnd"
          @click="emit('navigateToBlock', card.block_id)"
        >
          <div class="card-grip">
            <GripVertical :size="12" />
          </div>
          <div class="card-body">
            <p class="card-content">{{ card.content_preview }}</p>
            <div class="card-meta">
              <span
                v-if="getPriority(card)"
                class="card-priority"
                :style="{ color: PRIORITY_COLORS[getPriority(card)] }"
              >
                {{ getPriority(card) }}
              </span>
              <span
                v-if="getDeadline(card)"
                class="card-deadline"
                :class="{ overdue: isDeadlineOverdue(card) }"
              >
                {{ getDeadline(card) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.board-view {
  display: flex;
  gap: 0;
  height: 100%;
  overflow-x: auto;
  padding: 12px;
}

.board-column {
  flex: 1;
  min-width: 220px;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-color, var(--app-split));

  &:last-child {
    border-right: none;
  }
}

.column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 2px solid var(--border-color, var(--app-split));
}

.column-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}

.column-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  background: var(--bg-base2);
  padding: 1px 6px;
  border-radius: 10px;
}

.column-cards {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.column-empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.board-card {
  display: flex;
  gap: 6px;
  padding: 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: 8px;
  cursor: grab;
  transition: box-shadow 100ms ease, border-color 100ms ease, opacity 100ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    border-color: var(--accent);
  }

  &.dragging {
    opacity: 0.4;
  }
}

.card-grip {
  display: flex;
  align-items: flex-start;
  padding-top: 3px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.card-body {
  flex: 1;
  min-width: 0;
}

.card-content {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.card-priority {
  font-size: 11px;
  font-weight: var(--font-semibold);
}

.card-deadline {
  font-size: 11px;
  color: var(--text-secondary);

  &.overdue {
    color: var(--error, #DC2626);
    font-weight: var(--font-semibold);
  }
}
</style>
