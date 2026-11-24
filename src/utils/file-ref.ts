/**
 * file 字段（附件，issue T9）的纯函数工具——mime → 展示形态判定、引用路径解析。
 *
 * 落库的 path 是资产引用 `asset://<id>`：复用既有资产通道（src/utils/asset.ts），
 * Tauri 下文件存 workspace/assets/（与 sqlite/、markdown/ 并列，assets.json 登记元数据），
 * Web/wasm 下存 Dexie（comind-assets 库）。markdown 导出导入已有 asset:// 联动，
 * 引用路径与生产环境天然一致。
 */

/** 判断 mime 是否图片（决定渲染缩略图还是附件 chip）；空/未知 mime 按非图片。 */
export function isImageMime(mime?: string): boolean {
  return !!mime && mime.toLowerCase().startsWith('image/')
}

/** 展示形态判定：image = 缩略图，file = 附件 chip。 */
export function fileRefDisplayKind(mime?: string): 'image' | 'file' {
  return isImageMime(mime) ? 'image' : 'file'
}

/** 从引用路径提取资产 id：`asset://<id>` → `<id>`；非 asset:// 形态返回 null。 */
export function assetIdFromPath(path: string): string | null {
  const PREFIX = 'asset://'
  if (!path.startsWith(PREFIX)) return null
  const id = path.slice(PREFIX.length)
  return id || null
}
