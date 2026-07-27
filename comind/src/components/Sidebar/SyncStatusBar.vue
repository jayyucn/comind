<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { QrCode, Wifi, X } from 'lucide-vue-next'
import { useSyncStatus } from '../../composables/useSyncStatus'
import { useEditorStore } from '../../stores/editor'
import { isTauriEnvironment } from '../../wasm/tauri-client'
import DeviceSyncPanel from './DeviceSyncPanel.vue'

const visible = isTauriEnvironment()
const { status } = useSyncStatus()
const editorStore = useEditorStore()

const open = ref(false)
const dockEl = ref<HTMLElement | null>(null)
const popoverEl = ref<HTMLElement | null>(null)

const connected = () => !!status.value?.connected

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
      :class="{ connected: connected() }"
      :title="connected() ? '设备已连接 · 点击管理' : '未连接设备 · 点击配对'"
      @click="open = !open"
    >
      <span class="sync-dock-dot" :class="{ on: connected() }" />
      <QrCode v-if="!connected()" :size="16" :stroke-width="1.75" />
      <Wifi v-else :size="16" :stroke-width="1.75" />
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

.sync-dock-btn.connected {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 40%, transparent);
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

.sync-dock-dot.on {
  background: var(--success);
  box-shadow: 0 0 6px color-mix(in srgb, var(--success) 60%, transparent);
}

.sync-dock-popover {
  position: fixed;
  bottom: 14px;
  left: 252px;
  width: 300px;
  max-height: calc(100vh - 28px);
  overflow-y: auto;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22);
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
  font-size: 13px;
  font-weight: 600;
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
