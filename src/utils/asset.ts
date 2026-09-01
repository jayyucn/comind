import Dexie from 'dexie'
import { invoke } from '@tauri-apps/api/core'
import { isTauriEnvironment } from '../wasm/tauri-platform'
import type { Asset, AssetStorage } from '../types/asset'

function newAssetId(): string {
  return `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 公共基类：持有 blob URL 缓存，save/get/delete 由平台实现提供 */
abstract class BaseUrlAssetStorage implements AssetStorage {
  protected urlCache = new Map<string, string>()

  abstract save(file: File): Promise<Asset>
  abstract get(id: string): Promise<Asset | undefined>
  abstract delete(id: string): Promise<void>

  getUrl(id: string): string {
    if (this.urlCache.has(id)) {
      return this.urlCache.get(id)!
    }
    // 同步返回占位符，实际 URL 在 loadUrl 后可用
    return `asset://${id}`
  }

  async loadUrl(id: string): Promise<string> {
    if (this.urlCache.has(id)) {
      return this.urlCache.get(id)!
    }
    const asset = await this.get(id)
    if (!asset) {
      throw new Error(`Asset not found: ${id}`)
    }
    const url = URL.createObjectURL(asset.blob)
    this.urlCache.set(id, url)
    return url
  }

  revokeUrl(id: string): void {
    const url = this.urlCache.get(id)
    if (url) {
      URL.revokeObjectURL(url)
      this.urlCache.delete(id)
    }
  }
}

// ---- Web 实现：Dexie IndexedDB（comind-assets 库 assets 表） ----

class AssetDB extends Dexie {
  assets!: Dexie.Table<Asset, string>

  constructor() {
    super('comind-assets')
    this.version(1).stores({
      assets: 'id, name, mimeType, createdAt'
    })
  }
}

const assetDb = new AssetDB()

class AssetStorageImpl extends BaseUrlAssetStorage {
  async save(file: File): Promise<Asset> {
    const asset: Asset = {
      id: newAssetId(),
      name: file.name,
      mimeType: file.type,
      size: file.size,
      blob: file,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await assetDb.assets.put(asset)
    return asset
  }

  async get(id: string): Promise<Asset | undefined> {
    return assetDb.assets.get(id)
  }

  async delete(id: string): Promise<void> {
    this.revokeUrl(id)
    await assetDb.assets.delete(id)
  }
}

// ---- Tauri（Desktop）实现：workspace/assets/ 目录，与 sqlite/、markdown/ 并列 ----

interface TauriAssetFileData {
  name: string
  mimeType: string
  size: number
  createdAt: number
  data: number[]
}

class TauriAssetStorage extends BaseUrlAssetStorage {
  async save(file: File): Promise<Asset> {
    const id = newAssetId()
    const createdAt = Date.now()
    await invoke('save_asset_file', {
      id,
      fileName: file.name,
      mimeType: file.type,
      data: Array.from(new Uint8Array(await file.arrayBuffer()))
    })
    return {
      id,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      blob: file,
      createdAt,
      updatedAt: createdAt
    }
  }

  async get(id: string): Promise<Asset | undefined> {
    try {
      const r = await invoke<TauriAssetFileData>('read_asset_file', { id })
      const bytes = new Uint8Array(r.data)
      return {
        id,
        name: r.name,
        mimeType: r.mimeType,
        size: r.size,
        blob: new Blob([bytes], { type: r.mimeType }),
        createdAt: r.createdAt,
        updatedAt: r.createdAt
      }
    } catch (e) {
      // 仅「资产不存在」返回 undefined；workspace 未配置、权限等真实错误向上抛，
      // 避免与真缺失不可区分（调用方均有 try/catch 或 !asset 兜底）
      const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e)
      if (msg.includes('Asset not found')) return undefined
      throw new Error(`Failed to read asset ${id}: ${msg}`, { cause: e })
    }
  }

  async delete(id: string): Promise<void> {
    this.revokeUrl(id)
    await invoke('delete_asset_file', { id })
  }
}

export const assetStorage: AssetStorage = isTauriEnvironment()
  ? new TauriAssetStorage()
  : new AssetStorageImpl()
