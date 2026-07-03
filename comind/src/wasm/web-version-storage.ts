import Dexie from 'dexie'
import type { BlockVersion } from './types'

class BlockVersionDB extends Dexie {
  versions!: Dexie.Table<BlockVersionRecord, string>

  constructor() {
    super('comind-block-versions')
    this.version(1).stores({
      versions: 'id, blockId, version, createdAt'
    })
  }
}

interface BlockVersionRecord {
  id: string
  blockId: string
  version: number
  snapshot: string
  hash: string
  message: string | null
  source: string
  restoredFromVersionId: string | null
  createdAt: number
}

const versionDb = new BlockVersionDB()

export async function createWebBlockVersion(
  blockId: string,
  snapshot: string,
  hash: string,
  reason: string,
  checkpointName?: string
): Promise<BlockVersion> {
  const existingVersions = await versionDb.versions.where('blockId').equals(blockId).reverse().sortBy('version')
  const versionNumber = existingVersions.length > 0 ? existingVersions[0].version + 1 : 1

  const version: BlockVersionRecord = {
    id: `bv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    blockId,
    version: versionNumber,
    snapshot,
    hash,
    message: checkpointName ?? null,
    source: reason,
    restoredFromVersionId: null,
    createdAt: Date.now()
  }

  await versionDb.versions.put(version)
  return convertToBlockVersion(version)
}

export async function getWebBlockVersions(blockId: string): Promise<BlockVersion[]> {
  const versions = await versionDb.versions
    .where('blockId')
    .equals(blockId)
    .reverse()
    .sortBy('createdAt')
  return versions.map(convertToBlockVersion)
}

export async function getWebBlockVersionById(id: string): Promise<BlockVersion | null> {
  const version = await versionDb.versions.get(id)
  return version ? convertToBlockVersion(version) : null
}

export async function restoreWebBlockVersion(versionId: string): Promise<BlockVersion | null> {
  const version = await versionDb.versions.get(versionId)
  if (!version) return null

  const restoredVersion: BlockVersionRecord = {
    ...version,
    id: `bv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version: version.version + 1,
    source: 'restore',
    restoredFromVersionId: versionId,
    createdAt: Date.now()
  }

  await versionDb.versions.put(restoredVersion)
  return convertToBlockVersion(restoredVersion)
}

export async function cleanupWebBlockVersions(retentionDays: number): Promise<void> {
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  await versionDb.versions.where('createdAt').below(cutoffTime).delete()
}

function convertToBlockVersion(record: BlockVersionRecord): BlockVersion {
  return {
    id: record.id,
    block_id: record.blockId,
    version: record.version,
    snapshot: record.snapshot,
    hash: record.hash,
    source: record.source,
    message: record.message,
    restored_from_version_id: record.restoredFromVersionId,
    created_at: record.createdAt
  }
}