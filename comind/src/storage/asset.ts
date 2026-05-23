import { db } from './db'
import { generateUUID } from '../utils/id'
import type { Asset, AssetStorage } from '../types/asset'

class IndexedDBAssetStorage implements AssetStorage {
  private urlCache = new Map<string, string>()

  async save(file: File): Promise<Asset> {
    const id = generateUUID()
    const now = Date.now()

    const asset: Asset = {
      id,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      blob: file,
      createdAt: now,
      updatedAt: now
    }

    await db.assets.put(asset)
    return asset
  }

  async get(id: string): Promise<Asset | undefined> {
    return db.assets.get(id)
  }

  async delete(id: string): Promise<void> {
    this.revokeUrl(id)
    await db.assets.delete(id)
  }

  getUrl(id: string): string {
    if (this.urlCache.has(id)) {
      return this.urlCache.get(id)!
    }
    return ''
  }

  async loadUrl(id: string): Promise<string> {
    if (this.urlCache.has(id)) {
      return this.urlCache.get(id)!
    }
    const asset = await this.get(id)
    if (!asset) return ''
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

export const assetStorage: AssetStorage = new IndexedDBAssetStorage()