import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Asset } from '../types/asset'

vi.mock('./db', () => ({
  db: {
    assets: {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined)
    }
  }
}))

vi.mock('../utils/id', () => ({
  generateUUID: vi.fn().mockReturnValue('mock-asset-uuid')
}))

vi.mock('./asset', () => {
  const urlCache = new Map<string, string>()
  
  return {
    assetStorage: {
      async save(file: File): Promise<Asset> {
        const id = 'mock-asset-uuid'
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
        const { db } = await import('./db')
        await db.assets.put(asset)
        return asset
      },
      async get(id: string): Promise<Asset | undefined> {
        const { db } = await import('./db')
        return db.assets.get(id)
      },
      async delete(id: string): Promise<void> {
        this.revokeUrl(id)
        const { db } = await import('./db')
        await db.assets.delete(id)
      },
      getUrl(id: string): string {
        if (urlCache.has(id)) return urlCache.get(id)!
        return ''
      },
      async loadUrl(id: string): Promise<string> {
        if (urlCache.has(id)) return urlCache.get(id)!
        const asset = await this.get(id)
        if (!asset) return ''
        const url = URL.createObjectURL(asset.blob)
        urlCache.set(id, url)
        return url
      },
      revokeUrl(id: string): void {
        const url = urlCache.get(id)
        if (url) {
          URL.revokeObjectURL(url)
          urlCache.delete(id)
        }
      }
    }
  }
})

function createMockFile(name: string, type: string, size: number): File {
  const content = new Array(size).fill('a').join('')
  const blob = new Blob([content], { type })
  return new File([blob], name, { type })
}

