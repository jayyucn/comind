<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { FileText } from 'lucide-vue-next'
import type { Page } from '../../types/page'
import type { Group } from '../../core/query'

const props = defineProps<{
  pages: Page[]
  groups: Group<Page>[]
}>()

const router = useRouter()
const hasGroups = computed(() => props.groups.length > 0)

const TYPE_BADGE: Record<string, { label: string; class: string }> = {
  normal: { label: '普通', class: 'type-normal' },
  ideas: { label: '灵感', class: 'type-ideas' },
}

function navigateToPage(pageId: string) {
  router.push(`/page/${pageId}`)
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
</script>

<template>
  <div class="page-table-view">
    <!-- 有分组时显示分组头 -->
    <template v-if="hasGroups">
      <div v-for="group in groups" :key="group.key" class="table-group">
        <div class="group-header">
          <span class="group-label">{{ group.label || '全部' }}</span>
          <span class="group-count">{{ group.items.length }}</span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-name">Name</th>
              <th class="col-type">Type</th>
              <th class="col-date">Created</th>
              <th class="col-date">Updated</th>
              <th class="col-num">字数</th>
              <th class="col-num">子页面</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in group.items"
              :key="p.id"
              class="data-row"
              @click="navigateToPage(p.id)"
            >
              <td class="col-name cell-name">
                <FileText :size="14" :stroke-width="1.5" class="row-icon" />
                <span class="name-text">{{ p.title || '(无标题)' }}</span>
              </td>
              <td class="col-type">
                <span
                  v-if="TYPE_BADGE[p.type]"
                  class="type-badge"
                  :class="TYPE_BADGE[p.type].class"
                >{{ TYPE_BADGE[p.type].label }}</span>
                <span v-else class="type-badge type-normal">{{ p.type }}</span>
              </td>
              <td class="col-date cell-mono">{{ formatDate(p.createdAt) }}</td>
              <td class="col-date cell-mono">{{ formatDate(p.updatedAt) }}</td>
              <td class="col-num cell-mono">{{ p.wordCount ?? '-' }}</td>
              <td class="col-num cell-mono">{{ p.childrenCount ?? '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 无分组时平铺 -->
    <template v-else>
      <table class="data-table">
        <thead>
          <tr>
            <th class="col-name">Name</th>
            <th class="col-type">Type</th>
            <th class="col-date">Created</th>
            <th class="col-date">Updated</th>
            <th class="col-num">字数</th>
            <th class="col-num">子页面</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in pages"
            :key="p.id"
            class="data-row"
            @click="navigateToPage(p.id)"
          >
            <td class="col-name cell-name">
              <FileText :size="14" :stroke-width="1.5" class="row-icon" />
              <span class="name-text">{{ p.title || '(无标题)' }}</span>
            </td>
            <td class="col-type">
              <span
                v-if="TYPE_BADGE[p.type]"
                class="type-badge"
                :class="TYPE_BADGE[p.type].class"
              >{{ TYPE_BADGE[p.type].label }}</span>
              <span v-else class="type-badge type-normal">{{ p.type }}</span>
            </td>
            <td class="col-date cell-mono">{{ formatDate(p.createdAt) }}</td>
            <td class="col-date cell-mono">{{ formatDate(p.updatedAt) }}</td>
            <td class="col-num cell-mono">{{ p.wordCount ?? '-' }}</td>
            <td class="col-num cell-mono">{{ p.childrenCount ?? '-' }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- 空状态 -->
    <div v-if="(!hasGroups && pages.length === 0) || (hasGroups && groups.every(g => g.items.length === 0))" class="empty-state">
      <FileText :size="32" :stroke-width="1" class="empty-icon" />
      <p>暂无页面</p>
    </div>
  </div>
</template>

<style scoped>
.page-table-view {
  width: 100%;
  overflow: auto;
}

.table-group {
  margin-bottom: 16px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
  margin-bottom: 4px;
}

.group-count {
  color: var(--text-tertiary);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.data-table thead tr {
  border-bottom: 1px solid var(--border);
}

.data-table th {
  text-align: left;
  padding: 8px 12px;
  font-weight: var(--font-medium);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  white-space: nowrap;
  user-select: none;
}

.data-row {
  cursor: pointer;
  transition: background 80ms ease;
}

.data-row:hover {
  background: var(--bg-hover);
}

.data-row td {
  padding: 0 12px;
  height: 36px;
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 列宽 */
.col-name     { width: 40%; }
.col-type     { width: 90px; }
.col-date     { width: 110px; }
.col-num      { width: 70px; }

/* Name 单元格：图标+文字 */
.cell-name {
  display: flex !important;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
}

.row-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.name-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 等宽字体列 */
.cell-mono {
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

/* Type 彩色标签 */
.type-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: var(--text-xs);
  line-height: 20px;
  font-weight: var(--font-medium);
}

.type-normal {
  background: var(--bg-active);
  color: var(--text-secondary);
}

.type-ideas {
  background: var(--accent-bg, rgba(99, 102, 241, 0.12));
  color: var(--accent, #6366f1);
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--text-tertiary);
  gap: 8px;
}

.empty-icon {
  opacity: 0.3;
}
</style>
