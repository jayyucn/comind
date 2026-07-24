<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useSettingsModal } from '../../composables/useSettingsModal'
import { pushModal, popModal } from '../../composables/useModalKeyboard'
import { useTheme } from '../../composables/useTheme'
import RelationshipTypesPanel from './RelationshipTypesPanel.vue'
import { getDbPath, setDbPath, resetDbPath, exportToMarkdown, importFromMarkdown, getSyncConfig, setSyncConfig, syncNow, getSyncQr, getPairedDevices, unpairDevice, triggerFullSync } from '../../wasm/client'
import { isTauriEnvironment, tauriPickDirectory } from '../../wasm/tauri-client'
import { X, Sun, Moon, Monitor, Folder, RotateCcw, AlertCircle, Upload, Download, RefreshCw, ToggleLeft, ToggleRight, Smartphone, QrCode, Clock, Wifi } from 'lucide-vue-next'
import { useNotificationStore } from '../../stores/notification'

const { isOpen, close } = useSettingsModal()

watch(isOpen, (visible) => {
  if (visible) {
    pushModal('settings-modal')
  } else {
    popModal('settings-modal')
  }
})

onUnmounted(() => popModal('settings-modal'))
const { theme, setTheme } = useTheme()
const notificationStore = useNotificationStore()

type Section = 'appearance' | 'editor' | 'data' | 'notifications' | 'about'

const activeSection = ref<Section>('appearance')

const dbPath = ref('')
const customDbPath = ref('')
const showDbPathInput = ref(false)
const isDesktop = isTauriEnvironment()

const syncEnabled = ref(false)
const syncDirectory = ref('')
const syncInterval = ref(5)
const showSyncDirectoryInput = ref(false)

const exportLoading = ref(false)
const importLoading = ref(false)
const syncLoading = ref(false)

const showDeviceSyncQr = ref(false)
const qrUrl = ref('')
const qrExpiryCountdown = ref(300)
const pairedDevices = ref<{ client_id: string; peer_device_name: string; last_sync_at: number; paired_at: number | null }[]>([])
const deviceSyncLoading = ref(false)
const isPaired = ref(false)

let qrTimer: ReturnType<typeof setInterval> | null = null

async function loadDbPath() {
  if (!isDesktop) return
  try {
    dbPath.value = await getDbPath()
  } catch (e) {
    console.error('Failed to load database path:', e)
  }
}

async function loadSyncConfig() {
  if (!isDesktop) return
  try {
    const config = await getSyncConfig()
    syncEnabled.value = config.sync_enabled
    syncDirectory.value = config.sync_directory || ''
    syncInterval.value = config.sync_interval_secs / 60
  } catch (e) {
    console.error('Failed to load sync config:', e)
  }
}

async function handleSetDbPath() {
  if (!customDbPath.value.trim()) return
  try {
    await setDbPath(customDbPath.value.trim())
    dbPath.value = customDbPath.value.trim()
    showDbPathInput.value = false
    customDbPath.value = ''
  } catch (e) {
    console.error('Failed to set database path:', e)
  }
}

async function handleResetDbPath() {
  try {
    await resetDbPath()
    dbPath.value = await getDbPath()
    showDbPathInput.value = false
  } catch (e) {
    console.error('Failed to reset database path:', e)
  }
}

async function handlePickDirectory() {
  try {
    const selected = await tauriPickDirectory()
    if (selected) {
      customDbPath.value = selected
      showDbPathInput.value = true
    }
  } catch (e) {
    console.error('Failed to pick directory:', e)
  }
}

async function handlePickSyncDirectory() {
  try {
    const selected = await tauriPickDirectory()
    if (selected) {
      syncDirectory.value = selected
      showSyncDirectoryInput.value = false
      await setSyncConfig(syncEnabled.value, selected, syncInterval.value * 60)
    }
  } catch (e) {
    console.error('Failed to pick sync directory:', e)
  }
}

async function handleSetSyncDirectory() {
  if (!syncDirectory.value.trim()) return
  try {
    await setSyncConfig(syncEnabled.value, syncDirectory.value.trim(), syncInterval.value * 60)
    showSyncDirectoryInput.value = false
  } catch (e) {
    console.error('Failed to set sync directory:', e)
  }
}

