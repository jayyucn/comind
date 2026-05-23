export interface Asset {
  id: string
  name: string
  mimeType: string
  size: number
  blob: Blob
  createdAt: number
  updatedAt: number
}

export interface AssetStorage {
  save(file: File): Promise<Asset>
  get(id: string): Promise<Asset | undefined>
  delete(id: string): Promise<void>
  getUrl(id: string): string
  loadUrl(id: string): Promise<string>
  revokeUrl(id: string): void
}