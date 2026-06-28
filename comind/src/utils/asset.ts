import Dexie from 'dexie'
import type { Asset, AssetStorage } from '../types/asset'

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

class AssetStorageImpl implements AssetStorage {
  private urlCache = new Map<string, string>()

  async save(file: File): Promise<Asset> {
    const asset: Asset = {
      id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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

export const assetStorage: AssetStorage = new AssetStorageImpl()