async function handleToggleSync() {
  try {
    syncEnabled.value = !syncEnabled.value
    await setSyncConfig(syncEnabled.value, syncDirectory.value || undefined, syncInterval.value * 60)
  } catch (e) {
    console.error('Failed to toggle sync:', e)
    syncEnabled.value = !syncEnabled.value
  }
}

async function handleExport() {
  try {
    exportLoading.value = true
    const selected = await tauriPickDirectory()
    if (selected) {
      await exportToMarkdown(selected)
    }
  } catch (e) {
    console.error('Failed to export:', e)
  } finally {
    exportLoading.value = false
  }
}

async function handleImport() {
  try {
    importLoading.value = true
    const selected = await tauriPickDirectory()
    if (selected) {
      await importFromMarkdown(selected, 'merge')
    }
  } catch (e) {
    console.error('Failed to import:', e)
  } finally {
    importLoading.value = false
  }
}

async function handleSyncNow() {
  try {
    syncLoading.value = true
    await syncNow()
  } catch (e) {
    console.error('Failed to sync:', e)
  } finally {
    syncLoading.value = false
  }
}

async function loadPairedDevices() {
  if (!isDesktop) return
  try {
    const devices = await getPairedDevices()
    pairedDevices.value = devices
    isPaired.value = devices.length > 0
  } catch (e) {
    console.error('Failed to load paired devices:', e)
  }
}

async function handleShowQr() {
  try {
    deviceSyncLoading.value = true
    qrUrl.value = await getSyncQr()
    qrExpiryCountdown.value = 300
    showDeviceSyncQr.value = true
    if (qrTimer) clearInterval(qrTimer)
    qrTimer = setInterval(() => {
      qrExpiryCountdown.value -= 1
      if (qrExpiryCountdown.value <= 0) {
        if (qrTimer) clearInterval(qrTimer)
        showDeviceSyncQr.value = false
      }
    }, 1000)
  } catch (e) {
    console.error('Failed to get QR code:', e)
  } finally {
    deviceSyncLoading.value = false
  }
}

function handleCloseQr() {
  showDeviceSyncQr.value = false
  if (qrTimer) clearInterval(qrTimer)
}

async function handleUnpair(deviceId: string) {
  try {
    await unpairDevice(deviceId)
    await loadPairedDevices()
  } catch (e) {
    console.error('Failed to unpair device:', e)
  }
}

async function handleTriggerFullSync() {
  try {
    deviceSyncLoading.value = true
    await triggerFullSync()
  } catch (e) {
    console.error('Failed to trigger full sync:', e)
  } finally {
    deviceSyncLoading.value = false
  }
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

watch(isOpen, async (visible) => {
  if (visible) {
    pushModal('settings-modal')
    await loadDbPath()
    await loadSyncConfig()
    await loadPairedDevices()
  } else {
    popModal('settings-modal')
  }
})

const sections: { key: Section; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'editor', label: '编辑器' },
  { key: 'data', label: '数据管理' },
  { key: 'notifications', label: '通知' },
  { key: 'about', label: '关于' },
]

const themeOptions: { value: 'light' | 'dark' | 'system'; label: string; icon: any }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '暗色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

