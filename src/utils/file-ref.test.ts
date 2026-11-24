import { describe, expect, test } from 'vitest'
import { assetIdFromPath, fileRefDisplayKind, isImageMime } from './file-ref'

describe('file-ref isImageMime / fileRefDisplayKind', () => {
  test('image/* → image（缩略图形态）', () => {
    expect(isImageMime('image/png')).toBe(true)
    expect(isImageMime('image/jpeg')).toBe(true)
    expect(isImageMime('image/svg+xml')).toBe(true)
    expect(fileRefDisplayKind('image/png')).toBe('image')
  })

  test('非图片 mime / 空 / undefined → file（附件 chip 形态）', () => {
    expect(isImageMime('application/pdf')).toBe(false)
    expect(isImageMime('text/plain')).toBe(false)
    expect(isImageMime('')).toBe(false)
    expect(isImageMime(undefined)).toBe(false)
    expect(fileRefDisplayKind(undefined)).toBe('file')
    expect(fileRefDisplayKind('application/pdf')).toBe('file')
  })

  test('大小写不敏感（外部写入的 MIME 可能大写）', () => {
    expect(isImageMime('Image/PNG')).toBe(true)
  })
})

describe('file-ref assetIdFromPath', () => {
  test('asset://<id> → <id>', () => {
    expect(assetIdFromPath('asset://asset_1728_abc')).toBe('asset_1728_abc')
    expect(assetIdFromPath('asset://a1')).toBe('a1')
  })

  test('非 asset:// 形态 → null（悬空降级判定入口）', () => {
    expect(assetIdFromPath('C:/files/a.png')).toBeNull()
    expect(assetIdFromPath('https://example.com/a.png')).toBeNull()
    expect(assetIdFromPath('')).toBeNull()
  })

  test('前缀缺 id（asset://）→ null', () => {
    expect(assetIdFromPath('asset://')).toBeNull()
  })
})
