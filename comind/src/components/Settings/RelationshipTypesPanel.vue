<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowUp, ArrowDown, Pencil, Trash2, Plus, ChevronDown, ChevronRight, Undo2, X, Check } from 'lucide-vue-next'
import { useRelationshipTypes, validateRelationshipTypeInput, type RelationshipTypeInput } from '../../composables/useRelationshipTypes'
import type { Strength } from '../../types/relationship-type'

const { all, create, update, softDelete, restore, reorder } = useRelationshipTypes()

const STRENGTH_OPTIONS: { value: Strength; text: string }[] = [
  { value: 'strong', text: '强' },
  { value: 'medium', text: '中' },
  { value: 'weak', text: '弱' }
]

function strengthText(s: Strength): string {
  return STRENGTH_OPTIONS.find(o => o.value === s)?.text ?? '中'
}

interface EditState {
  type: string
  /** 编辑态下始终是 string（v-model 需要），空串代表 null */
  inverse: string
  label: string
  inverseLabel: string
  description: string
  color: string
  group: 'family' | 'work' | 'concept' | 'action' | 'custom'
  strength: Strength
  /** null 表示新增；string 表示编辑的记录 id */
  originalId: string | null
  isNew: boolean
}

const editingKey = ref<string | null>(null)
const editState = ref<EditState | null>(null)

const showDeleted = ref(false)
const deletedItems = computed(() => all.value.filter(r => r.deleted))
const activeItems = computed(() => all.value.filter(r => !r.deleted))

interface Toast {
  id: string
  recordId: string
}
const toasts = ref<Toast[]>([])

function startEdit(id: string): void {
  const r = all.value.find(x => x.id === id)
  if (!r) return
  editingKey.value = id
  editState.value = {
    type: r.type,
    inverse: r.inverse ?? '',
    label: r.label,
    inverseLabel: r.inverseLabel,
    description: r.description ?? '',
    color: r.color,
    group: r.group,
    strength: r.strength,
    originalId: id,
    isNew: false
  }
}

function startNew(): void {
  editingKey.value = `temp_new_${Date.now()}`
  editState.value = {
    type: '',
    inverse: '',
    label: '',
    inverseLabel: '',
    description: '',
    color: '#1890ff',
    group: 'custom',
    strength: 'medium',
    originalId: null,
    isNew: true
  }
}

function cancelEdit(): void {
  editingKey.value = null
  editState.value = null
}

const validateResult = computed<string | null>(() => {
  if (!editState.value) return null
  return validateRelationshipTypeInput(
    {
      type: editState.value.type,
      inverse: editState.value.inverse.trim() || null,
      label: editState.value.label,
      inverseLabel: editState.value.inverseLabel,
      description: editState.value.description || null,
      color: editState.value.color,
      group: editState.value.group,
      strength: editState.value.strength
    },
    all.value
      .filter(r => r.id !== editState.value?.originalId)
      .map(r => ({ type: r.type, deleted: r.deleted }))
  )
})

const canSave = computed(() => validateResult.value === null)

async function saveEdit(): Promise<void> {
  if (!editState.value || !canSave.value) return
  const s = editState.value
  const input: RelationshipTypeInput = {
    type: s.type,
    inverse: s.inverse.trim() || null,
    label: s.label.trim(),
    inverseLabel: s.inverseLabel.trim(),
    description: s.description || null,
    color: s.color,
    group: s.group,
    strength: s.strength
  }
  if (s.isNew) {
    await create(input)
  } else {
    await update(s.originalId!, input)
  }
  cancelEdit()
}

function onDelete(id: string): void {
  const toast: Toast = { id: `t_${Date.now()}_${Math.random()}`, recordId: id }
  toasts.value = [...toasts.value, toast]
  softDelete(id)
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== toast.id)
  }, 5000)
}

function onUndo(recordId: string): void {
  restore(recordId)
  toasts.value = toasts.value.filter(t => t.recordId !== recordId)
}

function moveUp(id: string): void {
  const list = activeItems.value
  const idx = list.findIndex(r => r.id === id)
  if (idx <= 0) return
  const newOrder = [...list]
  ;[newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]]
  reorder(newOrder.map(r => r.id))
}

