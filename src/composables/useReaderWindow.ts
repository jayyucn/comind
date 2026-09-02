// 阅读器独立窗口唯一入口（票 03 / ADR-0040 D4）：书房/书 Page 唤起，
// 后续票（高亮面板跳回原文、书房封面网格）复用同一入口。
// 同一 bookId 复用同一窗口（setFocus 聚焦），不同书各开一窗。
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

/**
 * 打开（或聚焦已存在的）某本书的阅读器窗口。
 *
 * URL 拼接：传相对路由 `/reader/<bookId>`，由 Tauri resolve 到应用 origin——
 * dev 下为 devServer（http://localhost:5173/reader/<id>），生产为
 * tauri://localhost/reader/<id>（Windows: https://tauri.localhost/...），
 * 与项目的 history 路由模式（createWebHistory）直接匹配。
 */
export async function openReaderWindow(bookId: string): Promise<void> {
  const label = `reader-${bookId}`
  const existing = await WebviewWindow.getByLabel(label)
  if (existing) {
    await existing.setFocus()
    return
  }
  const win = new WebviewWindow(label, {
    url: `/reader/${encodeURIComponent(bookId)}`,
    title: '阅读',
    width: 1000,
    height: 720,
    center: true,
    // 仿主窗口配置（tauri.conf.json）：无边框 + 透明，顶栏由 ReaderView 自绘
    // （拖拽区 + 最小化/最大化/关闭），App.vue 对 /reader 路由不渲染主窗口壳
    decorations: false,
    transparent: true,
  })
  win.once('tauri://error', (e) => console.error('[reader] 打开阅读器窗口失败:', e))
}
