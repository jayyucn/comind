import { cleanupOrphanQueryViews } from '../services/query-view-namespace'

/**
 * 启动后核销孤儿查询块视图（`query-orphan:*` 命名空间）。
 *
 * 为什么在启动而不是在块删除那一刻：撤销栈是会话内内存（ADR-0046 D5），重启即空 ⇒
 * 「重启后仍挂在孤儿前缀上」与「回滚窗口已过」严格等价。放在删除时清会把
 * 「先删后 Ctrl+Z」的配置一起抹掉。
 *
 * 为什么异步：清理是后台数据卫生，几百行 `screen_view` 的全表扫 + 逐块存在性核对，
 * 塞进启动关键路径会拖首屏。空闲回调（带 5s 上限超时）拿不到就退回定时器。
 */
export function scheduleOrphanViewCleanup(): void {
  const run = (): void => {
    void cleanupOrphanQueryViews()
  }
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 5000 })
    return
  }
  setTimeout(run, 2000)
}
