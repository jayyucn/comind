import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'

// Mock dependencies
vi.mock('../wasm/tauri-client', () => ({
  isAndroidPlatform: vi.fn(),
  tauriGetSyncStatus: vi.fn(),
  tauriGetSyncStatusPC: vi.fn(),
}))

vi.mock('../wasm/client', () => ({
  getPairedDevices: vi.fn(),
}))

describe('useSyncStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should initialize with default values', async () => {
    const { useSyncStatus } = await import('./useSyncStatus')

    const { status, pairedDevices, isAndroid, polling } = useSyncStatus()

    expect(status.value).toBeNull()
    expect(pairedDevices.value).toEqual([])
    expect(isAndroid.value).toBe(false)
    expect(polling.value).toBe(false)
  })

  it('should detect Android platform correctly', async () => {
    const { isAndroidPlatform } = await import('../wasm/tauri-client')
    vi.mocked(isAndroidPlatform).mockResolvedValue(true)

    const { useSyncStatus } = await import('./useSyncStatus')
    const { isAndroid } = useSyncStatus()

    // Wait for async initialization
    await vi.runAllTimersAsync()

    expect(isAndroidPlatform).toHaveBeenCalled()
    expect(isAndroid.value).toBe(true)
  })

  it('should poll sync status at regular intervals', async () => {
    const { tauriGetSyncStatusPC } = await import('../wasm/tauri-client')
    vi.mocked(tauriGetSyncStatusPC).mockResolvedValue({
      connected: true,
      paired: true,
      peers: [{ client_id: 'client-1', name: 'Test Device', ip: '192.168.1.100' }],
    })

    const { useSyncStatus } = await import('./useSyncStatus')
    const { status } = useSyncStatus()

    // Initial poll
    await vi.runAllTimersAsync()

    expect(tauriGetSyncStatusPC).toHaveBeenCalled()
    expect(status.value?.connected).toBe(true)
    expect(status.value?.peers.length).toBe(1)
  })

  it('should handle sync status fetch errors gracefully', async () => {
    const { tauriGetSyncStatusPC } = await import('../wasm/tauri-client')
    vi.mocked(tauriGetSyncStatusPC).mockRejectedValue(new Error('Network error'))

    const { useSyncStatus } = await import('./useSyncStatus')
    const { status } = useSyncStatus()

    await vi.runAllTimersAsync()

    // Should not crash, status remains null
    expect(status.value).toBeNull()
  })

  it('should refresh paired devices on demand', async () => {
    const { getPairedDevices } = await import('../wasm/client')
    vi.mocked(getPairedDevices).mockResolvedValue([
      { client_id: 'device-1', peer_device_name: 'Phone', last_sync_at: 1000, paired_at: 900 },
    ])

    const { useSyncStatus } = await import('./useSyncStatus')
    const { pairedDevices, refreshNow } = useSyncStatus()

    await refreshNow()

    expect(getPairedDevices).toHaveBeenCalled()
    expect(pairedDevices.value.length).toBe(1)
    expect(pairedDevices.value[0].peer_device_name).toBe('Phone')
  })

  it('should handle paired devices fetch errors gracefully', async () => {
    const { getPairedDevices } = await import('../wasm/client')
    vi.mocked(getPairedDevices).mockRejectedValue(new Error('DB error'))

    const { useSyncStatus } = await import('./useSyncStatus')
    const { pairedDevices, refreshNow } = useSyncStatus()

    await refreshNow()

    // Should not crash, devices remain empty
    expect(pairedDevices.value).toEqual([])
  })
})