function handleOverlayClick() {
  close()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="qr-modal">
      <div v-if="showDeviceSyncQr" class="qr-modal-overlay" @click="handleCloseQr">
        <div class="qr-modal" @click.stop>
          <div class="qr-modal-header">
            <span class="qr-modal-title">设备配对</span>
            <button class="qr-modal-close" @click="handleCloseQr">
              <X :size="16" :stroke-width="1.75" />
            </button>
          </div>
          <div class="qr-modal-body">
            <div class="qr-code-container">
              <div class="qr-code">
                <img :src="`data:image/png;base64,${qrUrl}`" alt="配对二维码" />
              </div>
              <div class="qr-code-expiry">
                <Clock :size="12" :stroke-width="1.75" />
                <span>二维码将在 {{ Math.floor(qrExpiryCountdown / 60) }}:{{ String(qrExpiryCountdown % 60).padStart(2, '0') }} 后过期</span>
              </div>
            </div>
            <div class="qr-modal-info">
              <Smartphone :size="16" :stroke-width="1.75" />
              <span>在 Android 端打开扫码功能，扫描上方二维码完成配对</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
    <Transition name="settings-modal">
      <div v-if="isOpen" class="settings-modal-overlay" @click.self="handleOverlayClick">
        <div class="settings-modal">
          <div class="settings-modal-nav">
            <div class="nav-title">设置</div>
            <button
              v-for="section in sections"
              :key="section.key"
              class="nav-item"
              :class="{ active: activeSection === section.key }"
              @click="activeSection = section.key"
            >
              {{ section.label }}
            </button>
          </div>

          <div class="settings-modal-content">
            <div class="content-header">
              <h2 class="content-title">{{ sections.find(s => s.key === activeSection)?.label }}</h2>
              <button class="close-btn" @click="close">
                <X :size="16" :stroke-width="1.75" />
              </button>
            </div>

            <div class="content-body">
              <template v-if="activeSection === 'appearance'">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">主题</span>
                    <span class="setting-desc">选择应用主题</span>
                  </div>
                  <div class="theme-selector">
                    <button
                      v-for="option in themeOptions"
                      :key="option.value"
                      class="theme-option"
                      :class="{ active: theme === option.value }"
                      @click="setTheme(option.value)"
                    >
                      <component :is="option.icon" :size="14" :stroke-width="1.75" />
                      {{ option.label }}
                    </button>
                  </div>
                </div>
              </template>

              <template v-if="activeSection === 'editor'">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">字体大小</span>
                    <span class="setting-desc">调整编辑器字体大小（即将推出）</span>
                  </div>
                  <span class="setting-value">默认</span>
                </div>
                <div class="setting-item setting-item--column">
                  <div class="setting-info">
                    <span class="setting-label">关系类型</span>
                    <span class="setting-desc">管理编辑时 <code>^</code> 触发的关系菜单中显示的关系类型</span>
                  </div>
                  <RelationshipTypesPanel />
                </div>
              </template>

              <template v-if="activeSection === 'data'">
                <div v-if="isDesktop" class="setting-item setting-item--column">
                  <div class="setting-info">
                    <span class="setting-label">数据库位置</span>
                    <span class="setting-desc">当前数据库文件所在目录</span>
                  </div>
                  <div class="db-path-container">
                    <div class="db-path-display">
                      <Folder :size="14" :stroke-width="1.75" />
                      <span class="db-path-text">{{ dbPath || '加载中...' }}</span>
                    </div>
                    <div v-if="!showDbPathInput" class="db-path-actions">
                      <button class="db-path-btn db-path-btn--secondary" @click="showDbPathInput = true">
                        更改路径
                      </button>
                      <button class="db-path-btn db-path-btn--secondary" @click="handleResetDbPath">
                        <RotateCcw :size="12" :stroke-width="1.75" />
                        恢复默认
                      </button>
                    </div>
                    <div v-else class="db-path-input-container">
                      <input
                        v-model="customDbPath"
                        type="text"
                        class="db-path-input"
                        placeholder="输入新的数据库目录路径"
                        @keydown.enter="handleSetDbPath"
                      />
                      <button class="db-path-btn" @click="handlePickDirectory">
                        <Folder :size="12" :stroke-width="1.75" />
                      </button>
                      <button class="db-path-btn" @click="handleSetDbPath">确定</button>
                      <button class="db-path-btn db-path-btn--secondary" @click="showDbPathInput = false">取消</button>
                    </div>
                  </div>
                  <div class="db-path-note">
                    <AlertCircle :size="12" :stroke-width="1.75" />
                    <span>更改路径后需要重启应用生效</span>
                  </div>
                </div>
                <div v-if="!isDesktop" class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">数据库位置</span>
                    <span class="setting-desc">Web 版本使用浏览器 IndexedDB</span>
                  </div>
                  <span class="setting-value">IndexedDB</span>
                </div>
                <div v-if="isDesktop" class="setting-item setting-item--column">
                  <div class="setting-info">
                    <span class="setting-label">自动同步</span>
                    <span class="setting-desc">将数据自动同步到 Markdown 文件，切换设备时保持一致</span>
                  </div>
                  <div class="sync-container">
                    <button class="sync-toggle" @click="handleToggleSync">
                      <ToggleLeft v-if="!syncEnabled" :size="16" :stroke-width="1.75" />
                      <ToggleRight v-else :size="16" :stroke-width="1.75" />
                      <span>{{ syncEnabled ? '已开启' : '已关闭' }}</span>
                    </button>
                    <div v-if="syncEnabled" class="sync-options">
                      <div class="sync-directory">
                        <div v-if="!showSyncDirectoryInput" class="sync-directory-display">
                          <Folder :size="12" :stroke-width="1.75" />
                          <span>{{ syncDirectory || '未设置目录' }}</span>
                          <button class="sync-pick-btn" @click="showSyncDirectoryInput = true">选择</button>
                        </div>
                        <div v-else class="sync-directory-input">
                          <input
                            v-model="syncDirectory"
                            type="text"
                            class="sync-input"
                            placeholder="输入同步目录路径"
                            @keydown.enter="handleSetSyncDirectory"
                          />
                          <button class="sync-input-btn" @click="handlePickSyncDirectory">
                            <Folder :size="12" :stroke-width="1.75" />
                          </button>
                          <button class="sync-input-btn" @click="handleSetSyncDirectory">确定</button>
                          <button class="sync-input-btn sync-input-btn--secondary" @click="showSyncDirectoryInput = false">取消</button>
                        </div>
                      </div>
                      <div class="sync-interval">
                        <span>同步间隔</span>
                        <input
                          v-model.number="syncInterval"
                          type="number"
                          min="1"
                          max="60"
                          class="sync-interval-input"
                          @change="setSyncConfig(syncEnabled, syncDirectory || undefined, syncInterval * 60)"
                        />
                        <span>分钟</span>
                      </div>
                      <button class="sync-now-btn" :disabled="syncLoading" @click="handleSyncNow">
                        <RefreshCw :size="12" :stroke-width="1.75" :class="{ spinning: syncLoading }" />
                        {{ syncLoading ? '同步中...' : '立即同步' }}
                      </button>
                    </div>
                  </div>
                  <div class="sync-note">
                    <AlertCircle :size="12" :stroke-width="1.75" />
                    <span>开启后会定时将数据导出到指定目录的 Markdown 文件</span>
                  </div>
                </div>
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">导出数据</span>
                    <span class="setting-desc">将所有页面和块导出为 Markdown 文件</span>
                  </div>
                  <button class="setting-btn" :disabled="!isDesktop || exportLoading" @click="handleExport">
                    <Download :size="12" :stroke-width="1.75" />
                    {{ exportLoading ? '导出中...' : '导出' }}
                  </button>
                </div>
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">导入数据</span>
                    <span class="setting-desc">从 Markdown 文件导入数据（合并模式）</span>
                  </div>
                  <button class="setting-btn" :disabled="!isDesktop || importLoading" @click="handleImport">
                    <Upload :size="12" :stroke-width="1.75" />
                    {{ importLoading ? '导入中...' : '导入' }}
                  </button>
                </div>
                <div v-if="isDesktop" class="setting-item setting-item--column">
                  <div class="setting-info">
                    <span class="setting-label">设备同步</span>
                    <span class="setting-desc">与 Android 设备通过局域网直连同步数据</span>
                  </div>
                  <div class="device-sync-container">
                    <div v-if="!isPaired" class="device-sync-unpaired">
                      <button 
                        class="device-sync-qr-btn" 
                        :disabled="deviceSyncLoading" 
                        @click="handleShowQr"
                      >
                        <QrCode :size="14" :stroke-width="1.75" />
                        {{ deviceSyncLoading ? '生成中...' : '显示配对二维码' }}
                      </button>
                      <div class="device-sync-note">
                        <Smartphone :size="12" :stroke-width="1.75" />
                        <span>在 Android 端打开扫码功能，扫描二维码完成配对</span>
                      </div>
                    </div>
                    <div v-else class="device-sync-paired">
                      <div class="paired-device-header">
                        <div class="paired-device-status">
                          <Wifi :size="14" :stroke-width="1.75" class="paired-status-icon" />
                          <span>已配对</span>
                        </div>
                        <button 
                          class="device-sync-resync-btn" 
                          :disabled="deviceSyncLoading" 
                          @click="handleTriggerFullSync"
                        >
                          <RefreshCw :size="12" :stroke-width="1.75" :class="{ spinning: deviceSyncLoading }" />
                          重新同步
                        </button>
                      </div>
                      <div class="paired-device-list">
                        <div 
                          v-for="device in pairedDevices" 
                          :key="device.client_id" 
                          class="paired-device-item"
                        >
                          <div class="paired-device-info">
                            <Smartphone :size="14" :stroke-width="1.75" />
                            <span class="paired-device-name">{{ device.peer_device_name }}</span>
                          </div>
                          <div class="paired-device-meta">
                            <div class="paired-device-time">
                              <Clock :size="10" :stroke-width="1.75" />
                              <span>{{ formatTimestamp(device.last_sync_at) }}</span>
                            </div>
                            <button 
                              class="paired-device-unpair-btn" 
                              @click="handleUnpair(device.client_id)"
                            >
                              取消配对
                            </button>
                          </div>
                        </div>
                      </div>
                      <div class="device-sync-paired-note">
                        <AlertCircle :size="12" :stroke-width="1.75" />
                        <span>MVP 版本仅支持配对一台设备</span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <template v-if="activeSection === 'notifications'">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">通知总开关</span>
                    <span class="setting-desc">启用或禁用所有通知</span>
                  </div>
                  <button class="sync-toggle" @click="notificationStore.toggleSetting('enabled')">
                    <ToggleLeft v-if="!notificationStore.settings.enabled" :size="16" :stroke-width="1.75" />
                    <ToggleRight v-else :size="16" :stroke-width="1.75" />
                    <span>{{ notificationStore.settings.enabled ? '已开启' : '已关闭' }}</span>
                  </button>
                </div>

                <div v-if="notificationStore.settings.enabled" class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">计划时间通知</span>
                    <span class="setting-desc">接收计划时间提醒</span>
                  </div>
                  <button class="sync-toggle" @click="notificationStore.toggleSetting('schedule_enabled')">
                    <ToggleLeft v-if="!notificationStore.settings.schedule_enabled" :size="16" :stroke-width="1.75" />
                    <ToggleRight v-else :size="16" :stroke-width="1.75" />
                    <span>{{ notificationStore.settings.schedule_enabled ? '已开启' : '已关闭' }}</span>
                  </button>
                </div>

                <div v-if="notificationStore.settings.enabled" class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">截止时间通知</span>
                    <span class="setting-desc">接收截止时间提醒</span>
                  </div>
                  <button class="sync-toggle" @click="notificationStore.toggleSetting('deadline_enabled')">
                    <ToggleLeft v-if="!notificationStore.settings.deadline_enabled" :size="16" :stroke-width="1.75" />
                    <ToggleRight v-else :size="16" :stroke-width="1.75" />
                    <span>{{ notificationStore.settings.deadline_enabled ? '已开启' : '已关闭' }}</span>
                  </button>
                </div>

                <div v-if="notificationStore.settings.enabled" class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">逾期通知</span>
                    <span class="setting-desc">接收逾期任务提醒</span>
                  </div>
                  <button class="sync-toggle" @click="notificationStore.toggleSetting('overdue_enabled')">
                    <ToggleLeft v-if="!notificationStore.settings.overdue_enabled" :size="16" :stroke-width="1.75" />
                    <ToggleRight v-else :size="16" :stroke-width="1.75" />
                    <span>{{ notificationStore.settings.overdue_enabled ? '已开启' : '已关闭' }}</span>
                  </button>
                </div>

                <div v-if="notificationStore.settings.enabled" class="setting-item setting-item--column">
                  <div class="setting-info">
                    <span class="setting-label">免打扰时段</span>
                    <span class="setting-desc">在此期间不发送通知</span>
                  </div>
                  <div class="quiet-hours-container">
                    <div class="quiet-hours-row">
                      <span class="quiet-hours-label">开始时间</span>
                      <select
                        :value="notificationStore.settings.quiet_hours_start || '22:00'"
                        @change="notificationStore.updateSetting('quiet_hours_start', ($event.target as HTMLSelectElement).value)"
                        class="quiet-hours-select"
                      >
                        <option v-for="h in 24" :key="`${h-1}:00`" :value="`${String(h-1).padStart(2, '0')}:00`">
                          {{ String(h-1).padStart(2, '0') }}:00
                        </option>
                      </select>
                    </div>
                    <div class="quiet-hours-row">
                      <span class="quiet-hours-label">结束时间</span>
                      <select
                        :value="notificationStore.settings.quiet_hours_end || '08:00'"
                        @change="notificationStore.updateSetting('quiet_hours_end', ($event.target as HTMLSelectElement).value)"
                        class="quiet-hours-select"
                      >
                        <option v-for="h in 24" :key="`${h-1}:00`" :value="`${String(h-1).padStart(2, '0')}:00`">
                          {{ String(h-1).padStart(2, '0') }}:00
                        </option>
                      </select>
                    </div>
                  </div>
                </div>

                <div v-if="notificationStore.settings.enabled && !isDesktop" class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">浏览器通知</span>
                    <span class="setting-desc">在浏览器中显示通知</span>
                  </div>
                  <button class="sync-toggle" @click="notificationStore.toggleSetting('web_browser_notifications_enabled')">
                    <ToggleLeft v-if="!notificationStore.settings.web_browser_notifications_enabled" :size="16" :stroke-width="1.75" />
                    <ToggleRight v-else :size="16" :stroke-width="1.75" />
                    <span>{{ notificationStore.settings.web_browser_notifications_enabled ? '已开启' : '已关闭' }}</span>
                  </button>
                </div>
              </template>

              <template v-if="activeSection === 'about'">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">版本</span>
                    <span class="setting-desc">comind v0.1.0</span>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.settings-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.settings-modal {
  width: 960px;
  max-height: 85vh;
  min-height: 600px;
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: var(--shadow-modal);
  display: flex;
  overflow: hidden;
}

.settings-modal-nav {
  width: 180px;
  flex-shrink: 0;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 12px;
  padding: 0 10px;
}

.nav-item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  font-family: inherit;
  text-align: left;
  transition: background 80ms ease, color 80ms ease;
}

