import { ref, onMounted, onUnmounted } from 'vue'
import { useNotificationStore } from '../stores/notification'

const SCHEDULER_INTERVAL_MS = 60 * 1000

let intervalId: ReturnType<typeof setInterval> | null = null
let isPrimary = ref(false)

export function useNotificationScheduler() {
  const notificationStore = useNotificationStore()
  const isRunning = ref(false)

  async function requestLock(): Promise<boolean> {
    if (!('locks' in navigator)) {
      return true
    }

    try {
      let granted = false
      await navigator.locks.request('comind-notification-scheduler', {
        ifAvailable: true,
      }, () => {
        granted = true
        return Promise.resolve()
      })
      return granted
    } catch {
      return true
    }
  }

  function releaseLock() {
  }

  async function checkAndFire() {
    if (!isPrimary.value) {
      return
    }

    try {
      await notificationStore.triggerCheckAndFire()
    } catch (err) {
      console.error('[NotificationScheduler] Check and fire failed:', err)
    }
  }

  async function start() {
    if (isRunning.value) {
      return
    }

    isPrimary.value = await requestLock()

    if (isPrimary.value) {
      await checkAndFire()

      intervalId = setInterval(checkAndFire, SCHEDULER_INTERVAL_MS)
      isRunning.value = true
      console.info('[NotificationScheduler] Started (primary)')
    } else {
      console.info('[NotificationScheduler] Started (secondary, waiting)')
    }
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    releaseLock()
    isRunning.value = false
    isPrimary.value = false
    console.info('[NotificationScheduler] Stopped')
  }

  function refresh() {
    checkAndFire()
  }

  onMounted(() => {
    start()

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    })
  })

  onUnmounted(() => {
    stop()
  })

  return {
    isRunning,
    isPrimary,
    start,
    stop,
    refresh,
  }
}