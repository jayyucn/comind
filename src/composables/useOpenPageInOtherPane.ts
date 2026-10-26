import { usePageStore } from '../stores/pages'
import { usePanesStore } from '../stores/panes'
import { getCoreClient } from '../wasm/client'

/**
 * 「在另一栏打开页面」：把 Ctrl+Click 拿到的页面名解析成页 id，写入对称 pane store 的
 * 非活动 pane（单 pane 时自动拆成双 pane）。
 *
 * 解析口径与 router beforeEach 对齐（见 src/router/index.ts）：
 * - 日记日期标题（normalizeJournalTitle 非空）：今日页幂等创建，历史页仅在已存在时打开；
 * - 普通标题：getOrCreatePageByTitle（"引用即创建"）。
 * 解析失败（如历史 ideas 页从未创建）时不动作，保持另一栏原状。
 */
export function useOpenPageInOtherPane() {
  // store 取用延迟到调用时（非 setup 期）：本 composable 会被挂进任意挂载环境
  // （如 IdeasSnapshotNode 在 BlockModal 快照弹窗内），setup 期取 store 会在
  // 无 active Pinia 的测试环境直接抛错（BlockModal.test.ts 实证）。
  async function openPageInOtherPane(pageName: string): Promise<void> {
    const pageStore = usePageStore()
    const panesStore = usePanesStore()
    const client = getCoreClient()
    if (!client) return
    await pageStore.ensurePagesLoaded()

    const normalized = await client.normalizeJournalTitle(pageName)
    const lookupTitle = normalized ?? pageName

    let pageId: string | null
    if (normalized) {
      let page = pageStore.getPageByTitle(normalized)
      if (!page && (await client.isTodayTitle(normalized))) {
        page = await pageStore.ensureTodayIdeasPage()
      }
      pageId = page?.id ?? null
    } else {
      pageId = (await pageStore.getOrCreatePageByTitle(lookupTitle)).id
    }

    if (pageId) panesStore.openInOtherPane(pageId)
  }

  return { openPageInOtherPane }
}