.nav-item:hover {
  background: var(--bg-hover);
}

.nav-item.active {
  background: var(--bg-active);
  font-weight: 500;
  color: var(--text-primary);
}

.settings-modal-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.content-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--text-tertiary);
  transition: background 80ms ease, color 80ms ease;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.content-body {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.setting-item--column {
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.setting-desc {
  font-size: 11px;
  color: var(--text-tertiary);
}

.setting-value {
  font-size: 13px;
  color: var(--text-secondary);
}

.setting-btn {
  padding: 6px 16px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: not-allowed;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: inherit;
}

.setting-btn:not(:disabled) {
  cursor: pointer;
  color: var(--text-secondary);
}

.setting-btn:not(:disabled):hover {
  background: var(--bg-active);
}

.theme-selector {
  display: flex;
  gap: 4px;
  background: var(--bg-hover);
  border-radius: 6px;
  padding: 2px;
}

.theme-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
  font-family: inherit;
  transition: background 80ms ease, color 80ms ease;
}

.theme-option:hover {
  color: var(--text-secondary);
}

.theme-option.active {
  background: var(--bg-base);
  color: var(--text-primary);
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.settings-modal-enter-active,
.settings-modal-leave-active {
  transition: opacity 180ms ease;
}

.settings-modal-enter-active .settings-modal,
.settings-modal-leave-active .settings-modal {
  transition: transform 180ms ease;
}

.settings-modal-enter-from,
.settings-modal-leave-to {
  opacity: 0;
}

.settings-modal-enter-from .settings-modal {
  transform: translateY(8px);
}

.db-path-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.db-path-display {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-hover);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  word-break: break-all;
}

.db-path-text {
  flex: 1;
  font-family: monospace;
}

.db-path-actions {
  display: flex;
  gap: 8px;
}

.db-path-input-container {
  display: flex;
  gap: 8px;
}

.db-path-input {
  flex: 1;
  padding: 8px 12px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  font-family: monospace;
  color: var(--text-primary);
  outline: none;
}

.db-path-input:focus {
  border-color: var(--accent);
}

.db-path-btn {
  padding: 6px 12px;
  background: var(--bg-active);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: background 80ms ease;
}

.db-path-btn:hover {
  background: var(--bg-hover);
}

.db-path-btn--secondary {
  background: transparent;
  color: var(--text-tertiary);
}

.db-path-btn--secondary:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.db-path-note {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  padding-top: 4px;
}

.sync-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sync-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  font-family: inherit;
  align-self: flex-start;
  transition: background 80ms ease;
}

