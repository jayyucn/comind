import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock dependencies. vi.hoisted ensures these are created before the mocks
// below are evaluated.
const { isAndroidPlatform, tauriGetSyncStatus, tauriGetSyncStatusPC } = vi.hoisted(() => ({
  isAndroidPlatform: vi.fn(),
  tauriGetSyncStatus: vi.fn(),
  tauriGetSyncStatusPC: vi.fn(),
}))
const { getPairedDevices } = vi.hoisted(() => ({ getPairedDevices: vi.fn() }))

vi.mock('../wasm/tauri-client', () => ({
  isAndroidPlatform,
  tauriGetSyncStatus,
  tauriGetSyncStatusPC,
}))

vi.mock('../wasm/client', () => ({
  getPairedDevices,
}))

describe('useSyncStatus', () => {
  // The composable holds module-level state (the polling interval handle,
  // the `initialized` flag, and the `pollCount` counter). vi.resetModules
  // between tests ensures each test gets a clean module instance — without
  // it, the first test's `initialized = true` short-circuits every later test.
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes default values before any I/O completes', async () => {
    const { useSyncStatus } = await import('./useSyncStatus')
    const { status, pairedDevices, isAndroid, polling } = useSyncStatus()
    expect(status.value).toBeNull()
    expect(pairedDevices.value).toEqual([])
    expect(isAndroid.value).toBe(false)
    expect(polling.value).toBe(false)
  })

  it('detects Android platform and routes status fetches to tauriGetSyncStatus', async () => {
    isAndroidPlatform.mockResolvedValue(true)
    tauriGetSyncStatus.mockResolvedValue({
      connected: true,
      paired: true,
      peers: [{ client_id: 'mobile-1', name: 'Mobile', ip: '10.0.0.1' }],
      server_name: 'PC',
    })

    const { useSyncStatus } = await import('./useSyncStatus')
    const { isAndroid, status } = useSyncStatus()

    // Let the initial Promise.all([refresh, refreshPairedDevices]) resolve.
    // We advance just one tick so the setInterval doesn't loop indefinitely.
    await vi.advanceTimersByTimeAsync(0)
    // Flush any remaining microtasks
    await Promise.resolve()
    await Promise.resolve()

    expect(isAndroidPlatform).toHaveBeenCalledTimes(1)
    expect(isAndroid.value).toBe(true)
    expect(tauriGetSyncStatus).toHaveBeenCalled()
    expect(tauriGetSyncStatusPC).not.toHaveBeenCalled()
    expect(status.value?.server_name).toBe('PC')
  })

  it('polls sync status at the regular interval on PC platform', async () => {
    isAndroidPlatform.mockResolvedValue(false)
    tauriGetSyncStatusPC.mockResolvedValue({
      connected: true,
      paired: true,
      peers: [{ client_id: 'client-1', name: 'Test Device', ip: '192.168.1.100' }],
      server_name: null,
    })

    const { useSyncStatus } = await import('./useSyncStatus')
    const { status, polling } = useSyncStatus()

    // Initial poll runs immediately during ensureStarted()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    const initialCalls = tauriGetSyncStatusPC.mock.calls.length
    expect(initialCalls).toBeGreaterThan(0)
    expect(status.value?.connected).toBe(true)
    expect(status.value?.peers[0].client_id).toBe('client-1')
    expect(polling.value).toBe(true)

    // Advance several poll cycles (POLL_INTERVAL_MS = 3000)
    await vi.advanceTimersByTimeAsync(3 * 3000)

    expect(tauriGetSyncStatusPC.mock.calls.length).toBeGreaterThan(initialCalls)
  })

  it('keeps status null and does not throw when sync status fetch fails', async () => {
    isAndroidPlatform.mockResolvedValue(false)
    tauriGetSyncStatusPC.mockRejectedValue(new Error('Network error'))

    const { useSyncStatus } = await import('./useSyncStatus')
    const { status } = useSyncStatus()

    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()

    // status stays at its initial value (null) — the rejection is swallowed
    expect(status.value).toBeNull()
  })

  it('refreshNow() fetches both status and paired devices on demand', async () => {
    isAndroidPlatform.mockResolvedValue(false)
    tauriGetSyncStatusPC.mockResolvedValue({
      connected: false,
      paired: false,
      peers: [],
      server_name: null,
    })
    getPairedDevices.mockResolvedValue([
      { client_id: 'device-1', peer_device_name: 'Phone', last_sync_at: 1000, paired_at: 900 },
    ])

    const { useSyncStatus } = await import('./useSyncStatus')
    const { pairedDevices, refreshNow } = useSyncStatus()

    await refreshNow()

    expect(getPairedDevices).toHaveBeenCalled()
    expect(pairedDevices.value).toEqual([
      { client_id: 'device-1', peer_device_name: 'Phone', last_sync_at: 1000, paired_at: 900 },
    ])
  })

  it('paired devices stay empty when getPairedDevices throws', async () => {
    isAndroidPlatform.mockResolvedValue(false)
    tauriGetSyncStatusPC.mockResolvedValue({
      connected: false, paired: false, peers: [], server_name: null,
    })
    getPairedDevices.mockRejectedValue(new Error('DB error'))

    const { useSyncStatus } = await import('./useSyncStatus')
    const { pairedDevices, refreshNow } = useSyncStatus()

    await refreshNow()

    expect(pairedDevices.value).toEqual([])
  })

  it('paired devices are refreshed at a lower frequency (every 3 poll cycles)', async () => {
    isAndroidPlatform.mockResolvedValue(false)
    tauriGetSyncStatusPC.mockResolvedValue({
      connected: false, paired: false, peers: [], server_name: null,
    })
    getPairedDevices.mockResolvedValue([])

    const { useSyncStatus } = await import('./useSyncStatus')
    useSyncStatus()

    // ensureStarted kicks off one getPairedDevices call alongside the first refresh.
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    const callsAfterStart = getPairedDevices.mock.calls.length
    expect(callsAfterStart).toBe(1)

    // After 1 more poll cycle (3s) — getPairedDevices should NOT be called again
    // (counter % 3 !== 0: pollCount is now 1).
    await vi.advanceTimersByTimeAsync(3 * 1000)
    expect(getPairedDevices.mock.calls.length).toBe(callsAfterStart)

    // After 2 more poll cycles (total 9s = 3 cycles after start) —
    // getPairedDevices called once more (pollCount % 3 === 0).
    await vi.advanceTimersByTimeAsync(2 * 3 * 1000)
    expect(getPairedDevices.mock.calls.length).toBe(callsAfterStart + 1)
  })
})