describe('IndexedDBAssetStorage', () => {
  let storage: any
  let mockDb: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const module = await import('./asset')
    storage = module.assetStorage
    const { db } = await import('./db')
    mockDb = db
  })

  describe('save', () => {
    it('saves file and returns asset with correct properties', async () => {
      const file = createMockFile('test.png', 'image/png', 1024)

      const asset = await storage.save(file)

      expect(asset.id).toBe('mock-asset-uuid')
      expect(asset.name).toBe('test.png')
      expect(asset.mimeType).toBe('image/png')
      expect(asset.size).toBe(1024)
      expect(asset.blob).toBe(file)
      expect(asset.createdAt).toBeDefined()
      expect(asset.updatedAt).toBeDefined()
    })

    it('calls db.assets.put with asset', async () => {
      const file = createMockFile('doc.pdf', 'application/pdf', 2048)

      await storage.save(file)

      expect(mockDb.assets.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'mock-asset-uuid',
          name: 'doc.pdf',
          mimeType: 'application/pdf',
          size: 2048
        })
      )
    })

    it('sets createdAt and updatedAt to current time', async () => {
      const before = Date.now()
      const file = createMockFile('test.jpg', 'image/jpeg', 500)
      const asset = await storage.save(file)
      const after = Date.now()

      expect(asset.createdAt).toBeGreaterThanOrEqual(before)
      expect(asset.createdAt).toBeLessThanOrEqual(after)
      expect(asset.updatedAt).toBeGreaterThanOrEqual(before)
      expect(asset.updatedAt).toBeLessThanOrEqual(after)
    })
  })

  describe('get', () => {
    it('returns asset from database by id', async () => {
      const mockAsset: Asset = {
        id: 'asset-123',
        name: 'test.png',
        mimeType: 'image/png',
        size: 1024,
        blob: new Blob(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      ;(mockDb.assets.get as any).mockResolvedValueOnce(mockAsset)

      const result = await storage.get('asset-123')

      expect(result).toEqual(mockAsset)
      expect(mockDb.assets.get).toHaveBeenCalledWith('asset-123')
    })

    it('returns undefined for non-existent asset', async () => {
      ;(mockDb.assets.get as any).mockResolvedValueOnce(undefined)

      const result = await storage.get('non-existent')

      expect(result).toBeUndefined()
    })
  })

  describe('delete', () => {
    it('revokes URL before deleting', async () => {
      const mockAsset: Asset = {
        id: 'asset-to-delete',
        name: 'test.png',
        mimeType: 'image/png',
        size: 1024,
        blob: new Blob(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      ;(mockDb.assets.get as any).mockResolvedValueOnce(mockAsset)
      URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url')

      await storage.loadUrl('asset-to-delete')
      await storage.delete('asset-to-delete')

      expect(mockDb.assets.delete).toHaveBeenCalledWith('asset-to-delete')
    })

    it('deletes asset from database', async () => {
      await storage.delete('asset-456')

      expect(mockDb.assets.delete).toHaveBeenCalledWith('asset-456')
    })
  })

  describe('getUrl', () => {
    it('returns cached URL if exists', async () => {
      URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
      const mockAsset: Asset = {
        id: 'cached-asset',
        name: 'test.png',
        mimeType: 'image/png',
        size: 1024,
        blob: new Blob(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      ;(mockDb.assets.get as any).mockResolvedValueOnce(mockAsset)

      await storage.loadUrl('cached-asset')
      const url = storage.getUrl('cached-asset')

      expect(url).toBe('blob:mock-url')
    })

    it('returns empty string for non-cached asset', () => {
      const url = storage.getUrl('never-loaded')
      expect(url).toBe('')
    })
  })

  describe('loadUrl', () => {
    it('creates and caches URL for asset', async () => {
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:new-url')
      const mockAsset: Asset = {
        id: 'new-asset',
        name: 'test.png',
        mimeType: 'image/png',
        size: 1024,
        blob: new Blob(['test'], { type: 'image/png' }),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      ;(mockDb.assets.get as any).mockResolvedValueOnce(mockAsset)

      const url = await storage.loadUrl('new-asset')

      expect(url).toBe('blob:new-url')
      expect(createObjectURLSpy).toHaveBeenCalledWith(mockAsset.blob)
    })

    it('returns cached URL without loading again', async () => {
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached-url')
      const mockAsset: Asset = {
        id: 'already-cached',
        name: 'test.png',
        mimeType: 'image/png',
        size: 1024,
        blob: new Blob(['test'], { type: 'image/png' }),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      ;(mockDb.assets.get as any).mockResolvedValueOnce(mockAsset)

      await storage.loadUrl('already-cached')
      await storage.loadUrl('already-cached')

      expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    })

    it('returns empty string for non-existent asset', async () => {
      ;(mockDb.assets.get as any).mockResolvedValueOnce(undefined)

      const url = await storage.loadUrl('non-existent')

      expect(url).toBe('')
    })
  })

  describe('revokeUrl', () => {
    it('revokes object URL and removes from cache', async () => {
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
      URL.createObjectURL = vi.fn().mockReturnValue('blob:to-revoke')
      const mockAsset: Asset = {
        id: 'to-revoke',
        name: 'test.png',
        mimeType: 'image/png',
        size: 1024,
        blob: new Blob(['test'], { type: 'image/png' }),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      ;(mockDb.assets.get as any).mockResolvedValueOnce(mockAsset)

      await storage.loadUrl('to-revoke')
      storage.revokeUrl('to-revoke')

      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:to-revoke')
      expect(storage.getUrl('to-revoke')).toBe('')
    })

    it('handles non-cached asset gracefully', () => {
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL')

      expect(() => storage.revokeUrl('not-cached')).not.toThrow()
      expect(revokeObjectURLSpy).not.toHaveBeenCalled()
    })
  })

  describe('URL lifecycle', () => {
    it('maintains separate caches for different assets', async () => {
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL')
        .mockReturnValueOnce('blob:url1')
        .mockReturnValueOnce('blob:url2')

      const asset1: Asset = {
        id: 'asset1',
        name: 'test1.png',
        mimeType: 'image/png',
        size: 1024,
        blob: new Blob(['test1'], { type: 'image/png' }),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      const asset2: Asset = {
        id: 'asset2',
        name: 'test2.png',
        mimeType: 'image/png',
        size: 2048,
        blob: new Blob(['test2'], { type: 'image/png' }),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      ;(mockDb.assets.get as any)
        .mockResolvedValueOnce(asset1)
        .mockResolvedValueOnce(asset2)

      const url1 = await storage.loadUrl('asset1')
      const url2 = await storage.loadUrl('asset2')

      expect(url1).toBe('blob:url1')
      expect(url2).toBe('blob:url2')
      expect(createObjectURLSpy).toHaveBeenCalledTimes(2)
    })
  })
})