.sync-toggle:hover {
  background: var(--bg-active);
}

.sync-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-left: 20px;
  border-left: 1px solid var(--border);
}

.sync-directory {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sync-directory-display {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-hover);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.sync-pick-btn {
  margin-left: auto;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: inherit;
}

.sync-pick-btn:hover {
  background: var(--bg-active);
  color: var(--text-secondary);
}

.sync-directory-input {
  display: flex;
  gap: 8px;
}

.sync-input {
  flex: 1;
  padding: 6px 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  font-family: monospace;
  color: var(--text-primary);
  outline: none;
}

.sync-input:focus {
  border-color: var(--accent);
}

.sync-input-btn {
  padding: 6px 10px;
  background: var(--bg-active);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.sync-input-btn:hover {
  background: var(--bg-hover);
}

.sync-input-btn--secondary {
  background: transparent;
  color: var(--text-tertiary);
}

.sync-interval {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.sync-interval-input {
  width: 60px;
  padding: 4px 8px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-primary);
  text-align: center;
  outline: none;
}

.sync-interval-input:focus {
  border-color: var(--accent);
}

.sync-now-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--accent);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  color: white;
  font-family: inherit;
  align-self: flex-start;
}

.sync-now-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.sync-now-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sync-note {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  padding-top: 4px;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.quiet-hours-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.quiet-hours-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.quiet-hours-label {
  font-size: 12px;
  color: var(--text-tertiary);
  width: 60px;
  flex-shrink: 0;
}

.quiet-hours-select {
  padding: 6px 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-primary);
  font-family: inherit;
  cursor: pointer;
  min-width: 80px;
}

