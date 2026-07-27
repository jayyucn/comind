<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { QrCode, Smartphone, Wifi, Clock, RefreshCw, AlertCircle } from 'lucide-vue-next'
import {
  getSyncQr,
  getPairedDevices,
  unpairDevice,
  triggerFullSync,
} from '../../wasm/client'
import { tauriGetSyncStatusPC } from '../../wasm/tauri-client'
import { useSyncStatus } from '../../composables/useSyncStatus'

const emit = defineEmits<{ (e: 'toast', payload: { message: string; type?: 'info' | 'warning' | 'error' }): void }>()

const { status: pcSyncStatus, refreshNow: refreshPcSync } = useSyncStatus()

// 配对二维码
const qrUrl = ref('')
const qrExpiry = ref(300)
const qrLoading = ref(false)

// 已配对设备列表（DB 记录，含上次同步时间）
const pairedDevices = ref<{ client_id: string; peer_device_name: string; last_sync_at: number; paired_at: number | null }[]>([])
const resyncLoading = ref(false)

let qrTimer: ReturnType<typeof setInterval> | null = null
let qrPollTimer: ReturnType<typeof setInterval> | null = null

function formatTimestamp(t: number): string {
  if (!t) return '-'
  return new Date(t).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function loadPairedDevices() {
  try {
    pairedDevices.value = await getPairedDevices()
  } catch (e) {
    console.error('Failed to load paired devices:', e)
  }
}

async function refreshQr() {
  try {
    qrLoading.value = true
    qrUrl.value = await getSyncQr()
    qrExpiry.value = 300
    if (qrTimer) clearInterval(qrTimer)
    qrTimer = setInterval(() => {
      qrExpiry.value -= 1
      if (qrExpiry.value <= 0) refreshQr()
    }, 1000)
  } catch (e) {
    console.error('Failed to get QR code:', e)
  } finally {
    qrLoading.value = false
  }
}

// 配对轮询：检测到已连接即自动切换为已配对视图 + Toast
async function startPairPoll() {
  if (qrPollTimer) clearInterval(qrPollTimer)
  qrPollTimer = setInterval(async () => {
    try {
      const s = await tauriGetSyncStatusPC()
      if (s.connected && s.peers.length > 0) {
        stopTimers()
        await loadPairedDevices()
        await refreshPcSync()
        emit('toast', { message: `已连接设备 · ${s.peers[0].name}`, type: 'info' })
      }
    } catch {
      /* 忽略轮询错误 */
    }
  }, 1000)
}

function stopTimers() {
  if (qrTimer) clearInterval(qrTimer)
  if (qrPollTimer) clearInterval(qrPollTimer)
  qrTimer = null
  qrPollTimer = null
}

async function handleUnpair(id: string) {
  try {
    await unpairDevice(id)
    await loadPairedDevices()
    await refreshPcSync()
  } catch (e) {
    console.error('Failed to unpair device:', e)
  }
}

async function handleResync() {
  try {
    resyncLoading.value = true
    await triggerFullSync()
  } catch (e) {
    console.error('Failed to trigger full sync:', e)
  } finally {
    resyncLoading.value = false
  }
}

// 未连接时直接展示二维码（无需二次点击）；已连接时展示设备列表
onMounted(async () => {
  await loadPairedDevices()
  if (!pcSyncStatus.value?.connected) {
    await refreshQr()
    await startPairPoll()
  }
})

// 跨状态切换时（如取消配对）重新拉起二维码
watch(
  () => pcSyncStatus.value?.connected,
  async (connected) => {
    if (connected) {
      stopTimers()
    } else {
      await loadPairedDevices()
      await refreshQr()
      await startPairPoll()
    }
  },
)

onUnmounted(stopTimers)
</script>

<template>
  <div class="device-sync-panel">
    <!-- 未连接：直接展示配对二维码 -->
    <div v-if="!pcSyncStatus?.connected" class="device-sync-unpaired">
      <div class="qr-code-container">
        <div class="qr-code">
          <img v-if="qrUrl" :src="`data:image/png;base64,${qrUrl}`" alt="配对二维码" />
          <div v-else class="qr-code-loading">生成中…</div>
        </div>
        <div class="qr-code-expiry">
          <Clock :size="12" :stroke-width="1.75" />
          <span>二维码将在 {{ Math.floor(qrExpiry / 60) }}:{{ String(qrExpiry % 60).padStart(2, '0') }} 后过期</span>
        </div>
      </div>
      <button class="device-sync-regenerate" :disabled="qrLoading" @click="refreshQr">
        <QrCode :size="13" :stroke-width="1.75" />
        重新生成二维码
      </button>
      <div class="device-sync-note">
        <Smartphone :size="12" :stroke-width="1.75" />
        <span>在移动端打开扫码功能，扫描上方二维码完成配对</span>
      </div>
    </div>

    <!-- 已连接：状态 + 设备列表 -->
    <div v-else class="device-sync-paired">
      <div class="paired-device-header">
        <div class="paired-device-status">
          <Wifi :size="14" :stroke-width="1.75" class="paired-status-icon" />
          <span>已配对{{ pcSyncStatus.peers[0]?.name ? ' · ' + pcSyncStatus.peers[0].name : '' }}</span>
        </div>
        <button class="device-sync-resync-btn" :disabled="resyncLoading" @click="handleResync">
          <RefreshCw :size="12" :stroke-width="1.75" :class="{ spinning: resyncLoading }" />
          重新同步
        </button>
      </div>
      <div class="paired-device-list">
        <div v-for="device in pairedDevices" :key="device.client_id" class="paired-device-item">
          <div class="paired-device-info">
            <Smartphone :size="14" :stroke-width="1.75" />
            <span class="paired-device-name">{{ device.peer_device_name }}</span>
          </div>
          <div class="paired-device-meta">
            <div class="paired-device-time">
              <Clock :size="10" :stroke-width="1.75" />
              <span>{{ formatTimestamp(device.last_sync_at) }}</span>
            </div>
            <button class="paired-device-unpair-btn" @click="handleUnpair(device.client_id)">
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
</template>

<style scoped>
.device-sync-panel {
  position: relative;
}

.device-sync-unpaired {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}

.qr-code-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.qr-code {
  width: 176px;
  height: 176px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  box-sizing: border-box;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qr-code img {
  width: 100%;
  height: 100%;
  display: block;
}

.qr-code-loading {
  font-size: 12px;
  color: var(--text-tertiary);
}

.qr-code-expiry {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.device-sync-regenerate {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 160ms ease;
}

.device-sync-regenerate:hover:not(:disabled) {
  border-color: var(--accent);
}

.device-sync-regenerate:disabled {
  opacity: 0.6;
  cursor: default;
}

.device-sync-note {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.4;
  text-align: center;
}

.paired-device-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.paired-device-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  min-width: 0;
}

.paired-status-icon {
  color: #22c55e;
}

.device-sync-resync-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.device-sync-resync-btn:hover:not(:disabled) {
  border-color: var(--accent, #6366f1);
}

.device-sync-resync-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.paired-device-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.paired-device-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-hover);
  border: 1px solid var(--border);

  .paired-device-info {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
}

.paired-device-name {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.paired-device-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.paired-device-time {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.paired-device-unpair-btn {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.paired-device-unpair-btn:hover {
  border-color: var(--error);
  color: var(--error);
}

.device-sync-paired-note {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>