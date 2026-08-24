<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import jsQR from 'jsqr'

const emit = defineEmits<{
  scanned: [content: string]
  cancel: []
}>()

const videoRef = ref<HTMLVideoElement | null>(null)
const error = ref('')
const scanning = ref(false)

let stream: MediaStream | null = null
let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let rafId: number | null = null

async function startScan() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })

    const video = videoRef.value
    if (!video) return

    video.srcObject = stream
    video.setAttribute('playsinline', 'true')
    await video.play()

    canvas = document.createElement('canvas')
    ctx = canvas.getContext('2d', { willReadFrequently: true })
    scanning.value = true
    scanLoop()
  } catch (e: any) {
    const msg = e?.message || e?.toString() || String(e)
    if (msg.includes('Permission') || msg.includes('permission') || msg.includes('NotAllowed')) {
      error.value = '相机权限被拒绝，请在系统设置中允许相机访问'
    } else {
      error.value = `相机启动失败: ${msg}`
    }
    console.error('QR scanner error:', e)
  }
}

function scanLoop() {
  if (!scanning.value) return

  const video = videoRef.value
  const ctx2 = ctx
  const cv = canvas
  if (!video || !ctx2 || !cv || video.readyState !== video.HAVE_ENOUGH_DATA) {
    rafId = requestAnimationFrame(scanLoop)
    return
  }

  const w = video.videoWidth
  const h = video.videoHeight
  if (w === 0 || h === 0) {
    rafId = requestAnimationFrame(scanLoop)
    return
  }

  cv.width = w
  cv.height = h
  ctx2.drawImage(video, 0, 0, w, h)

  const imageData = ctx2.getImageData(0, 0, w, h)
  const code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' })

  if (code && code.data) {
    scanning.value = false
    emit('scanned', code.data)
    stopScan()
    return
  }

  rafId = requestAnimationFrame(scanLoop)
}

function stopScan() {
  scanning.value = false
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  if (videoRef.value) {
    videoRef.value.srcObject = null
  }
}

onMounted(() => {
  startScan()
})

onUnmounted(() => {
  stopScan()
})
</script>

<template>
  <div class="qr-scanner-overlay" @click.self="emit('cancel')">
    <div class="qr-scanner-panel">
      <div class="qr-scanner-header">
        <span>扫描二维码</span>
        <button class="qr-scanner-close" @click="emit('cancel')">✕</button>
      </div>
      <div class="qr-reader">
        <video ref="videoRef" muted playsinline></video>
        <div class="qr-reader-frame"></div>
      </div>
      <div v-if="error" class="qr-scanner-error">
        {{ error }}
      </div>
      <div v-else class="qr-scanner-hint">
        将 PC 端显示的二维码对准摄像头
      </div>
    </div>
  </div>
</template>

<style scoped>
.qr-scanner-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.8);
}

.qr-scanner-panel {
  background: var(--color-paper, #fff);
  border-radius: 12px;
  padding: 16px;
  width: 90vw;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.qr-scanner-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
}

.qr-scanner-close {
  border: none;
  background: transparent;
  font-size: var(--text-lg);
  cursor: pointer;
  padding: 4px 8px;
  color: var(--text-secondary, #666);
}

.qr-reader {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: #000;
}

.qr-reader video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.qr-reader-frame {
  position: absolute;
  inset: 15%;
  border: 2px solid rgba(255, 255, 255, 0.6);
  border-radius: 8px;
  pointer-events: none;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.3);
}

.qr-scanner-error {
  font-size: var(--text-sm);
  color: #dc2626;
  text-align: center;
}

.qr-scanner-hint {
  font-size: var(--text-xs);
  color: var(--text-tertiary, #999);
  text-align: center;
}
</style>
