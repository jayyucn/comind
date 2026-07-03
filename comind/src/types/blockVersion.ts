import type { Block } from './block'
import type { Property } from '../wasm/types'
import type { Link } from '../wasm/types'

export interface BlockSnapshot {
  block: Block
  properties: Property[]
  relationships: Link[]
}

export interface BlockVersion {
  id: string
  blockId: string
  version: number
  snapshot: string
  hash: string
  message: string | null
  source: 'auto' | 'manual' | 'major_op' | 'app_exit' | 'restore'
  restoredFromVersionId: string | null
  createdAt: number
}

export interface BlockVersionRecord {
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

function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    const value = obj[key]
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      sorted[key] = sortObjectKeys(value as Record<string, unknown>)
    } else {
      sorted[key] = value
    }
  }
  return sorted
}

function sortArrayByKeys<T>(arr: T[]): T[] {
  return arr.map(item => {
    if (typeof item === 'object' && item !== null) {
      return sortObjectKeys(item as Record<string, unknown>) as T
    }
    return item
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

export function serializeSnapshot(snapshot: BlockSnapshot): string {
  const sorted: Record<string, unknown> = {}
  
  sorted['block'] = sortObjectKeys(snapshot.block as unknown as Record<string, unknown>)
  sorted['properties'] = sortArrayByKeys(snapshot.properties as unknown[])
  sorted['relationships'] = sortArrayByKeys(snapshot.relationships as unknown[])
  
  return JSON.stringify(sorted)
}

export async function calculateSnapshotHash(snapshot: BlockSnapshot): Promise<string> {
  const serialized = serializeSnapshot(snapshot)
  const encoder = new TextEncoder()
  const data = encoder.encode(serialized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}