// 主窗口跨窗口刷新（票 06 / ADR-0040 D4）：阅读器窗口（独立 WebView =
// 独立 Pinia 内存态）经 wasm client 直写同一 SQLite，主窗口内存需事件刷新。
// 监听 'reader:data-changed' → 重载对应 page blocks（v1 粗粒度：无论主窗口
// 当前显示什么，按 payload.pageId 重载，replaceBlocksForPage 按 page 合并不
// 影响其他页面缓存）；window focus 兜底刷新当前打开的 /page/:pageId（事件
// 丢失场景，如监听注册前的写入）。仅主窗口挂载（App.vue），勿在阅读器
// 窗口调用。
// 重载后须自增 structureVersion：loadPageBlocks 只替换 blocks/childrenMap，
// 不 bump 版本，而 BlockList 仅监听 structureVersion 重建树——不 bump 则
// 阅读器侧增删笔记后主窗口书 Page 列表不刷新（UI 与 store 脱节）。
import { onBeforeUnmount, onMounted } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useRoute } from 'vue-router'
import { useBlockStore } from '../stores/blocks'
import { isTauriEnvironment } from '../wasm/tauri-platform'

export function useReaderDataChanged(): void {
  const blockStore = useBlockStore()
  const route = useRoute()

  async function reloadPageBlocks(pageId: string): Promise<void> {
    try {
      await blockStore.loadPageBlocks(pageId)
      // loadPageBlocks 不 bump structureVersion（replaceBlocksForPage 只换数据），
      // 这里显式自增，触发 BlockList 的 structureVersion watch 重建树 → UI 刷新
      blockStore.structureVersion++
    } catch (e) {
      console.warn('[main] 重载页面 blocks 失败:', e)
    }
  }

  function onWindowFocus(): void {
    // v1 粗粒度：仅普通笔记页路由刷新当前页（书 Page 走 'page' 路由）
    if (route.name !== 'page') return
    const pageId = route.params.pageId
    if (typeof pageId === 'string' && pageId) void reloadPageBlocks(pageId)
  }

  onMounted(() => {
    window.addEventListener('focus', onWindowFocus)
    if (!isTauriEnvironment()) return
    listen<{ pageId: string }>('reader:data-changed', (e) => {
      const pageId = e.payload?.pageId
      if (pageId) void reloadPageBlocks(pageId)
    }).then(
      unlisten => { unlistenDataChanged = unlisten },
      (e) => { console.warn('[main] reader:data-changed 监听失败:', e) },
    )
  })

  let unlistenDataChanged: (() => void) | null = null

  onBeforeUnmount(() => {
    window.removeEventListener('focus', onWindowFocus)
    unlistenDataChanged?.()
  })
}