function moveDown(id: string): void {
  const list = activeItems.value
  const idx = list.findIndex(r => r.id === id)
  if (idx < 0 || idx >= list.length - 1) return
  const newOrder = [...list]
  ;[newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]]
  reorder(newOrder.map(r => r.id))
}
</script>

<template>
  <div class="rel-types-panel">
    <div class="rel-list">
      <div
        v-for="(r, idx) in activeItems"
        :key="r.id"
        class="rel-row"
        :class="{ 'rel-row--editing': editingKey === r.id }"
      >
        <template v-if="editingKey === r.id && editState && !editState.isNew">
          <div class="rel-edit-grid">
            <input v-model="editState.type" class="rel-input" placeholder="type (英文)" />
            <input v-model="editState.inverse" class="rel-input" placeholder="inverse (可空)" />
            <input v-model="editState.label" class="rel-input" placeholder="正向中文标签" />
            <input v-model="editState.inverseLabel" class="rel-input" placeholder="反向中文标签" />
            <select v-model="editState.strength" class="rel-input rel-input--strength" title="强度等级">
              <option v-for="o in STRENGTH_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
            </select>
            <input v-model="editState.color" class="rel-input rel-input--color" placeholder="#hex" />
            <div class="rel-edit-actions">
              <button class="rel-btn rel-btn--primary" :disabled="!canSave" @click="saveEdit">
                <Check :size="12" :stroke-width="2" /> 保存
              </button>
              <button class="rel-btn" @click="cancelEdit">
                <X :size="12" :stroke-width="2" /> 取消
              </button>
            </div>
          </div>
          <div v-if="!canSave" class="rel-error">{{ validateResult }}</div>
        </template>

        <template v-else>
          <div class="rel-sort">
            <button class="rel-icon-btn" :disabled="idx === 0" title="上移" @click="moveUp(r.id)">
              <ArrowUp :size="12" :stroke-width="1.75" />
            </button>
            <button class="rel-icon-btn" :disabled="idx === activeItems.length - 1" title="下移" @click="moveDown(r.id)">
              <ArrowDown :size="12" :stroke-width="1.75" />
            </button>
          </div>
          <div class="rel-labels">
            <span class="rel-label">{{ r.label }}</span>
            <span class="rel-sep">/</span>
            <span class="rel-label">{{ r.inverseLabel }}</span>
          </div>
          <span class="rel-strength-badge" :class="`rel-strength-badge--${r.strength}`" :title="`强度：${strengthText(r.strength)}`">{{ strengthText(r.strength) }}</span>
          <div class="rel-color-block" :style="{ background: r.color }" :title="r.color"></div>
          <div class="rel-actions">
            <button class="rel-icon-btn" title="编辑" @click="startEdit(r.id)">
              <Pencil :size="12" :stroke-width="1.75" />
            </button>
            <button class="rel-icon-btn" title="删除" @click="onDelete(r.id)">
              <Trash2 :size="12" :stroke-width="1.75" />
            </button>
          </div>
        </template>
      </div>

      <!-- 新增行（编辑态） -->
      <div v-if="editState?.isNew" class="rel-row rel-row--editing rel-row--new">
        <div class="rel-edit-grid">
          <input v-model="editState.type" class="rel-input" placeholder="type (英文)" />
          <input v-model="editState.inverse" class="rel-input" placeholder="inverse (可空)" />
          <input v-model="editState.label" class="rel-input" placeholder="正向中文标签" />
          <input v-model="editState.inverseLabel" class="rel-input" placeholder="反向中文标签" />
          <select v-model="editState.strength" class="rel-input rel-input--strength" title="强度等级">
            <option v-for="o in STRENGTH_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
          </select>
          <input v-model="editState.color" class="rel-input rel-input--color" placeholder="#hex" />
          <div class="rel-edit-actions">
            <button class="rel-btn rel-btn--primary" :disabled="!canSave" @click="saveEdit">
              <Check :size="12" :stroke-width="2" /> 保存
            </button>
            <button class="rel-btn" @click="cancelEdit">
              <X :size="12" :stroke-width="2" /> 取消
            </button>
          </div>
        </div>
        <div v-if="!canSave" class="rel-error">{{ validateResult }}</div>
      </div>

      <button class="rel-add-btn" @click="startNew">
        <Plus :size="12" :stroke-width="2" />
        新增关系类型
      </button>
    </div>

    <div v-if="deletedItems.length > 0" class="rel-deleted-section">
      <button class="rel-deleted-toggle" @click="showDeleted = !showDeleted">
        <ChevronDown v-if="showDeleted" :size="12" :stroke-width="1.75" />
        <ChevronRight v-else :size="12" :stroke-width="1.75" />
        已删除（{{ deletedItems.length }}）
      </button>
      <div v-if="showDeleted" class="rel-deleted-list">
        <div v-for="r in deletedItems" :key="r.id" class="rel-row rel-row--deleted">
          <div class="rel-labels">
            <span class="rel-label">{{ r.label }}</span>
            <span class="rel-sep">/</span>
            <span class="rel-label">{{ r.inverseLabel }}</span>
          </div>
          <span class="rel-strength-badge" :class="`rel-strength-badge--${r.strength}`">{{ strengthText(r.strength) }}</span>
          <div class="rel-color-block" :style="{ background: r.color }"></div>
          <div class="rel-actions">
            <button class="rel-btn" @click="restore(r.id)">
              <Undo2 :size="12" :stroke-width="1.75" /> 恢复
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="toasts.length > 0" class="rel-toast-area">
      <div v-for="t in toasts" :key="t.id" class="rel-toast">
        已删除
        <button class="rel-toast-undo" @click="onUndo(t.recordId)">撤销</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rel-types-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rel-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
  transition: opacity 150ms ease;
}

