<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { QrCode, Wifi, Smartphone, X } from 'lucide-vue-next'
import { useSyncStatus } from '../../composables/useSyncStatus'
import { useEditorStore } from '../../stores/editor'
import { isTauriEnvironment } from '../../wasm/tauri-client'
import DeviceSyncPanel from './DeviceSyncPanel.vue'

const visible = isTauriEnvironment()
const { status, pairedDevices } = useSyncStatus()
const editorStore = useEditorStore()

const open = ref(false)
const dockEl = ref<HTMLElement | null>(null)
const popoverEl = ref<HTMLElement | null>(null)

const isPaired = computed(() => pairedDevices.value.length > 0)
const isOnline = computed(() => !!status.value?.connected)
const dockState = computed(() => {
  if (!isPaired.value) return 'unpaired'
  return isOnline.value ? 'online' : 'offline'
})

const dockTitle = computed(() => {
  switch (dockState.value) {
    case 'online': return '设备已连接 · 点击管理'
    case 'offline': return '设备已配对（离线）· 点击管理'
    default: return '未配对 · 点击扫码'
  }
})

function onToast(payload: { message: string; type?: 'info' | 'warning' | 'error' }) {
  editorStore.showToast(payload.message, payload.type ?? 'info')
}

function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  if (dockEl.value?.contains(t) || popoverEl.value?.contains(t)) return
  open.value = false
}

watch(open, (v) => {
  if (v) document.addEventListener('click', onDocClick, true)
  else document.removeEventListener('click', onDocClick, true)
})

onUnmounted(() => document.removeEventListener('click', onDocClick, true))
</script>

<template>
  <div v-if="visible" ref="dockEl" class="sync-dock">
    <button
      class="sync-dock-btn"
      :class="dockState"
      :title="dockTitle"
      @click="open = !open"
    >
      <!-- <span class="sync-dock-dot" :class="dockState" /> -->
      <QrCode v-if="dockState === 'unpaired'" :size="16" :stroke-width="1.75" />
      <Wifi v-else-if="dockState === 'online'" :size="16" :stroke-width="1.75" />
      <Smartphone v-else :size="16" :stroke-width="1.75" />
    </button>

    <Teleport to="body">
      <div v-if="open" ref="popoverEl" class="sync-dock-popover" role="dialog">
        <div class="sync-dock-popover-head">
          <span class="sync-dock-title">设备同步</span>
          <button class="sync-dock-close" @click="open = false">
            <X :size="15" :stroke-width="1.75" />
          </button>
        </div>
        <div class="sync-dock-popover-body">
          <DeviceSyncPanel @toast="onToast" />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.sync-dock {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.sync-dock-btn {
  position: relative;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: border-color 160ms ease, color 160ms ease, background 160ms ease;
}

.sync-dock-btn:hover {
  border-color: var(--accent);
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.sync-dock-btn.online {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 40%, transparent);
}

.sync-dock-btn.offline {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 40%, transparent);
}

.sync-dock-dot {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-tertiary);
  border: 2px solid var(--bg-sidebar);
  box-sizing: content-box;
}

.sync-dock-dot.online {
  background: var(--success);
  box-shadow: 0 0 6px color-mix(in srgb, var(--success) 60%, transparent);
}

.sync-dock-dot.offline {
  background: var(--warning);
}

.sync-dock-popover {
  position: fixed;
  bottom: var(--space-1);
  left: calc(var(--sidebar-width) + var(--space-1));
  width: 300px;
  max-height: calc(100vh - 28px);
  overflow-y: auto;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 0  var(--radius-md) var(--radius-md) 0;
  box-shadow: 0 12px 36px var(--shadow);
  z-index: 9999;
}

.sync-dock-popover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px var(--space-3);
  border-bottom: 1px solid var(--border);
}

.sync-dock-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.sync-dock-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-tertiary);
  display: flex;
  padding: 4px;
  border-radius: 6px;
  transition: color 160ms ease, background 160ms ease;
}

.sync-dock-close:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.sync-dock-popover-body {
  padding: var(--space-3);
}
</style>