.quiet-hours-select:focus {
  border-color: var(--accent);
  outline: none;
}

@media (max-width: 768px) {
  .settings-modal {
    width: 95vw;
    flex-direction: column;
  }

  .settings-modal-nav {
    width: 100%;
    flex-direction: row;
    border-right: none;
    border-bottom: 1px solid var(--border);
    padding: 12px;
    overflow-x: auto;
  }

  .nav-title {
    display: none;
  }
}

.device-sync-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.device-sync-unpaired {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.device-sync-qr-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--accent);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: white;
  font-family: inherit;
  align-self: flex-start;
  transition: opacity 80ms ease;
}

.device-sync-qr-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.device-sync-qr-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.device-sync-note {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.device-sync-paired {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: var(--bg-hover);
  border-radius: 6px;
}

.paired-device-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.paired-device-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

.paired-status-icon {
  color: #22c55e;
}

.device-sync-resync-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-active);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: inherit;
  transition: background 80ms ease;
}

.device-sync-resync-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.device-sync-resync-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.paired-device-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.paired-device-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.paired-device-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.paired-device-name {
  font-size: 13px;
  color: var(--text-primary);
}

.paired-device-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.paired-device-time {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.paired-device-unpair-btn {
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: inherit;
  transition: background 80ms ease, color 80ms ease;
}

.paired-device-unpair-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.device-sync-paired-note {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  padding-top: 4px;
}

.qr-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.qr-modal {
  width: 360px;
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

.qr-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.qr-modal-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.qr-modal-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--text-tertiary);
  transition: background 80ms ease, color 80ms ease;
}

.qr-modal-close:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.qr-modal-body {
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.qr-code-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.qr-code {
  width: 200px;
  height: 200px;
  padding: 12px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.qr-code img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.qr-code-expiry {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.qr-modal-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  padding-top: 8px;
}

.qr-modal-enter-active,
.qr-modal-leave-active {
  transition: opacity 180ms ease;
}

.qr-modal-enter-active .qr-modal,
.qr-modal-leave-active .qr-modal {
  transition: transform 180ms ease;
}

.qr-modal-enter-from,
.qr-modal-leave-to {
  opacity: 0;
}

.qr-modal-enter-from .qr-modal {
  transform: scale(0.95);
}
</style>
