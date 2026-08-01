<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { QrCode, Smartphone, Wifi, WifiOff, Clock, RefreshCw } from 'lucide-vue-next'
import {
  getSyncQr,
  unpairDevice,
  triggerFullSync,
} from '../../wasm/client'
import { tauriGetSyncStatusPC } from '../../wasm/tauri-client'
import { useSyncStatus } from '../../composables/useSyncStatus'

const emit = defineEmits<{ (e: 'toast', payload: { message: string; type?: 'info' | 'warning' | 'error' }): void }>()

const { status: pcSyncStatus, pairedDevices, refreshNow } = useSyncStatus()

// 配对二维码
const qrUrl = ref('')
const qrExpiry = ref(300)
const qrLoading = ref(false)

const resyncLoading = ref(false)

let qrTimer: ReturnType<typeof setInterval> | null = null
let qrPollTimer: ReturnType<typeof setInterval> | null = null

// 派生状态
const isPaired = computed(() => pairedDevices.value.length > 0)
const isOnline = computed(() => !!pcSyncStatus.value?.connected)
// 仅取第一台设备（MVP 只支持一台）
const pairedDevice = computed(() => pairedDevices.value[0] ?? null)
const peerName = computed(() => {
  if (isOnline.value && pcSyncStatus.value?.peers?.[0]?.name) {
    return pcSyncStatus.value.peers[0].name
  }
  return pairedDevice.value?.peer_device_name ?? '未知设备'
})

function formatTimestamp(t: number): string {
  if (!t) return '从未同步'
  return new Date(t).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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

// 配对轮询：检测到已连接即自动切换 + Toast
async function startPairPoll() {
  if (qrPollTimer) clearInterval(qrPollTimer)
  qrPollTimer = setInterval(async () => {
    try {
      const s = await tauriGetSyncStatusPC()
      if (s.connected && s.peers.length > 0) {
        stopTimers()
        await refreshNow()
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

async function handleUnpair() {
  if (!pairedDevice.value) return
  try {
    await unpairDevice(pairedDevice.value.client_id)
    await refreshNow()
    // 取消配对后回到二维码视图
    await refreshQr()
    await startPairPoll()
  } catch (e) {
    console.error('Failed to unpair device:', e)
  }
}

async function handleResync() {
  try {
    resyncLoading.value = true
    await triggerFullSync()
    emit('toast', { message: '已触发全量同步', type: 'info' })
  } catch (e) {
    console.error('Failed to trigger full sync:', e)
    emit('toast', { message: '同步失败', type: 'error' })
  } finally {
    resyncLoading.value = false
  }
}

onMounted(async () => {
  if (!isPaired.value) {
    await refreshQr()
    await startPairPoll()
  }
})

// 配对状态变化时管理二维码轮询
watch(isPaired, async (paired) => {
  if (paired) {
    stopTimers()
  } else {
    await refreshQr()
    await startPairPoll()
  }
})

onUnmounted(stopTimers)
</script>

<template>
  <div class="device-sync-panel">
    <!-- 状态 A：未配对 → 展示配对二维码 -->
    <div v-if="!isPaired" class="device-sync-unpaired">
      <div class="qr-code-container">
        <div class="qr-code">
          <img v-if="qrUrl" :src="`data:image/png;base64,${qrUrl}`" alt="配对二维码" />
          <div v-else class="qr-code-loading">生成中…</div>
        </div>
        <div class="qr-code-expiry">
          <Clock :size="12" :stroke-width="1.75" />
          <span>{{ Math.floor(qrExpiry / 60) }}:{{ String(qrExpiry % 60).padStart(2, '0') }} 后过期</span>
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

    <!-- 状态 B/C：已配对（在线 / 离线）→ 设备卡片 -->
    <div v-else class="device-sync-paired">
      <!-- 设备卡片 -->
      <div class="device-card" :class="{ online: isOnline, offline: !isOnline }">
        <div class="device-card-header">
          <div class="device-card-icon">
            <Smartphone :size="18" :stroke-width="1.75" />
          </div>
          <div class="device-card-info">
            <span class="device-card-name">{{ peerName }}</span>
            <div class="device-card-status">
              <Wifi v-if="isOnline" :size="11" :stroke-width="2" class="status-icon-online" />
              <WifiOff v-else :size="11" :stroke-width="2" class="status-icon-offline" />
              <span :class="isOnline ? 'status-text-online' : 'status-text-offline'">
                {{ isOnline ? '在线' : '离线' }}
              </span>
            </div>
          </div>
        </div>
        <div class="device-card-meta">
          <Clock :size="11" :stroke-width="1.75" />
          <span>上次同步 · {{ formatTimestamp(pairedDevice?.last_sync_at ?? 0) }}</span>
        </div>
      </div>

      <!-- 操作区 -->
      <div class="device-actions">
        <button
          v-if="isOnline"
          class="device-action-btn primary"
          :disabled="resyncLoading"
          @click="handleResync"
        >
          <RefreshCw :size="13" :stroke-width="1.75" :class="{ spinning: resyncLoading }" />
          {{ resyncLoading ? '同步中…' : '重新同步' }}
        </button>
        <button class="device-action-btn danger" @click="handleUnpair">
          取消配对
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.device-sync-panel {
  position: relative;
}

/* ===== 未配对：二维码 ===== */
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
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.qr-code-expiry {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
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
  font-size: var(--text-xs);
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
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  line-height: var(--leading-snug);
  text-align: center;
}

/* ===== 已配对：设备卡片 ===== */
.device-sync-paired {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.device-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
}

.device-card.offline {
  border-color: color-mix(in srgb, var(--warning) 25%, var(--border));
}

.device-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.device-card-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.device-card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.device-card-name {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.device-card-status {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: var(--text-xs);
}

.status-icon-online { color: var(--success); }
.status-icon-offline { color: var(--warning); }
.status-text-online { color: var(--success); }
.status-text-offline { color: var(--warning); }

.device-card-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

/* ===== 操作按钮 ===== */
.device-actions {
  display: flex;
  gap: 8px;
}

.device-action-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: border-color 160ms ease, color 160ms ease, background 160ms ease;
}

.device-action-btn.primary:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.device-action-btn.danger:hover {
  border-color: var(--error);
  color: var(--error);
}

.device-action-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