.rel-row--editing {
  flex-direction: column;
  align-items: stretch;
}

.rel-row--deleted {
  opacity: 0.5;
}

.rel-row--new {
  background: var(--bg-hover);
}

.rel-sort {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rel-icon-btn {
  width: 22px;
  height: 18px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text-secondary);
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
}

.rel-icon-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.rel-icon-btn:not(:disabled):hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

.rel-labels {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.rel-label {
  color: var(--text-primary);
}

.rel-sep {
  color: var(--text-tertiary);
}

.rel-color-block {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.rel-strength-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 18px;
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.rel-strength-badge--strong {
  border-color: #262626;
  color: #262626;
  font-weight: 600;
}

.rel-strength-badge--medium {
  border-color: var(--text-tertiary);
  color: var(--text-secondary);
}

.rel-strength-badge--weak {
  opacity: 0.6;
}

.rel-actions {
  display: flex;
  gap: 4px;
}

.rel-edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr 56px 90px auto;
  gap: 6px;
  align-items: center;
}

.rel-input {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
  /* 允许 grid 列收缩到内容以下，避免 1fr 列因 input 固有宽度溢出 row */
  min-width: 0;
}

.rel-input:focus {
  outline: none;
  border-color: var(--accent);
}

.rel-input--color {
  font-family: monospace;
}

.rel-input--strength {
  padding: 4px 4px;
  text-align: center;
  cursor: pointer;
}

.rel-edit-actions {
  display: flex;
  gap: 4px;
}

.rel-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: inherit;
}

.rel-btn--primary {
  background: var(--accent);
  color: var(--color-paper);
  border-color: var(--accent);
}

.rel-btn--primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rel-btn:not(:disabled):hover {
  background: var(--bg-active);
}

.rel-error {
  margin-top: 4px;
  font-size: 11px;
  color: #ff4d4f;
}

.rel-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  font-family: inherit;
  align-self: flex-start;
}

.rel-add-btn:hover {
  background: var(--bg-hover);
  border-color: var(--text-tertiary);
}

.rel-deleted-section {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.rel-deleted-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: inherit;
}

.rel-deleted-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.rel-toast-area {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0 0;
}

.rel-toast {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg-active);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
  align-self: flex-start;
}

.rel-toast-undo {
  background: transparent;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  padding: 0;
  text-decoration: underline;
}
</style>
