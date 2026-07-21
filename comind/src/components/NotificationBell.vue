<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Bell, Check, Clock, Trash2 } from 'lucide-vue-next'
import { useNotificationStore } from '../stores/notification'
import { useNavigateToPage } from '../composables/useNavigateToPage'
import type { Notification } from '../wasm/types'

const notificationStore = useNotificationStore()
const navigateToPage = useNavigateToPage()

const isOpen = ref(false)
const selectedSnooze = ref<Record<string, number>>({})

function toggleDropdown() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    notificationStore.loadNotifications()
  }
}

function closeDropdown() {
  isOpen.value = false
}

function handleNotificationClick(notif: Notification) {
  closeDropdown()
  const payload = notificationStore.parsePayload(notif.payload)
  navigateToPage.navigateToPage(payload.pageId)
  notificationStore.markAsRead(notif.id)
}

function handleMarkAsRead(id: string) {
  notificationStore.markAsRead(id)
}

function handleSnooze(id: string, minutes: number) {
  selectedSnooze.value[id] = minutes
  notificationStore.snooze(id, minutes)
}

function handleDelete(id: string) {
  notificationStore.deleteNotification(id)
}

function handleMarkAllRead() {
  notificationStore.markAllRead()
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'unread':
      return '🟡'
    case 'read':
      return '⚪'
    case 'dismissed':
      return '⚫'
    case 'pending':
      return '🔵'
    default:
      return '⚪'
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - timestamp
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins}分钟前`
  if (diffHours < 24) return `${diffHours}小时前`
  if (diffDays < 7) return `${diffDays}天前`
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function getKindLabel(kind: string): string {
  if (kind === 'deadline') return '截止'
  if (kind === 'overdue') return '逾期'
  return '计划'
}

function getKindColor(kind: string): string {
  if (kind === 'deadline') return 'text-red-500'
  if (kind === 'overdue') return 'text-red-700 font-bold'
  return 'text-blue-500'
}

// 把 payload 里的事件时间（如 "2026-07-20T14:00"）格式化为 "今天 14:00"
function formatEvent(iso: string | undefined): string {
  if (!iso) return ''
  const [datePart, timePart = ''] = iso.split('T')
  const parts = datePart.split('-').map(Number)
  if (parts.length < 3) return iso
  const [y, m, d] = parts
  const eventDate = new Date(y, m - 1, d)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const key = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  let dayLabel: string
  if (key(eventDate) === key(today)) dayLabel = '今天'
  else if (key(eventDate) === key(tomorrow)) dayLabel = '明天'
  else dayLabel = `${m}月${d}日`
  return `${dayLabel} ${timePart}`
}

onMounted(() => {
  notificationStore.loadNotifications()
  notificationStore.loadSettings()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.notification-bell')) {
    closeDropdown()
  }
}
</script>

<template>
  <div v-if="notificationStore.settings.enabled" class="notification-bell relative">
    <button
      class="notification-bell-btn"
      @click="toggleDropdown"
    >
      <Bell :size="18" :stroke-width="2" />
      <span
        v-if="notificationStore.unreadCount > 0"
        class="notification-badge"
      >
        {{ notificationStore.unreadCount > 99 ? '99+' : notificationStore.unreadCount }}
      </span>
    </button>

    <Transition name="dropdown">
      <div
        v-if="isOpen"
        class="notification-dropdown"
      >
        <div class="dropdown-header">
          <h3 class="dropdown-title">通知</h3>
          <button
            v-if="notificationStore.unreadCount > 0"
            class="mark-all-read-btn"
            @click.stop="handleMarkAllRead"
          >
            <Check :size="12" />
            全部已读
          </button>
        </div>

        <div v-if="notificationStore.isLoading" class="dropdown-loading">
          加载中...
        </div>

        <div v-else-if="notificationStore.notifications.length === 0" class="dropdown-empty">
          暂无通知
        </div>

        <div v-else class="dropdown-content">
          <div
            v-for="group in notificationStore.groupedNotifications"
            :key="group.date"
            class="notification-group"
          >
            <div class="group-date">
              {{ group.date === new Date().toDateString() ? '今天' : group.date === new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString() ? '昨天' : (new Date(group.date).getMonth() + 1) + '月' + new Date(group.date).getDate() + '日' }}
            </div>
            <div
              v-for="notif in group.items"
              :key="notif.id"
              class="notification-item"
              :class="{ 'notification-item--unread': notif.status === 'unread' }"
              @click="handleNotificationClick(notif)"
            >
              <div class="notification-status">{{ getStatusIcon(notif.status) }}</div>
              <div class="notification-body">
                <div class="notification-title">
                  {{ notificationStore.parsePayload(notif.payload).blockSnippet || notificationStore.parsePayload(notif.payload).title }}
                </div>
                <div class="notification-meta">
                  <span :class="getKindColor(notif.kind)">{{ getKindLabel(notif.kind) }}</span>
                  <span v-if="notificationStore.parsePayload(notif.payload).pageTitle" class="notification-page">{{ notificationStore.parsePayload(notif.payload).pageTitle }}</span>
                  <span v-if="formatEvent(notificationStore.parsePayload(notif.payload).eventDisplay)" class="notification-time">{{ formatEvent(notificationStore.parsePayload(notif.payload).eventDisplay) }}</span>
                </div>
              </div>
              <div class="notification-actions">
                <button
                  v-if="notif.status === 'unread'"
                  class="action-btn action-btn--read"
                  @click.stop="handleMarkAsRead(notif.id)"
                  title="标记已读"
                >
                  <Check :size="12" />
                </button>
                <button
                  v-if="notif.status !== 'dismissed'"
                  class="action-btn action-btn--snooze"
                    @click.stop
                    title="稍后提醒"
                  >
                    <Clock :size="12" />
                  </button>
                  <div class="snooze-options">
                    <button
                      v-for="[key, value] in Object.entries(notificationStore.SNOOZE_PRESETS)"
                      :key="key"
                      class="snooze-option"
                      @click.stop="handleSnooze(notif.id, value / 60000)"
                    >
                      {{ { '10m': '10分钟', '30m': '30分钟', '1h': '1小时', tomorrow: '明天' }[key] }}
                    </button>
                  </div>
                <button
                  class="action-btn action-btn--delete"
                  @click.stop="handleDelete(notif.id)"
                  title="删除"
                >
                  <Trash2 :size="12" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="dropdown-footer">
          <span class="footer-hint">点击通知跳转到对应内容</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.notification-bell {
  position: relative;
}

.notification-bell-btn {
  position: relative;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  border-radius: 8px;
  padding: 0;
  transition: background 0.12s;
}

.notification-bell-btn:hover {
  background: var(--bg-hover);
}

.notification-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  background: var(--accent);
  color: white;
  font-size: 11px;
  font-weight: 600;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.notification-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 360px;
  max-width: 420px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(28, 25, 23, 0.12);
  z-index: 1000;
  overflow: hidden;
}

.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.dropdown-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.mark-all-read-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  background: var(--accent);
  color: white;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 0.12s;
}

.mark-all-read-btn:hover {
  opacity: 0.9;
}

.dropdown-loading,
.dropdown-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
}

.dropdown-content {
  max-height: 480px;
  overflow-y: auto;
}

.notification-group {
  padding: 8px 0;
}

.group-date {
  padding: 4px 16px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.notification-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.12s;
}

.notification-item:hover {
  background: var(--bg-hover);
}

.notification-item--unread {
  background: rgba(59, 130, 246, 0.05);
}

.notification-status {
  font-size: 10px;
  flex-shrink: 0;
}

.notification-body {
  flex: 1;
  min-width: 0;
}

.notification-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.notification-page {
  padding: 1px 4px;
  background: var(--bg-hover);
  border-radius: 3px;
}

.notification-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.12s;
}

.notification-item:hover .notification-actions {
  opacity: 1;
}

.action-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
  transition: all 0.12s;
}

.action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.action-btn--read:hover {
  color: var(--accent);
}

.action-btn--snooze:hover {
  color: #F59E0B;
}

.action-btn--delete:hover {
  color: #EF4444;
}

.snooze-dropdown {
  position: relative;
}

.snooze-options {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(28, 25, 23, 0.1);
  padding: 4px;
  min-width: 100px;
  z-index: 1001;
  display: none;
}

.snooze-dropdown:hover .snooze-options {
  display: block;
}

.snooze-option {
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.12s;
}

.snooze-option:hover {
  background: var(--bg-hover);
}

.dropdown-footer {
  padding: 8px 16px;
  border-top: 1px solid var(--border);
}

.footer-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
