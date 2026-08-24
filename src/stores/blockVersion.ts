import { defineStore } from 'pinia'
import { ref } from 'vue'
import { initCoreClient } from '../wasm/client'
import type { BlockSnapshot } from '../types/blockVersion'
import { serializeSnapshot, calculateSnapshotHash } from '../types/blockVersion'

interface PendingBlock {
  blockId: string
  snapshot: BlockSnapshot
  reason: string
  lastModified: number
}

interface BlockSnapshotCache {
  [blockId: string]: {
    snapshot: BlockSnapshot
    hash: string
    lastSnapshotTime: number
  }
}

const LAYER1_DEBOUNCE_MS = 2000
const LAYER2_COOLDOWN_MS = 3 * 60 * 1000
const MAX_THROTTLE_MS = 30 * 1000

export const useBlockVersionStore = defineStore('blockVersion', () => {
  const pendingBlocks = ref<Map<string, PendingBlock>>(new Map())
  const snapshotCache = ref<BlockSnapshotCache>({})
  const layer1Timers = ref<Map<string, number>>(new Map())
  const layer2Timestamps = ref<Map<string, number>>(new Map())
  const lastForceFlush = ref(0)

  async function scheduleVersion(blockId: string, snapshot: BlockSnapshot, reason: string = 'auto') {
    const now = Date.now()
    
    const pending = pendingBlocks.value.get(blockId)
    if (pending) {
      pending.snapshot = snapshot
      pending.reason = reason
      pending.lastModified = now
    } else {
      pendingBlocks.value.set(blockId, {
        blockId,
        snapshot,
        reason,
        lastModified: now
      })
    }

    const existingTimer = layer1Timers.value.get(blockId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timeout = Math.min(LAYER1_DEBOUNCE_MS, Math.max(0, MAX_THROTTLE_MS - (now - lastForceFlush.value)))
    
    const timer = window.setTimeout(() => {
      createVersionForBlock(blockId)
    }, timeout)
    
    layer1Timers.value.set(blockId, timer)
  }

  async function createVersionForBlock(blockId: string) {
    const pending = pendingBlocks.value.get(blockId)
    if (!pending) return

    const now = Date.now()
    const lastSnapshot = layer2Timestamps.value.get(blockId)
    
    if (lastSnapshot && now - lastSnapshot < LAYER2_COOLDOWN_MS) {
      return
    }

    const serialized = serializeSnapshot(pending.snapshot)
    const hash = await calculateSnapshotHash(pending.snapshot)

    const cached = snapshotCache.value[blockId]
    if (cached && cached.hash === hash) {
      pendingBlocks.value.delete(blockId)
      layer1Timers.value.delete(blockId)
      return
    }

    try {
      const client = await initCoreClient()
      
      const existingVersions = await client.getBlockVersions(blockId)
      if (existingVersions.length > 0) {
        const latestVersion = existingVersions.reduce((prev, curr) => 
          curr.version > prev.version ? curr : prev
        )
        if (latestVersion.hash === hash) {
          pendingBlocks.value.delete(blockId)
          layer1Timers.value.delete(blockId)
          console.info('[BlockVersion] Skipping version creation - content unchanged')
          return
        }
      }

      await client.createBlockVersion(blockId, serialized, hash, pending.reason)
      
      snapshotCache.value[blockId] = {
        snapshot: pending.snapshot,
        hash,
        lastSnapshotTime: now
      }
      
      layer2Timestamps.value.set(blockId, now)
      
      if (now - lastForceFlush.value > MAX_THROTTLE_MS) {
        lastForceFlush.value = now
      }
    } catch (error) {
      console.error('[BlockVersion] Failed to create version:', error)
    } finally {
      pendingBlocks.value.delete(blockId)
      layer1Timers.value.delete(blockId)
    }
  }

  async function forceFlush() {
    const now = Date.now()
    lastForceFlush.value = now

    for (const [blockId] of pendingBlocks.value) {
      const lastSnapshot = layer2Timestamps.value.get(blockId)
      if (!lastSnapshot || now - lastSnapshot >= LAYER2_COOLDOWN_MS) {
        await createVersionForBlock(blockId)
      }
    }
  }

  async function getVersions(blockId: string) {
    try {
      const client = await initCoreClient()
      return await client.getBlockVersions(blockId)
    } catch (error) {
      console.error('[BlockVersion] Failed to get versions:', error)
      return []
    }
  }

  async function getVersionById(id: string) {
    try {
      const client = await initCoreClient()
      return await client.getBlockVersionById(id)
    } catch (error) {
      console.error('[BlockVersion] Failed to get version:', error)
      return null
    }
  }

  async function restoreVersion(versionId: string) {
    try {
      const client = await initCoreClient()
      return await client.restoreBlockVersion(versionId)
    } catch (error) {
      console.error('[BlockVersion] Failed to restore version:', error)
      throw error
    }
  }

  async function deleteVersion(versionId: string) {
    try {
      const client = await initCoreClient()
      await client.deleteBlockVersion(versionId)
    } catch (error) {
      console.error('[BlockVersion] Failed to delete version:', error)
      throw error
    }
  }

  async function cleanupVersions(retentionDays: number = 30) {
    try {
      const client = await initCoreClient()
      await client.cleanupBlockVersions(retentionDays)
    } catch (error) {
      console.error('[BlockVersion] Failed to cleanup versions:', error)
    }
  }

  function cancelPending(blockId: string) {
    const timer = layer1Timers.value.get(blockId)
    if (timer) {
      clearTimeout(timer)
      layer1Timers.value.delete(blockId)
    }
    pendingBlocks.value.delete(blockId)
  }

  function clearAll() {
    for (const timer of layer1Timers.value.values()) {
      clearTimeout(timer)
    }
    pendingBlocks.value.clear()
    layer1Timers.value.clear()
  }

  return {
    pendingBlocks,
    scheduleVersion,
    forceFlush,
    getVersions,
    getVersionById,
    restoreVersion,
    deleteVersion,
    cleanupVersions,
    cancelPending,
    clearAll
  }
})